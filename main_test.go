package main

import (
	"strings"
	"testing"
	"time"
)

func TestPresenceTextBusy(t *testing.T) {
	details, state := presenceText(&Snapshot{
		Busy:    true,
		Project: "my-app",
		Model:   "DeepSeek V4.1 Flash",
		Tokens:  12_300,
		Cost:    0.0421,
	})

	if details != "Working on: my-app" {
		t.Errorf("details = %q", details)
	}
	if state != "DeepSeek V4.1 Flash | 12.3K tokens | $0.0421" {
		t.Errorf("state = %q", state)
	}
}

func TestPresenceTextIdleKeepsProject(t *testing.T) {
	details, state := presenceText(&Snapshot{
		Busy:    false,
		Project: "my-app",
		Model:   "DeepSeek V4.1 Flash",
		Tokens:  12_300,
		Cost:    0.0421,
	})

	if details != "Idle" {
		t.Errorf("details = %q", details)
	}
	if state != "my-app | 12.3K tokens | $0.0421" {
		t.Errorf("state = %q", state)
	}
}

func TestPresenceTextSettingsMatrix(t *testing.T) {
	busy := &Snapshot{
		Busy:    true,
		Project: "my-app",
		Model:   "DeepSeek V4.1 Flash",
		Tokens:  12_300,
		Cost:    0.0421,
	}
	all := defaultSettings()

	details, state := presenceTextWithSettings(busy, all)
	if details != "Working on: my-app" || state != "DeepSeek V4.1 Flash | 12.3K tokens | $0.0421" {
		t.Fatalf("all busy = (%q, %q)", details, state)
	}

	private := all
	private.PrivateMode = true
	details, _ = presenceTextWithSettings(busy, private)
	if details != "Working on: a session" {
		t.Errorf("private details = %q", details)
	}

	noProject := all
	noProject.ShowProject = false
	details, _ = presenceTextWithSettings(busy, noProject)
	if details != "Working on: a session" {
		t.Errorf("hidden project details = %q", details)
	}

	minimal := all
	minimal.ShowModel = false
	minimal.ShowTokens = false
	minimal.ShowCost = false
	_, state = presenceTextWithSettings(busy, minimal)
	if state != "OpenCode" {
		t.Errorf("minimal state = %q", state)
	}

	idle := &Snapshot{Busy: false, Project: "my-app", Model: "DeepSeek V4.1 Flash", Tokens: 12_300, Cost: 0.0421}
	details, state = presenceTextWithSettings(idle, all)
	if details != "Idle" || state != "my-app | 12.3K tokens | $0.0421" {
		t.Fatalf("idle all = (%q, %q)", details, state)
	}

	details, state = presenceTextWithSettings(idle, private)
	if details != "Idle" || state != "12.3K tokens | $0.0421" {
		t.Fatalf("idle private = (%q, %q)", details, state)
	}
}

func TestPresenceStartTimeSettings(t *testing.T) {
	started := time.Now()
	busy := &Snapshot{Busy: true, StartedAt: started}

	if got := presenceStartTime(busy, defaultSettings()); got == nil || !got.Equal(started) {
		t.Fatalf("start time = %v", got)
	}

	off := defaultSettings()
	off.ShowElapsed = false
	if got := presenceStartTime(busy, off); got != nil {
		t.Fatalf("start time = %v, want nil", got)
	}

	if got := presenceStartTime(&Snapshot{Busy: false, StartedAt: started}, defaultSettings()); got != nil {
		t.Fatalf("idle start time = %v, want nil", got)
	}
}

func TestPresenceTextTruncatesLongFields(t *testing.T) {
	details, _ := presenceText(&Snapshot{
		Busy:    true,
		Project: strings.Repeat("x", 300),
	})

	runes := []rune(details)
	if len(runes) != maxFieldLength {
		t.Fatalf("len = %d, want %d", len(runes), maxFieldLength)
	}
	if !strings.HasSuffix(details, "…") {
		t.Fatalf("details does not end with an ellipsis: %q", details)
	}
}

func TestTruncateCountsRunes(t *testing.T) {
	got := truncate("αβγδε", 3)

	if got != "αβ…" {
		t.Fatalf("truncate = %q", got)
	}
}
