package main

import "testing"

func TestHasOpenCodeProcess(t *testing.T) {
	cases := []struct {
		name   string
		output string
		want   bool
	}{
		{
			name:   "desktop app",
			output: "/Applications/OpenCode.app/Contents/MacOS/OpenCode\n",
			want:   true,
		},
		{
			name:   "background service",
			output: "/Users/you/Library/Application Support/ai.opencode.desktop/cli/opencode-cli\n",
			want:   true,
		},
		{
			name:   "cli",
			output: "opencode\n",
			want:   true,
		},
		{
			name:   "windows process",
			output: `"opencode.exe","1234","Console","1","10,000 K"` + "\n",
			want:   true,
		},
		{
			name:   "windows unrelated",
			output: `"node.exe","1234","Console","1","10,000 K"` + "\n",
			want:   false,
		},
		{
			name:   "unrelated",
			output: "/usr/sbin/cfprefsd\n/opt/homebrew/bin/node\n",
			want:   false,
		},
		{
			name:   "this project's path is not a process name",
			output: "/Users/you/Documents/opencode-discord-status/scripts/watch.ts\n",
			want:   false,
		},
		{
			name:   "helper process",
			output: "/Applications/OpenCode.app/Contents/Frameworks/OpenCode Helper.app/Contents/MacOS/OpenCode Helper\n",
			want:   false,
		},
	}

	for _, test := range cases {
		if got := hasOpenCodeProcess(test.output); got != test.want {
			t.Errorf("%s: hasOpenCodeProcess() = %v, want %v", test.name, got, test.want)
		}
	}
}
