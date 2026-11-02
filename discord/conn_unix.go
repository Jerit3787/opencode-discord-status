//go:build !windows

package discord

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"
)

const dialTimeout = 5 * time.Second

func (c *Client) connectToDiscord() (Conn, error) {
	// Explicit override, mostly for tests and unusual installs.
	if path := os.Getenv("DISCORD_IPC_PATH"); path != "" {
		conn, err := net.DialTimeout("unix", path, dialTimeout)
		if err != nil {
			return nil, fmt.Errorf("DISCORD_IPC_PATH %s: %w", path, err)
		}
		return conn, nil
	}

	for index := 0; index < 10; index++ {
		for _, path := range socketCandidates(index) {
			if _, err := os.Stat(path); err != nil {
				continue
			}
			if conn, err := net.DialTimeout("unix", path, dialTimeout); err == nil {
				return conn, nil
			}
		}
	}

	return nil, fmt.Errorf("Discord IPC socket not found. Make sure Discord is running")
}

// socketCandidates lists Discord's socket paths for one pipe index. Covers
// stable, Canary, Snap, Flatpak, and Vesktop.
func socketCandidates(index int) []string {
	directories := []string{
		os.Getenv("XDG_RUNTIME_DIR"),
		os.Getenv("TMPDIR"),
		"/tmp",
	}
	patterns := []string{
		"discord-ipc-%d",
		"snap.discord/discord-ipc-%d",
		"snap.discord-canary/discord-ipc-%d",
		"app/com.discordapp.Discord/discord-ipc-%d",
		"app/com.discordapp.DiscordCanary/discord-ipc-%d",
		"app/dev.vencord.Vesktop/discord-ipc-%d",
	}

	seen := map[string]bool{}
	var paths []string
	for _, directory := range directories {
		if directory == "" {
			continue
		}
		for _, pattern := range patterns {
			path := filepath.Join(directory, fmt.Sprintf(pattern, index))
			if seen[path] {
				continue
			}
			seen[path] = true
			paths = append(paths, path)
		}
	}

	return paths
}
