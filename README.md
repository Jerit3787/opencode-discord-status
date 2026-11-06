# opencode-discord-status

[![CI](https://github.com/Jerit3787/opencode-discord-status/actions/workflows/ci.yml/badge.svg)](https://github.com/Jerit3787/opencode-discord-status/actions/workflows/ci.yml)

![opencode-discord-status](assets/preview.jpg)

Discord Rich Presence for [OpenCode](https://opencode.ai). Your Discord profile
shows the project you are in, the model doing the work, the token count, and the
session cost.

```
Playing OpenCode
Working on: opencode-discord-status
DeepSeek V4.1 Flash | 12.3K tokens | $0.0421
```

It reads OpenCode's local SQLite database and talks to the Discord desktop app
over its local IPC socket. No plugin, no server connection, no bot token, and no
network traffic.

Full setup: **[SETUP.md](SETUP.md)**. OpenCode agents can load the
`setup-opencode-discord-status` skill in `.opencode/skills/`.

## Quick start

### 1. Build and run

```sh
git clone https://github.com/Jerit3787/opencode-discord-status.git
cd opencode-discord-status
go build -trimpath -o bin/opencode-discord-status .
./bin/opencode-discord-status
```

It ships with a shared Discord application ID, so there is nothing to configure.
OpenCode and Discord must be running on the same machine.

To use your own application name instead, create one at the
[Discord Developer Portal](https://discord.com/developers/applications) and pass
`--client-id`.

### 2. Verify

```sh
./bin/opencode-discord-status -once
```

That prints the card it would publish, without touching Discord:

```
Working on: opencode-discord-status
DeepSeek V4.1 Flash | 12.3K tokens | $0.0421
```

In Discord, enable **User Settings → Activity Privacy → Display current activity
as a status message**.

## Run only while OpenCode is open

Add the `autostart` plugin to the global `plugins` array:

```jsonc
{
  "package": "/absolute/path/to/opencode-discord-status/autostart",
  "options": {}
}
```

OpenCode starts the watcher when it starts and kills it when it exits. There is
no launchd job, and no `opencode-discord-status` process exists while OpenCode
is closed. The plugin checks every two seconds and restarts the watcher if it
crashes.

The watcher is started with `--exit-when-closed`, so it also clears the card and
exits if it is ever orphaned. The desktop app's `opencode-cli serve --service`
child is ignored because it can outlive the app; on macOS, closing the window is
not quitting — use ⌘Q.

See [SETUP.md](SETUP.md) for the LaunchAgent.

## What it reads

`~/.local/share/opencode/opencode.db` (SQLite), from the V2 tables:

| Table | Supplies |
| --- | --- |
| `session_v2` | directory, model, agent, cost, tokens, last update |
| `session_message` | the last assistant message: `time.completed` and `finish` |

Busy and idle:

- no `time.completed` and no `finish` → streaming, **busy**
- `finish: "tool-calls"` → waiting on tools, **busy**
- any other `finish` → **idle**
- no writes for `--idle-after` (default 15 minutes) → **idle**

When several sessions are open, a busy session beats an idle one, then the most
recently written wins. The session already on the card is kept unless another is
clearly newer (10 seconds), so the card does not flicker between two active
projects.

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--client-id` | shared app ID | Override with your own Discord Application ID (or `DISCORD_CLIENT_ID`). |
| `--db` | `~/.local/share/opencode/opencode.db` | OpenCode database (`OPENCODE_DB`, then `XDG_DATA_HOME`). |
| `--interval` | `2s` | Poll interval. |
| `--idle-after` | `15m` | Treat a session with no writes for this long as idle. |
| `--exit-when-closed` | `false` | Clear and exit when OpenCode is not running. |
| `--debug` | `false` | Log each published card. |
| `--doctor` | `false` | Set a test card for 8 seconds, then clear it. |
| `--once` | `false` | Print the current card and exit. |

## How it works

- A Go daemon reads the SQLite database with `modernc.org/sqlite` (pure Go, no cgo).
- The last assistant message decides busy/idle; the session row supplies model,
  agent, tokens, and cost.
- A small Discord IPC client performs the `v: 1` handshake and sends
  `SET_ACTIVITY` over the local socket. It reconnects when Discord restarts,
  answers PINGs, and surfaces Discord's errors instead of dropping them.
- Token/cost churn is throttled to one update every four seconds; busy/idle and
  project changes go immediately.
- No plugin entry and no OpenCode restart are needed.

## Development

Requires Go 1.26+.

```sh
go test ./...
go vet ./...
go build -trimpath -o bin/opencode-discord-status .
```

`scripts/build.sh` cross-compiles darwin, linux, and windows binaries into
`bin/`.

## License

MIT. The Discord IPC client in `discord/` is adapted from
[cc-discord-presence](https://github.com/tsanva/cc-discord-presence); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
