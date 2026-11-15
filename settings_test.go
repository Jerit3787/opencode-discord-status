package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadSettingsDefaultsMissing(t *testing.T) {
	got, err := loadSettings(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got != defaultSettings() {
		t.Fatalf("got %+v, want defaults", got)
	}
}

func TestLoadSettingsKeepsValidFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"enabled":false,"autostart":false,"showCost":false,"showModel":"yes"}`), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := loadSettings(path)
	if err == nil {
		t.Fatal("want error for wrong-typed showModel")
	}
	if got.Enabled || got.Autostart || got.ShowCost {
		t.Fatal("valid false fields were lost")
	}
	if !got.ShowProject || !got.ShowModel || !got.ShowTokens || !got.ShowElapsed {
		t.Fatal("missing/invalid fields must keep defaults")
	}
}

func TestLoadSettingsMalformedJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{not json`), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := loadSettings(path)
	if err == nil {
		t.Fatal("want error")
	}
	if got != defaultSettings() {
		t.Fatal("malformed config must use defaults")
	}
}

func TestEnsureSettingsFileCreatesDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "opencode-discord-status", "config.json")
	if err := ensureSettingsFile(path); err != nil {
		t.Fatal(err)
	}
	got, err := loadSettings(path)
	if err != nil || got != defaultSettings() {
		t.Fatalf("got %+v err %v", got, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
}
