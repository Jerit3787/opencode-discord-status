//go:build !windows

package main

import "os/exec"

// openCodeRunning reports whether the app or CLI is running. If `ps` fails,
// assume it is running: better to keep the card than to hide it silently.
func openCodeRunning() bool {
	output, err := exec.Command("ps", "-Ao", "comm=").Output()
	if err != nil {
		return true
	}
	return hasOpenCodeProcess(string(output))
}
