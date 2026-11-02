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
	defaultClientID   = "1566388789214191657"
	reconnectInterval = 5 * time.Second
	switchMargin      = 10 * time.Second
	largeText         = "OpenCode - Discord Rich Presence"
	maxFieldLength    = 128
)

var clientIDPattern = regexp.MustCompile(`^\d{17,20}$`)

var (
	discordClient  *discord.Client
	lastPresence   string
	currentSession string
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

	if *interval <= 0 {
		log.Fatal("interval must be positive")
	}
	if *idleAfter <= 0 {
		log.Fatal("idle-after must be positive")
	}

	*dbPath = expandHome(*dbPath)
	if *dbPath == "" {
		log.Fatal("could not resolve the database path")
	}

	if *once {
		printOnce(*dbPath, *idleAfter)
		return
	}

	if !clientIDPattern.MatchString(*clientID) {
		log.Fatal("client-id must be the 17-20 digit Discord Application ID")
	}

	if *exitWhenClosed && !openCodeRunning() {
		return
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		clearPresence()
		if discordClient != nil {
			discordClient.Close()
		}
		os.Exit(0)
	}()

	connectDiscord(*clientID, *exitWhenClosed)

	if *doctor {
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

		rows, err := readSessions(*dbPath)
		if err != nil {
			if err.Error() != lastReadError {
				lastReadError = err.Error()
				log.Printf("Could not read %s: %v", *dbPath, err)
			}
			return
		}
		lastReadError = ""

		snapshot := pickSession(rows, time.Now(), *idleAfter, currentSession, switchMargin)
		if snapshot != nil {
			currentSession = snapshot.SessionID
		}
		updatePresence(snapshot, *debug)
	}

	tick()
	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	for range ticker.C {
		tick()
	}
}

func connectDiscord(clientID string, exitWhenClosed bool) {
	discordClient = discord.NewClient(clientID)

	for attempt := 1; ; attempt++ {
		err := discordClient.Connect()
		if err == nil {
			log.Print("Connected to Discord")
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

func updatePresence(snapshot *Snapshot, debug bool) {
	details, state := presenceText(snapshot)

	startKey := ""
	if snapshot != nil && snapshot.Busy && !snapshot.StartedAt.IsZero() {
		startKey = snapshot.StartedAt.String()
	}
	key := details + "\n" + state + "\n" + startKey
	if key == lastPresence {
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
	if startKey != "" {
		start := snapshot.StartedAt
		activity.StartTime = &start
	}

	if err := discordClient.SetActivity(activity); err != nil {
		log.Printf("Presence update failed (%v); reconnecting", err)
		if reconnectErr := discordClient.Reconnect(); reconnectErr != nil {
			log.Printf("Reconnect failed: %v", reconnectErr)
			return
		}
		if err := discordClient.SetActivity(activity); err != nil {
			log.Printf("Presence update failed after reconnect: %v", err)
			return
		}
	}

	lastPresence = key
}

func clearPresence() {
	if discordClient == nil {
		return
	}
	if err := discordClient.ClearActivity(); err != nil {
		log.Printf("Could not clear presence: %v", err)
	}
}

func presenceText(snapshot *Snapshot) (string, string) {
	details := "Idle"
	if snapshot != nil && snapshot.Busy {
		details = "Working on OpenCode"
		if snapshot.Project != "" {
			details = "Working on: " + snapshot.Project
		}
	}

	if snapshot == nil {
		return truncate(details, maxFieldLength), "OpenCode"
	}

	state := ""
	if snapshot.Busy {
		model := snapshot.Model
		if model == "" {
			model = "OpenCode"
		}
		state = fmt.Sprintf(
			"%s | %s tokens | %s",
			model,
			formatTokens(snapshot.Tokens),
			formatCost(snapshot.Cost),
		)
	} else {
		project := snapshot.Project
		if project == "" {
			project = "OpenCode"
		}
		state = fmt.Sprintf(
			"%s | %s tokens | %s",
			project,
			formatTokens(snapshot.Tokens),
			formatCost(snapshot.Cost),
		)
	}

	return truncate(details, maxFieldLength), truncate(state, maxFieldLength)
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
