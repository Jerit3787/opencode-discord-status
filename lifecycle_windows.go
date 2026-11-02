//go:build windows

package main

import "os/exec"

// openCodeRunning reports whether the app or CLI is running. If `tasklist`
// fails, assume it is running: better to keep the card than to hide it.
func openCodeRunning() bool {
	output, err := exec.Command("tasklist", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return true
	}
	return hasOpenCodeProcess(string(output))
}
