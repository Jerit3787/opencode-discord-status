package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/Jerit3787/opencode-discord-status/discord"
)

const (
	defaultClientID    = "1566388789214191657"
	reconnectInterval  = 5 * time.Second
	minUpdateInterval  = 4 * time.Second
	switchMargin       = 10 * time.Second
	reconnectLogPeriod = 30 * time.Second
	largeText          = "OpenCode - Discord Rich Presence"
	maxFieldLength     = 128
)

var clientIDPattern = regexp.MustCompile(`^\d{17,20}$`)

type presenceClient interface {
	Connect() error
	Reconnect() error
	SetActivity(discord.Activity) error
	ClearActivity() error
	Connected() bool
	Close() error
}

var (
	discordClient      presenceClient
	settings           = defaultSettings()
	settingsFilePath   string
	statusFilePath     string
	settingsModTime    time.Time
	lastConnectAttempt time.Time
	presenceCleared    bool
	lastPresence       string
	lastDetails        string
	lastSent           time.Time
	lastReconnect      time.Time
	currentSession     string
)

func main() {
	defaultID := defaultClientID
	if fromEnv := os.Getenv("DISCORD_CLIENT_ID"); fromEnv != "" {
		defaultID = fromEnv
	}

	clientID := flag.String("client-id", defaultID, "Discord Application ID (defaults to the shared one)")
	dbPath := flag.String("db", defaultDBPath(), "OpenCode database")
	interval := flag.Duration("interval", 2*time.Second, "poll interval")
	idleAfter := flag.Duration("idle-after", 15*time.Minute, "treat a session with no writes for this long as idle")
	exitWhenClosed := flag.Bool("exit-when-closed", false, "exit when OpenCode is not running")
	debug := flag.Bool("debug", false, "log each published card")
	doctor := flag.Bool("doctor", false, "set a test card for 8 seconds, then clear it")
	once := flag.Bool("once", false, "print the current card and exit")
	flag.Parse()

	if *interval < time.Second {
		log.Fatal("interval must be at least 1s")
	}
	if *idleAfter <= 0 {
		log.Fatal("idle-after must be positive")
	}

	*dbPath = expandHome(*dbPath)
	if *dbPath == "" {
		log.Fatal("could not resolve the database path")
	}

	settingsFilePath = filepath.Join(configDir(), "config.json")
	statusFilePath = filepath.Join(configDir(), "status.json")

	if *once {
		if loaded, err := loadSettings(settingsFilePath); err == nil {
			settings = loaded
		}
		printOnce(*dbPath, *idleAfter)
		return
	}

	if !clientIDPattern.MatchString(*clientID) {
		log.Fatal("client-id must be the 17-20 digit Discord Application ID")
	}

	if *exitWhenClosed && !openCodeRunning() {
		return
	}

	if err := ensureSettingsFile(settingsFilePath); err != nil {
		log.Printf("Could not create settings file: %v", err)
	}
	loaded, err := loadSettings(settingsFilePath)
	if err != nil {
		log.Printf("Settings: %v", err)
	}
	settings = loaded
	if info, err := os.Stat(settingsFilePath); err == nil {
		settingsModTime = info.ModTime()
	}

	discordClient = discord.NewClient(*clientID)

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		clearPresence()
		discordClient.Close()
		os.Exit(0)
	}()

	if *doctor {
		connectDiscord(*exitWhenClosed)
		runDoctor()
		return
	}

	lastReadError := ""
	tick := func() {
		if *exitWhenClosed && !openCodeRunning() {
			log.Print("OpenCode closed; clearing presence")
			clearPresence()
			discordClient.Close()
			os.Exit(0)
		}

		reloadSettingsIfChanged()

		rows, err := readSessions(*dbPath)
		if err != nil {
			if err.Error() != lastReadError {
				lastReadError = err.Error()
				log.Printf("Could not read %s: %v", *dbPath, err)
			}
			writePresenceStatus(nil)
			return
		}
		lastReadError = ""

		snapshot := pickSession(rows, time.Now(), *idleAfter, currentSession, switchMargin)
		if snapshot != nil {
			currentSession = snapshot.SessionID
		}
		syncPresence(snapshot, time.Now(), *debug)
	}

	tick()
	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	for range ticker.C {
		tick()
	}
}

