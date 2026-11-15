# opencode-discord-status GUI

An OpenCode Desktop plugin that adds **Settings → Discord Presence** for the
`opencode-discord-status` daemon in this repository.

## Requirements

- OpenCode Desktop 2.2.5 or newer with the experimental GUI plugin API.
- The `opencode-discord-status` daemon and its `autostart` plugin from this
  repository.

## Build

```sh
npm install
npm run build
```

The build writes `dist/gui-experimental.cjs`, committed so a local path install
works without a build step.

## Install

Add this directory (absolute path) to the `plugins` array in
`~/.config/opencode/opencode.jsonc`, next to the `autostart` entry:

```jsonc
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-discord-status/autostart", "options": {} },
    "/absolute/path/to/opencode-discord-status/gui"
  ]
}
```

Open **Settings → Discord Presence**, or run **OpenCode Discord presence
settings** from the command palette.

## What it controls

- **Enable Discord presence** — off clears the card immediately without stopping
  the daemon; on restores it without restarting OpenCode.
- **Start with OpenCode** — launch the daemon automatically. Turning it off
  stops the supervised daemon; turning it on starts it immediately. This choice
  persists across restarts.
- **Project name / Model / Token count / Estimated cost / Elapsed time** — pick
  the parts shown on the card.
- **Private mode** — replaces the project with `a session` and hides it from the
  idle state line.

The daemon reloads the config on its next poll. The page polls status every 3
seconds and treats status older than 10 seconds as not reporting. The master
switch persists: if presence was off at shutdown, the next OpenCode launch
starts the daemon disabled and it does not connect to Discord; if it was on, the
daemon connects and publishes immediately.

## Files

The daemon owns the format. The plugin only reads/writes these files:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/opencode-discord-status/` |
| Linux | `$XDG_CONFIG_HOME/opencode-discord-status/` (or `~/.config/...`) |
| Windows | `%APPDATA%\opencode-discord-status\` |

- `config.json` — written by this page, watched by the daemon.
- `status.json` — written by the daemon, read by this page.

Both are written atomically with mode `0600`. The plugin makes no network
requests, runs no shell commands, and reads no credentials.

## Development

```sh
npm test
npm run typecheck
npm run build
```

Tests cover tolerant config parsing, preview formatting, cloud-free field
toggles, private mode, and stale status handling.
