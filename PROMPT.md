# One command for your agent

Copy this and run it:

```sh
opencode run "Set up Discord Rich Presence for OpenCode from https://github.com/Jerit3787/opencode-discord-status. Read SETUP.md first. Clone it to ~/opencode-discord-status, build with 'go build -trimpath -o bin/opencode-discord-status .', then add the repo's autostart plugin to the global plugins list and start OpenCode. Verify with '-once' and '--doctor'."
```

No Discord Application ID is needed: the binary ships with a shared one.

## If you prefer to paste a prompt

The same text works in any coding agent:

> Set up Discord Rich Presence for OpenCode from
> https://github.com/Jerit3787/opencode-discord-status. Read `SETUP.md` first.
> Clone it to `~/opencode-discord-status`, build with
> `go build -trimpath -o bin/opencode-discord-status .`, then add the repo's
> `autostart` plugin to the global `plugins` list and start OpenCode. Verify with
> `-once` and `--doctor`.