func connectDiscord(exitWhenClosed bool) {
	for attempt := 1; ; attempt++ {
		err := discordClient.Connect()
		if err == nil {
			log.Print("Connected to Discord")
			lastPresence = ""
			lastSent = time.Time{}
			return
		}
		if attempt == 1 {
			log.Printf("Discord not reachable (%v); retrying every %s", err, reconnectInterval)
		}
		if exitWhenClosed && !openCodeRunning() {
			os.Exit(0)
		}
		time.Sleep(reconnectInterval)
	}
}

// ensureDiscordConnected connects lazily so a missing Discord or disabled
// presence never blocks status writes and config reloads.
func ensureDiscordConnected(now time.Time) bool {
	if !settings.Enabled {
		return false
	}
	if discordClient.Connected() {
		return true
	}

	firstAttempt := lastConnectAttempt.IsZero()
	if !firstAttempt && now.Sub(lastConnectAttempt) < reconnectInterval {
		return false
	}
	lastConnectAttempt = now

	if err := discordClient.Connect(); err != nil {
		if firstAttempt {
			log.Printf("Discord not reachable (%v); retrying every %s", err, reconnectInterval)
		}
		return false
	}
	log.Print("Connected to Discord")
	lastPresence = ""
	lastSent = time.Time{}
	return true
}

func writePresenceStatus(snapshot *Snapshot) {
	if err := writeStatus(statusFilePath, statusFromSnapshot(snapshot, discordClient != nil && discordClient.Connected(), settings)); err != nil {
		log.Printf("Could not write status: %v", err)
	}
}

// syncPresence is the single place that applies settings, updates Discord, and
// writes status. It keeps working while Discord is closed or presence is off.
func syncPresence(snapshot *Snapshot, now time.Time, debug bool) {
	connected := discordClient.Connected()

	if !settings.Enabled {
		if connected && !presenceCleared {
			if err := discordClient.ClearActivity(); err != nil {
				log.Printf("Could not clear presence: %v", err)
			} else {
				presenceCleared = true
			}
		}
		lastPresence = ""
		writePresenceStatus(snapshot)
		return
	}

	presenceCleared = false
	if !ensureDiscordConnected(now) {
		writePresenceStatus(snapshot)
		return
	}

	updatePresence(snapshot, debug)
	writePresenceStatus(snapshot)
}

// reloadSettingsIfChanged applies a config edit without restarting the daemon.
// Valid fields still apply when another field is malformed.
func reloadSettingsIfChanged() bool {
	info, err := os.Stat(settingsFilePath)
	if err != nil {
		return false
	}
	if !info.ModTime().After(settingsModTime) {
		return false
	}
	settingsModTime = info.ModTime()

	next, err := loadSettings(settingsFilePath)
	if err != nil {
		log.Printf("Settings: %v", err)
	}
	if next == settings {
		return false
	}

	settings = next
	lastPresence = ""
	presenceCleared = false
	return true
}

func updatePresence(snapshot *Snapshot, debug bool) {
	if !discordClient.Connected() {
		if err := discordClient.Reconnect(); err != nil {
			if time.Since(lastReconnect) >= reconnectLogPeriod {
				lastReconnect = time.Now()
				log.Printf("Could not reconnect to Discord: %v", err)
			}
			return
		}
		log.Print("Reconnected to Discord")
		lastPresence = ""
		lastSent = time.Time{}
	}

	details, state := presenceText(snapshot)
	startTime := presenceStartTime(snapshot, settings)

	key := details + "\n" + state
	if startTime != nil {
		key += "\n" + startTime.String()
	}
	if key == lastPresence {
		return
	}

	// Discord rate-limits presence updates. Busy/idle and project changes go
	// immediately; token/cost churn waits for the next window, and the next
	// tick sends the newest values anyway.
	now := time.Now()
	if details == lastDetails && now.Sub(lastSent) < minUpdateInterval {
		return
	}

	if debug {
		log.Printf("%s / %s", details, state)
	}

	activity := discord.Activity{
		Details:   details,
		State:     state,
		LargeText: largeText,
	}
	activity.StartTime = startTime

	if err := discordClient.SetActivity(activity); err != nil {
		log.Printf("Presence update failed: %v", err)
		return
	}

	lastPresence = key
	lastDetails = details
	lastSent = now
}

