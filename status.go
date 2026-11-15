package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const sourceDatabase = "opencode database"

// Status is the on-disk snapshot the OpenCode settings page reads. Session
// fields are empty when no session is eligible.
type Status struct {
	Version          int       `json:"version"`
	PID              int       `json:"pid"`
	DaemonVersion    string    `json:"daemonVersion"`
	Enabled          bool      `json:"enabled"`
	DiscordConnected bool      `json:"discordConnected"`
	Source           string    `json:"source"`
	Project          string    `json:"project"`
	Model            string    `json:"model"`
	Tokens           int64     `json:"tokens"`
	CostUSD          float64   `json:"costUSD"`
	StartedAt        string    `json:"startedAt"`
	Busy             bool      `json:"busy"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func statusFromSnapshot(snapshot *Snapshot, connected bool, cfg Settings) Status {
	status := Status{
		Version:          settingsVersion,
		PID:              os.Getpid(),
		DaemonVersion:    daemonVersion,
		Enabled:          cfg.Enabled,
		DiscordConnected: connected,
		Source:           sourceDatabase,
		UpdatedAt:        time.Now().UTC(),
	}
	if snapshot == nil {
		return status
	}

	status.Project = snapshot.Project
	status.Model = snapshot.Model
	status.Tokens = snapshot.Tokens
	status.CostUSD = snapshot.Cost
	status.Busy = snapshot.Busy
	if !snapshot.StartedAt.IsZero() {
		status.StartedAt = snapshot.StartedAt.Format(time.RFC3339)
	}
	return status
}

// writeStatus writes the status snapshot atomically so a reader never sees a
// partial file.
func writeStatus(path string, status Status) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(path), ".status-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
