package main

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// Process names that mean "OpenCode is open": the app, its service, or the CLI.
var openCodeNames = map[string]bool{
	"opencode":     true,
	"opencode-cli": true,
	"OpenCode":     true,
}

// hasOpenCodeProcess parses `ps -Ao comm=` output. It matches the executable
// name, not the full path, so this project's own path cannot match itself.
func hasOpenCodeProcess(output string) bool {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if openCodeNames[filepath.Base(line)] {
			return true
		}
	}
	return false
}

// openCodeRunning reports whether the app or CLI is running. If `ps` fails,
// assume it is running: better to keep the card than to hide it silently.
func openCodeRunning() bool {
	output, err := exec.Command("ps", "-Ao", "comm=").Output()
	if err != nil {
		return true
	}
	return hasOpenCodeProcess(string(output))
}