func clearPresence() {
	if discordClient == nil {
		return
	}
	if err := discordClient.ClearActivity(); err != nil {
		log.Printf("Could not clear presence: %v", err)
	}
}

func presenceTextWithSettings(snapshot *Snapshot, cfg Settings) (string, string) {
	details := "Idle"
	if snapshot != nil && snapshot.Busy {
		switch {
		case !cfg.ShowProject || cfg.PrivateMode:
			details = "Working on: a session"
		case snapshot.Project != "":
			details = "Working on: " + snapshot.Project
		default:
			details = "Working on: OpenCode"
		}
	}

	if snapshot == nil {
		return truncate(details, maxFieldLength), "OpenCode"
	}

	parts := make([]string, 0, 3)
	if snapshot.Busy {
		if cfg.ShowModel {
			model := snapshot.Model
			if model == "" {
				model = "OpenCode"
			}
			parts = append(parts, model)
		}
	} else if cfg.ShowProject && !cfg.PrivateMode && snapshot.Project != "" {
		parts = append(parts, snapshot.Project)
	}
	if cfg.ShowTokens {
		parts = append(parts, fmt.Sprintf("%s tokens", formatTokens(snapshot.Tokens)))
	}
	if cfg.ShowCost {
		parts = append(parts, formatCost(snapshot.Cost))
	}
	if len(parts) == 0 {
		parts = append(parts, "OpenCode")
	}

	return truncate(details, maxFieldLength), truncate(strings.Join(parts, " | "), maxFieldLength)
}

// presenceText uses the current settings.
func presenceText(snapshot *Snapshot) (string, string) {
	return presenceTextWithSettings(snapshot, settings)
}

// presenceStartTime returns the elapsed-timer start only for a busy session
// with the elapsed field enabled.
func presenceStartTime(snapshot *Snapshot, cfg Settings) *time.Time {
	if snapshot == nil || !snapshot.Busy || !cfg.ShowElapsed || snapshot.StartedAt.IsZero() {
		return nil
	}
	start := snapshot.StartedAt
	return &start
}

func truncate(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max-1]) + "…"
}

func printOnce(dbPath string, idleAfter time.Duration) {
	rows, err := readSessions(dbPath)
	if err != nil {
		log.Fatalf("Could not read %s: %v", dbPath, err)
	}

	details, state := presenceText(pickSession(rows, time.Now(), idleAfter, "", switchMargin))
	fmt.Println(details)
	fmt.Println(state)
}

func runDoctor() {
	if err := discordClient.SetActivity(discord.Activity{
		Details: "OpenCode",
		State:   "Discord Rich Presence",
	}); err != nil {
		log.Fatalf("Could not set test presence: %v", err)
	}

	log.Print("Test presence set for 8 seconds")
	time.Sleep(8 * time.Second)
	clearPresence()
	discordClient.Close()
}

func defaultDBPath() string {
	if path := os.Getenv("OPENCODE_DB"); path != "" {
		return path
	}
	if data := os.Getenv("XDG_DATA_HOME"); data != "" {
		return filepath.Join(data, "opencode", "opencode.db")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share", "opencode", "opencode.db")
}

func expandHome(path string) string {
	if path == "~" {
		home, _ := os.UserHomeDir()
		return home
	}
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, path[2:])
	}
	return path
}
