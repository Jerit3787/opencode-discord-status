package main

import (
	"strings"
	"testing"
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
