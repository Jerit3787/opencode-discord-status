package main

import "testing"

func TestHasOpenCodeCommand(t *testing.T) {
	const (
		app        = "/Applications/OpenCode.app/Contents/MacOS/OpenCode"
		helper     = "/Applications/OpenCode.app/Contents/Frameworks/OpenCode Helper.app/Contents/MacOS/OpenCode Helper"
		service    = "/Users/you/Library/Application Support/ai.opencode.desktop/cli/opencode-cli serve --service"
		tui        = "/usr/local/bin/opencode /tmp/project"
		foreground = "/usr/local/bin/opencode-cli serve"
		watcher    = "/Users/you/opencode-discord-status/bin/opencode-discord-status --exit-when-closed"
	)

	cases := []struct {
		name string
		comm string
		args string
		want bool
	}{
		{
			name: "desktop app",
			comm: app + "\n",
			args: app + "\n",
			want: true,
		},
		{
			name: "helper process only",
			comm: helper + "\n",
			args: helper + "\n",
			want: false,
		},
		{
			name: "orphaned background service is ignored",
			comm: "/Users/you/Library/Application Support/ai.opencode.desktop/cli/opencode-cli\n",
			args: service + "\n",
			want: false,
		},
		{
			name: "cli tui",
			comm: "/usr/local/bin/opencode\n",
			args: tui + "\n",
			want: true,
		},
		{
			name: "foreground serve",
			comm: "/usr/local/bin/opencode-cli\n",
			args: foreground + "\n",
			want: true,
		},
		{
			name: "this binary",
			comm: "/Users/you/opencode-discord-status/bin/opencode-discord-status\n",
			args: watcher + "\n",
			want: false,
		},
		{
			name: "unrelated processes",
			comm: "/opt/homebrew/bin/node\n/usr/sbin/cfprefsd\n",
			args: "/opt/homebrew/bin/node\n/usr/sbin/cfprefsd\n",
			want: false,
		},
	}

	for _, test := range cases {
		if got := hasOpenCodeCommand(test.comm, test.args); got != test.want {
			t.Errorf("%s: got %v, want %v", test.name, got, test.want)
		}
	}
}

func TestHasOpenCodeImage(t *testing.T) {
	cases := []struct {
		name   string
		output string
		want   bool
	}{
		{
			name:   "windows process",
			output: `"opencode.exe","1234","Console","1","10,000 K"` + "\n",
			want:   true,
		},
		{
			name:   "windows app",
			output: `"OpenCode.exe","1234","Console","1","10,000 K"` + "\n",
			want:   true,
		},
		{
			name:   "windows unrelated",
			output: `"node.exe","1234","Console","1","10,000 K"` + "\n",
			want:   false,
		},
	}

	for _, test := range cases {
		if got := hasOpenCodeImage(test.output); got != test.want {
			t.Errorf("%s: got %v, want %v", test.name, got, test.want)
		}
	}
}
