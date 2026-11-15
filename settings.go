package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const settingsVersion = 1

// daemonVersion is written to the status file so the settings page can show
// which daemon produced it. Bump it with the release version.
const daemonVersion = "1.1.0"

// Settings controls what the daemon publishes. Field names match the JSON
// contract shared with the OpenCode settings page.
type Settings struct {
	Version     int  `json:"version"`
	Enabled     bool `json:"enabled"`
	ShowProject bool `json:"showProject"`
	ShowModel   bool `json:"showModel"`
	ShowTokens  bool `json:"showTokens"`
	ShowCost    bool `json:"showCost"`
	ShowElapsed bool `json:"showElapsed"`
	PrivateMode bool `json:"privateMode"`
}

func defaultSettings() Settings {
	return Settings{
		Version:     settingsVersion,
		Enabled:     true,
		ShowProject: true,
		ShowModel:   true,
		ShowTokens:  true,
		ShowCost:    true,
		ShowElapsed: true,
		PrivateMode: false,
	}
}

// configDir is the platform config directory used by both the daemon and the
// OpenCode settings page.
func configDir() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "opencode-discord-status")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".opencode-discord-status")
}

// loadSettings reads the config on top of the defaults. Missing fields keep
// their defaults; a wrong-typed field keeps its default while the rest still
// applies.
func loadSettings(path string) (Settings, error) {
	settings := defaultSettings()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return settings, nil
		}
		return settings, err
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return settings, fmt.Errorf("parse settings: %w", err)
	}

	var errs []error
	readBool := func(name string, target *bool) {
		raw, ok := fields[name]
		if !ok {
			return
		}
		var value bool
		if err := json.Unmarshal(raw, &value); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", name, err))
			return
		}
		*target = value
	}

	readBool("enabled", &settings.Enabled)
	readBool("showProject", &settings.ShowProject)
	readBool("showModel", &settings.ShowModel)
	readBool("showTokens", &settings.ShowTokens)
	readBool("showCost", &settings.ShowCost)
	readBool("showElapsed", &settings.ShowElapsed)
	readBool("privateMode", &settings.PrivateMode)

	if raw, ok := fields["version"]; ok {
		var version int
		if err := json.Unmarshal(raw, &version); err != nil {
			errs = append(errs, fmt.Errorf("version: %w", err))
		} else {
			settings.Version = version
		}
	}

	return settings, errors.Join(errs...)
}

// ensureSettingsFile creates the config with defaults when it is missing. An
// existing file is left untouched.
func ensureSettingsFile(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(defaultSettings(), "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		if os.IsExist(err) {
			return nil
		}
		return err
	}
	defer file.Close()

	if _, err := file.Write(data); err != nil {
		return err
	}
	return nil
}
