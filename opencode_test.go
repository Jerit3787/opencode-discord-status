package main

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

var testNow = time.UnixMilli(1_700_000_000_000)

func testRow(overrides func(*SessionRow)) SessionRow {
	row := SessionRow{
		SessionID:    "ses_1",
		Directory:    "/work/my-app",
		Model:        `{"id":"deepseek-v4.1-flash","providerID":"opencode-go"}`,
		Agent:        "build",
		Cost:         0.0421,
		TokensInput:  11_800,
		TokensOutput: 460,
		TimeUpdated:  testNow.UnixMilli() - 1_000,
		Message:      `{"time":{"created":1699999995000,"streamed":1699999999000},"agent":"build","model":{"id":"deepseek-v4.1-flash"}}`,
	}
	if overrides != nil {
		overrides(&row)
	}
	return row
}

func TestFormatModelName(t *testing.T) {
	cases := map[string]string{
		"deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
		"gpt-6-astra":         "GPT 6 Astra",
		"glm-5.3":             "GLM 5.3",
		"claude-sonnet-4-5":   "Claude Sonnet 4 5",
		"":                    "",
	}

	for input, want := range cases {
		if got := formatModelName(input); got != want {
			t.Errorf("formatModelName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFormatTokensAndCost(t *testing.T) {
	if got := formatTokens(950); got != "950" {
		t.Errorf("formatTokens(950) = %q", got)
	}
	if got := formatTokens(12_300); got != "12.3K" {
		t.Errorf("formatTokens(12300) = %q", got)
	}
	if got := formatTokens(999_999); got != "1.0M" {
		t.Errorf("formatTokens(999999) = %q", got)
	}
	if got := formatTokens(1_300_000); got != "1.3M" {
		t.Errorf("formatTokens(1300000) = %q", got)
	}
	if got := formatCost(0.0421); got != "$0.0421" {
		t.Errorf("formatCost(0.0421) = %q", got)
	}
	if got := formatCost(0); got != "$0.00" {
		t.Errorf("formatCost(0) = %q", got)
	}
	if got := formatCost(0.01); got != "$0.01" {
		t.Errorf("formatCost(0.01) = %q", got)
	}
	if got := formatCost(3.4567); got != "$3.46" {
		t.Errorf("formatCost(3.4567) = %q", got)
	}
}

func TestAnalyzeStreamingIsBusy(t *testing.T) {
	snapshot := analyze(testRow(nil), testNow, 15*time.Minute)

	if !snapshot.Busy {
		t.Fatal("expected a streaming message to be busy")
	}
	if snapshot.Project != "my-app" {
		t.Errorf("project = %q", snapshot.Project)
	}
	if snapshot.Model != "DeepSeek V4.1 Flash" {
		t.Errorf("model = %q", snapshot.Model)
	}
	if snapshot.Tokens != 12_260 {
		t.Errorf("tokens = %d", snapshot.Tokens)
	}
	if snapshot.StartedAt.UnixMilli() != 1_699_999_995_000 {
		t.Errorf("startedAt = %v", snapshot.StartedAt)
	}
}

func TestAnalyzeFinishedIsIdle(t *testing.T) {
	row := testRow(func(row *SessionRow) {
		row.Message = `{"time":{"created":1699999995000,"completed":1699999999000},"finish":"stop"}`
	})

	if snapshot := analyze(row, testNow, 15*time.Minute); snapshot.Busy {
		t.Fatal("expected a finished step to be idle")
	}
}

func TestAnalyzeWaitingOnToolsIsBusy(t *testing.T) {
	row := testRow(func(row *SessionRow) {
		row.Message = `{"time":{"created":1699999995000,"completed":1699999999000},"finish":"tool-calls"}`
	})

	if snapshot := analyze(row, testNow, 15*time.Minute); !snapshot.Busy {
		t.Fatal("expected a tool-calls step to be busy")
	}
}

func TestAnalyzeStaleSessionIsIdle(t *testing.T) {
	row := testRow(func(row *SessionRow) {
		row.TimeUpdated = testNow.Add(-time.Hour).UnixMilli()
	})

	if snapshot := analyze(row, testNow, 15*time.Minute); snapshot.Busy {
		t.Fatal("expected a stale session to be idle")
	}
}

func TestPickSession(t *testing.T) {
	busy := testRow(nil)
	idle := testRow(func(row *SessionRow) {
		row.SessionID = "ses_idle"
		row.TimeUpdated = testNow.UnixMilli() - 1_000
		row.Message = `{"time":{"created":1699999995000,"completed":1699999999000},"finish":"stop"}`
	})

	if got := pickSession([]SessionRow{idle, busy}, testNow, 15*time.Minute, "", 10*time.Second); got == nil || got.SessionID != "ses_1" {
		t.Fatalf("busy session should win, got %+v", got)
	}
}

func TestPickSessionKeepsIncumbentOnSmallGap(t *testing.T) {
	incumbent := testRow(func(row *SessionRow) {
		row.SessionID = "incumbent"
		row.TimeUpdated = testNow.UnixMilli() - 2_000
	})
	challenger := testRow(func(row *SessionRow) {
		row.SessionID = "challenger"
		row.TimeUpdated = testNow.UnixMilli() - 1_000
	})

	got := pickSession([]SessionRow{incumbent, challenger}, testNow, 15*time.Minute, "incumbent", 10*time.Second)
	if got == nil || got.SessionID != "incumbent" {
		t.Fatalf("expected the incumbent, got %+v", got)
	}
}

func TestPickSessionSwitchesWhenClearlyNewer(t *testing.T) {
	incumbent := testRow(func(row *SessionRow) {
		row.SessionID = "incumbent"
		row.TimeUpdated = testNow.Add(-30 * time.Second).UnixMilli()
	})
	challenger := testRow(func(row *SessionRow) {
		row.SessionID = "challenger"
		row.TimeUpdated = testNow.UnixMilli() - 1_000
	})

	got := pickSession([]SessionRow{incumbent, challenger}, testNow, 15*time.Minute, "incumbent", 10*time.Second)
	if got == nil || got.SessionID != "challenger" {
		t.Fatalf("expected the challenger, got %+v", got)
	}
}

func TestReadSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "opencode.db")

	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	_, err = database.Exec(`
		create table session_v2 (
			id text primary key,
			directory text,
			model text,
			agent text,
			cost real,
			tokens_input integer,
			tokens_output integer,
			time_updated integer,
			time_archived integer
		);
		create table session_message (
			id text primary key,
			session_id text,
			type text,
			seq integer,
			data text
		);
	`)
	if err != nil {
		t.Fatal(err)
	}

	row := testRow(nil)
	_, err = database.Exec(
		"insert into session_v2 values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		row.SessionID, row.Directory, row.Model, row.Agent, row.Cost,
		row.TokensInput, row.TokensOutput, row.TimeUpdated, nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	_, err = database.Exec(
		"insert into session_message values (?, ?, ?, ?, ?)",
		"msg_1", row.SessionID, "assistant", 1, row.Message,
	)
	if err != nil {
		t.Fatal(err)
	}

	rows, err := readSessions(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}

	snapshot := analyze(rows[0], testNow, 15*time.Minute)
	if !snapshot.Busy {
		t.Fatal("expected the session to be busy")
	}
	if snapshot.Model != "DeepSeek V4.1 Flash" {
		t.Errorf("model = %q", snapshot.Model)
	}
}
