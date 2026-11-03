//go:build windows

package main

import "os/exec"

// openCodeRunning reports whether the app or CLI is running. If `tasklist`
// fails, assume it is running so the card is not hidden.
func openCodeRunning() bool {
	output, err := exec.Command("tasklist", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return true
	}
	return hasOpenCodeImage(string(output))
}
