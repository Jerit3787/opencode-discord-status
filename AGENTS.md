# AGENTS.md

Discord Rich Presence for OpenCode V2. Shows project, model, tokens, and cost on
the user's Discord profile.

## Commands

```sh
npm test                  # 94 tests, node:test
npm run typecheck         # tsc --noEmit
npm run doctor -- <id>    # live Discord check: sets a card for 8s, then clears
npm run watch -- --client-id <id>                 # database watcher (recommended)
npm run watch -- --client-id <id> --exit-when-closed   # stop with OpenCode
```

Node 22.18+ is required for native TypeScript execution.

## Architecture

- `index.ts` — package entry, re-exports `src/index.ts`.
- `src/index.ts` — plugin setup, global per-client hub registry, event subscription.
- `src/presence.ts` — session state machine, event → snapshot, template variables.
- `src/db-presence.ts` — SQL + row → snapshot for the database watcher.
- `src/opencode-db.ts` — read OpenCode's local SQLite database.
- `src/lifecycle.ts` — detect whether OpenCode is running.
- `scripts/watch.ts` — database watcher; the recommended path.
- `src/activity.ts` — rendering, token/cost formatting, Discord payload.
- `src/hub.ts` — one card per process: elects between open projects and owns the connection.
- `src/discord/` — zero-dependency Discord IPC client.

## Invariants

- **Database watcher is the simple path.** It reads `session_v2` +
  `session_message` from `~/.local/share/opencode/opencode.db`. Busy means the
  newest assistant message has no `time.completed`/`finish`, or
  `finish: "tool-calls"`. A busy session beats a newer idle one.
- **Lifecycle belongs to OpenCode.** `--exit-when-closed` clears the card and
  exits when no OpenCode process is running; the LaunchAgent uses
  `StartInterval`, not `KeepAlive`.
- **V2 event names matter.** The plugin is driven by `session.step.started`,
  `session.step.ended`, and `session.usage.updated`. `session.step.ended` with
  `finish: "tool-calls"` means the turn continues; any other finish ends it.
  The older `session.execution.*` and `session.status` events remain as
  compatibility fallbacks, not the primary source.
- **One Discord connection per process.** The hub lives on `globalThis` keyed by
  client id, so hot reloads and multiple project instances reuse it.
- **No runtime dependencies.** `index.ts` and `src/` must load without
  `node_modules`; only `import type` may reference `@opencode/plugin`.
- **Local only.** Everything is the SQLite file and the Discord IPC socket. Do
  not add a network transport.
- **Privacy:** session titles are opt-in (`{sessionTitle}`). Never add prompts,
  message content, or code to the activity.

## Setup work

Use the `setup-opencode-discord-status` skill in
`.opencode/skills/setup-opencode-discord-status/SKILL.md`, or the full guide in
`SETUP.md`. Prefer `npm run watch`; the plugin is the optional event-driven path.
