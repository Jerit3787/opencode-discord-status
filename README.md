# opencode-discord-status

[![CI](https://github.com/Jerit3787/opencode-discord-status/actions/workflows/ci.yml/badge.svg)](https://github.com/Jerit3787/opencode-discord-status/actions/workflows/ci.yml)

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

### 1. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and choose **New Application**.
2. Name it **OpenCode** (Discord displays `Playing <application name>`).
3. Copy the **Application ID** from **General Information**.

### 2. Build and run

```sh
git clone https://github.com/Jerit3787/opencode-discord-status.git
cd opencode-discord-status
go build -trimpath -o bin/opencode-discord-status .
./bin/opencode-discord-status --client-id 123456789012345678
```

OpenCode and Discord must be running on the same machine.

### 3. Verify

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

`--exit-when-closed` clears the card and exits when no OpenCode process is
running. Pair it with a launchd job using `StartInterval`, not `KeepAlive`, so
launchd checks for OpenCode every 15 seconds:

```sh
./bin/opencode-discord-status --client-id 123456789012345678 --exit-when-closed
```

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
| `--client-id` | `$DISCORD_CLIENT_ID` | **Required.** Discord Application ID. |
| `--db` | `~/.local/share/opencode/opencode.db` | OpenCode database. |
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
  `SET_ACTIVITY` over the local socket. It reconnects once if Discord restarts.
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
