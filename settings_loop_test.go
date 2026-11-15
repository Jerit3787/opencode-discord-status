package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Jerit3787/opencode-discord-status/discord"
)

type fakePresenceClient struct {
	connected  bool
	connects   int
	clears     int
	activities []discord.Activity
}

func (f *fakePresenceClient) Connect() error {
	f.connected = true
	f.connects++
	return nil
}
func (f *fakePresenceClient) Reconnect() error { return f.Connect() }
func (f *fakePresenceClient) SetActivity(activity discord.Activity) error {
	f.activities = append(f.activities, activity)
	return nil
}
func (f *fakePresenceClient) ClearActivity() error { f.clears++; return nil }
func (f *fakePresenceClient) Connected() bool      { return f.connected }
func (f *fakePresenceClient) Close() error         { f.connected = false; return nil }

func resetPresenceTestState(t *testing.T) *fakePresenceClient {
	t.Helper()

	origSettingsPath, origStatusPath := settingsFilePath, statusFilePath
	origSettings, origModTime := settings, settingsModTime
	origConnectAttempt, origCleared := lastConnectAttempt, presenceCleared
	origPresence, origDetails := lastPresence, lastDetails
	origSent, origReconnect, origSession := lastSent, lastReconnect, currentSession
	origClient := discordClient

	t.Cleanup(func() {
		settingsFilePath, statusFilePath = origSettingsPath, origStatusPath
		settings, settingsModTime = origSettings, origModTime
		lastConnectAttempt, presenceCleared = origConnectAttempt, origCleared
		lastPresence, lastDetails = origPresence, origDetails
		lastSent, lastReconnect, currentSession = origSent, origReconnect, origSession
		discordClient = origClient
	})

	dir := t.TempDir()
	settingsFilePath = filepath.Join(dir, "config.json")
	statusFilePath = filepath.Join(dir, "status.json")
	settings = defaultSettings()
	settingsModTime = time.Time{}
	lastConnectAttempt = time.Time{}
	presenceCleared = false
	lastPresence = ""
	lastDetails = ""
	lastSent = time.Time{}
	lastReconnect = time.Time{}
	currentSession = ""

	fake := &fakePresenceClient{}
	discordClient = fake
	return fake
}

func readTestStatus(t *testing.T, path string) Status {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var status Status
	if err := json.Unmarshal(data, &status); err != nil {
		t.Fatal(err)
	}
	return status
}

func TestSyncPresenceDisabledDoesNotConnect(t *testing.T) {
	fake := resetPresenceTestState(t)
	settings.Enabled = false

	syncPresence(&Snapshot{Busy: true, Project: "demo"}, time.Now(), false)

	if fake.connects != 0 {
		t.Fatalf("connects = %d, want 0", fake.connects)
	}
	if fake.clears != 0 {
		t.Fatalf("clears = %d, want 0 (not connected)", fake.clears)
	}
	status := readTestStatus(t, statusFilePath)
	if status.Enabled || status.DiscordConnected {
		t.Fatalf("status = %+v", status)
	}
}

func TestSyncPresenceDisableClearsAndKeepsConnection(t *testing.T) {
	fake := resetPresenceTestState(t)
	fake.connected = true

	syncPresence(&Snapshot{Busy: true, Project: "demo"}, time.Now(), false)
	if len(fake.activities) != 1 {
		t.Fatalf("activities = %d, want 1", len(fake.activities))
	}

	settings.Enabled = false
	syncPresence(&Snapshot{Busy: true, Project: "demo"}, time.Now(), false)
	if fake.clears != 1 {
		t.Fatalf("clears = %d, want 1", fake.clears)
	}
	if !fake.connected {
		t.Fatal("disabling must not close the connection")
	}
}

func TestSyncPresencePublishesAndWritesStatus(t *testing.T) {
	fake := resetPresenceTestState(t)
	snapshot := &Snapshot{
		SessionID: "ses_01",
		Busy:      true,
		Project:   "demo",
		Model:     "DeepSeek V4.1 Flash",
		Tokens:    12_300,
		Cost:      0.0421,
		StartedAt: time.Now().Add(-time.Minute),
	}

	syncPresence(snapshot, time.Now(), false)

	if fake.connects != 1 || len(fake.activities) != 1 {
		t.Fatalf("connects = %d, activities = %d", fake.connects, len(fake.activities))
	}
	if fake.activities[0].Details != "Working on: demo" {
		t.Errorf("details = %q", fake.activities[0].Details)
	}
	status := readTestStatus(t, statusFilePath)
	if status.Project != "demo" || status.Model != snapshot.Model || !status.DiscordConnected || !status.Busy {
		t.Fatalf("status = %+v", status)
	}
}

func TestReloadSettingsIfChanged(t *testing.T) {
	fake := resetPresenceTestState(t)
	_ = fake
	settings = defaultSettings()
	next := defaultSettings()
	next.Enabled = false
	data, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(settingsFilePath, data, 0600); err != nil {
		t.Fatal(err)
	}

	if !reloadSettingsIfChanged() {
		t.Fatal("change not detected")
	}
	if settings.Enabled {
		t.Fatal("settings not reloaded")
	}
	if lastPresence != "" || presenceCleared {
		t.Fatal("presence state should reset")
	}
	if reloadSettingsIfChanged() {
		t.Fatal("unchanged mtime should not reload")
	}
}
