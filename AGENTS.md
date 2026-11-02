# AGENTS.md

Discord Rich Presence plugin for OpenCode V2. Shows project, model, tokens, and
cost on the user's Discord profile.

## Commands

```sh
npm test                  # 94 tests, node:test
npm run typecheck         # tsc --noEmit
npm run doctor -- <id>    # live Discord check: sets a card for 8s, then clears
npm run bridge -- --ssh <host> --client-id <id>   # remote SSH relay
```

Node 22.18+ is required for native TypeScript execution.

## Architecture

- `index.ts` — package entry, re-exports `src/index.ts`.
- `src/index.ts` — plugin setup, global per-client hub registry, event subscription.
- `src/presence.ts` — session state machine, event → snapshot, template variables.
- `src/activity.ts` — rendering, token/cost formatting, Discord payload.
- `src/hub.ts` — one card per process: elects between open projects, mirrors to a state file, owns the transport.
- `src/state-file.ts` — atomic JSON frame writer for remote hosts.
- `src/bridge.ts` + `scripts/bridge.ts` — SSH relay from a remote host to local Discord.
- `src/discord/` — zero-dependency Discord IPC client.

## Invariants

- **V2 event names matter.** The card is driven by `session.step.started`,
  `session.step.ended`, and `session.usage.updated`. `session.step.ended` with
  `finish: "tool-calls"` means the turn continues; any other finish ends it.
  The older `session.execution.*` and `session.status` events remain as
  compatibility fallbacks, not the primary source.
- **One Discord connection per process.** The hub lives on `globalThis` keyed by
  client id, so hot reloads and multiple project instances reuse it.
- **No runtime dependencies.** `index.ts` and `src/` must load without
  `node_modules`; only `import type` may reference `@opencode/plugin`.
- **`discord: false` requires `stateFile`.** Config validation rejects the
  combination where nothing would be published.
- **Privacy:** session titles are opt-in (`{sessionTitle}`). Never add prompts,
  message content, or code to the activity or the state file.

## Setup work

Use the `setup-opencode-discord-status` skill in
`.opencode/skills/setup-opencode-discord-status/SKILL.md`, or the full guide in
`SETUP.md`.
