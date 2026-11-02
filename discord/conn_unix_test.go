//go:build !windows

package discord

import "testing"

func TestSocketCandidatesIncludeKnownClients(t *testing.T) {
	t.Setenv("XDG_RUNTIME_DIR", "/run/user/1000")
	t.Setenv("TMPDIR", "/tmp/user")

	paths := socketCandidates(0)
	for _, want := range []string{
		"/run/user/1000/discord-ipc-0",
		"/run/user/1000/snap.discord/discord-ipc-0",
		"/run/user/1000/app/com.discordapp.DiscordCanary/discord-ipc-0",
		"/run/user/1000/app/dev.vencord.Vesktop/discord-ipc-0",
		"/tmp/user/discord-ipc-0",
	} {
		found := false
		for _, path := range paths {
			if path == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing %q in %v", want, paths)
		}
	}
}
