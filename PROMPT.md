# One command for your agent

Copy this and run it:

```sh
opencode run "Set up Discord Rich Presence for OpenCode from https://github.com/Jerit3787/opencode-discord-status. Read SETUP.md first. Clone it to ~/opencode-discord-status, build with 'go build -trimpath -o bin/opencode-discord-status .', then run './bin/opencode-discord-status' on the machine where Discord runs. Verify with '-once' and '--doctor'. On macOS, add --exit-when-closed and a launchd StartInterval job so it only runs while OpenCode is open."
```

No Discord Application ID is needed: the binary ships with a shared one.

## If you prefer to paste a prompt

The same text works in any coding agent:

> Set up Discord Rich Presence for OpenCode from
> https://github.com/Jerit3787/opencode-discord-status. Read `SETUP.md` first.
> Clone it to `~/opencode-discord-status`, build with
> `go build -trimpath -o bin/opencode-discord-status .`, then run
> `./bin/opencode-discord-status` on the machine where Discord runs. Verify with
> `-once` and `--doctor`. On macOS, add `--exit-when-closed` and a launchd
> `StartInterval` job so it only runs while OpenCode is open.
