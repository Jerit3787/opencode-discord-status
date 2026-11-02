# AGENTS.md

Discord Rich Presence for OpenCode V2. Reads OpenCode's local SQLite database
and publishes the project, model, tokens, and cost to Discord.

## Commands

```sh
go test ./...
go vet ./...
go build -trimpath -o bin/opencode-discord-status .
./bin/opencode-discord-status -once
./bin/opencode-discord-status --doctor
./scripts/build.sh          # cross-compile every platform into bin/
```

Go 1.26+ is required.

## Architecture

- `main.go` — flags, poll loop, Discord connection, card text.
- `opencode.go` — SQL, row parsing, busy/idle, session pick, formatting.
- `lifecycle.go` — detect whether OpenCode is running.
- `discord/` — minimal Discord IPC client, adapted from `cc-discord-presence`.
- `discord/conn_unix.go` / `conn_windows.go` — platform sockets.

## Invariants

- **Database only.** Read `session_v2` and `session_message` from
  `~/.local/share/opencode/opencode.db`. No plugin and no network access.
- **Busy means** the newest assistant message has no `time.completed`/`finish`, or
  `finish: "tool-calls"`. Any other `finish` is idle.
- **Selection:** busy beats idle, then most recently written. Keep the incumbent
  unless another session is at least 10 seconds newer.
- **Lifecycle:** `--exit-when-closed` clears the card and exits when no OpenCode
  process is running. The LaunchAgent uses `StartInterval`, never `KeepAlive`.
- **Elapsed timer:** start it at the latest user message, not the newest
  assistant step. Assistant messages are per-step, so using them resets the
  timer constantly.
- **Discord IPC state is authoritative.** The client marks itself disconnected
  when the socket closes; `updatePresence` checks `Connected()` before dedupe
  and reconnects, then republishes even if the card text is unchanged.
- **SET_ACTIVITY is request/response.** Nonces are tracked; Discord's `ERROR`
  replies must surface. Do not turn it back into fire-and-forget.
- **Discord rate limits.** Token/cost churn is throttled to one update per four
  seconds; busy/idle and project changes bypass the throttle.
- **Privacy:** only the project folder name, model, tokens, and cost leave the
  machine. Never prompts, messages, or code.
- **Discord client:** keep the IPC framing and the adapted MIT notice in
  `THIRD_PARTY_NOTICES.md`.

## Setup

Use the `setup-opencode-discord-status` skill in
`.opencode/skills/setup-opencode-discord-status/SKILL.md`, or `SETUP.md`.
