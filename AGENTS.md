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

cd gui && npm test
cd gui && npm run typecheck && npm run build
```

Go 1.26+ is required. The GUI plugin needs Node and the dependencies in
`gui/package.json`.

## Architecture

- `main.go` — flags, poll loop, Discord connection, settings reload, card text.
- `settings.go` — config schema, defaults, tolerant loader, config dir.
- `status.go` — status snapshot and atomic writer for the GUI.
- `opencode.go` — SQL, row parsing, busy/idle, session pick, formatting.
- `lifecycle.go` — detect whether OpenCode is running.
- `autostart/index.ts` — OpenCode plugin that starts and stops the watcher.
- `gui/` — OpenCode Desktop GUI plugin: settings page, IPC bridge, preview.
- `discord/` — minimal Discord IPC client, adapted from `cc-discord-presence`.
- `discord/conn_unix.go` / `conn_windows.go` — platform sockets.

## Invariants

- **Database only.** Read `session_v2` and `session_message` from
  `~/.local/share/opencode/opencode.db`. No plugin and no network access.
- **Busy means** the newest assistant message has no `time.completed`/`finish`, or
  `finish: "tool-calls"`. Any other `finish` is idle.
- **Selection:** busy beats idle, then most recently written. Keep the incumbent
  unless another session is at least 10 seconds newer.
- **Lifecycle:** the `autostart` plugin supervises
  `bin/opencode-discord-status --exit-when-closed`; it starts it with OpenCode
  and kills it on exit. Ignore `opencode-cli serve --service`; it can outlive
  the app. Do not reintroduce a launchd job.
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
- **Cost:** prefer OpenCode's session cost. When it is zero, estimate it from the
  OpenCode Console's per-model average cost (cache included) and mark the card
  value with `~`. Do not present the estimate as a charge.
- **Privacy:** only the project folder name, model, tokens, and cost leave the
  machine. Never prompts, messages, or code. Private mode hides the project from
  both Discord and the settings preview.
- **Config:** `config.json` lives under the platform config dir
  (`os.UserConfigDir()/opencode-discord-status`). The daemon reloads on mtime
  change, applies valid fields, and reports partial parse errors without
  discarding the rest. Missing files mean the defaults.
- **Status:** `status.json` is written atomically every poll (mode `0600`) and
  includes enabled, Discord connectivity, project, model, tokens, cost, busy,
  started time, and daemon version. The GUI treats status older than 10 seconds
  as not reporting.
- **Disabling:** `enabled=false` clears the card once and keeps the connection
  and daemon alive for an instant re-enable. It does not stop the watcher.
- **Autostart:** `autostart` is persisted in the same config. The `autostart`
  plugin polls it every two seconds: false stops the supervised child, true
  starts it when OpenCode is running. Plugin reloads re-arm the supervisor
  without duplicating the child.
- **GUI contract:** package `opencode-discord-status-gui`, Ipc
  `opencode-discord-status-gui.settings`, page id `opencode-discord-status`.
  The GUI never reads the database or Discord directly.
- **Discord client:** keep the IPC framing and the adapted MIT notice in
  `THIRD_PARTY_NOTICES.md`.

## Setup

Use the `setup-opencode-discord-status` skill in
`.opencode/skills/setup-opencode-discord-status/SKILL.md`, or `SETUP.md`.
