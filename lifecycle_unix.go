//go:build !windows

package main

import "os/exec"

// openCodeRunning reports whether the app or a normal CLI/TUI is running.
// The background `serve --service` child is ignored because it can outlive the
// app. If `ps` fails, assume OpenCode is running so the card is not hidden.
func openCodeRunning() bool {
	commOutput, err := exec.Command("ps", "-Ao", "comm=").Output()
	if err != nil {
		return true
	}

	argsOutput, err := exec.Command("ps", "-Ao", "args=").Output()
	if err != nil {
		return true
	}

	return hasOpenCodeCommand(string(commOutput), string(argsOutput))
}
