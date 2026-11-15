package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestStatusFromSnapshot(t *testing.T) {
	start := time.Date(2026, 11, 15, 9, 45, 0, 0, time.UTC)
	snapshot := &Snapshot{
		SessionID: "ses_01",
		Busy:      true,
		Project:   "opencode-discord-status",
		Model:     "DeepSeek V4.1 Flash",
		Cost:      0.0421,
		Tokens:    12345,
		StartedAt: start,
	}
	cfg := defaultSettings()
	got := statusFromSnapshot(snapshot, true, cfg)
	if got.Project != snapshot.Project || got.Model != snapshot.Model || got.Tokens != 12345 || got.CostUSD != 0.0421 {
		t.Fatalf("status = %+v", got)
	}
	if !got.Busy || got.StartedAt != start.Format(time.RFC3339) {
		t.Fatalf("status = %+v", got)
	}
	if !got.Enabled || !got.DiscordConnected || got.Version != 1 || got.PID != os.Getpid() {
		t.Fatalf("status identity = %+v", got)
	}

	empty := statusFromSnapshot(nil, false, cfg)
	if empty.Project != "" || empty.DiscordConnected || empty.Busy || empty.StartedAt != "" {
		t.Fatalf("empty status = %+v", empty)
	}
}

func TestWriteStatusAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "status.json")
	want := Status{
		Version:          1,
		PID:              123,
		DaemonVersion:    daemonVersion,
		Enabled:          true,
		DiscordConnected: true,
		Source:           sourceDatabase,
		Project:          "demo",
		UpdatedAt:        time.Now().UTC(),
	}
	if err := writeStatus(path, want); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got Status
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Project != "demo" || got.PID != 123 || got.DaemonVersion != daemonVersion {
		t.Errorf("status = %+v", got)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0600 {
			t.Errorf("mode = %o, want 600", info.Mode().Perm())
		}
	}

	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("directory has %d entries, want only status.json", len(entries))
	}
}
