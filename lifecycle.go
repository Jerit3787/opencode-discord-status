package main

import (
	"path/filepath"
	"strings"
)

// Process names that mean "OpenCode is open": the app, its service, or the CLI.
var openCodeNames = map[string]bool{
	"opencode":         true,
	"opencode.exe":     true,
	"opencode-cli":     true,
	"opencode-cli.exe": true,
	"OpenCode":         true,
	"OpenCode.exe":     true,
}

// hasOpenCodeProcess parses `ps -Ao comm=` or `tasklist /FO CSV /NH` output.
// It matches the executable name, not the full path, so this project's own
// path cannot match itself.
func hasOpenCodeProcess(output string) bool {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// tasklist CSV: "opencode.exe","1234","Console","1","10,000 K"
		if strings.HasPrefix(line, `"`) {
			if end := strings.Index(line[1:], `"`); end >= 0 {
				line = line[1 : 1+end]
			}
		}

		if openCodeNames[filepath.Base(line)] {
			return true
		}
	}
	return false
}
