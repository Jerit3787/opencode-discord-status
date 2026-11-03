package main

import (
	"path/filepath"
	"strings"
)

// hasOpenCodeCommand decides whether OpenCode is open.
//
// `comm` is used for the desktop app because helper paths contain spaces.
// `args` is used for the CLI so the app's `opencode-cli serve --service` child
// can be ignored: it can outlive the app after quitting.
func hasOpenCodeCommand(commOutput, argsOutput string) bool {
	for _, line := range strings.Split(commOutput, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if filepath.Base(line) == "OpenCode" {
			return true
		}
	}

	for _, line := range strings.Split(argsOutput, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}

		switch filepath.Base(fields[0]) {
		case "opencode":
			return true
		case "opencode-cli":
			if !hasArgument(fields[1:], "--service") {
				return true
			}
		}
	}

	return false
}

// hasOpenCodeImage parses `tasklist /FO CSV /NH` output on Windows, which does
// not include command-line arguments.
func hasOpenCodeImage(output string) bool {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, `"`) {
			if end := strings.Index(line[1:], `"`); end >= 0 {
				line = line[1 : 1+end]
			}
		}

		switch filepath.Base(line) {
		case "opencode.exe", "opencode-cli.exe", "OpenCode.exe":
			return true
		}
	}
	return false
}

func hasArgument(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}
