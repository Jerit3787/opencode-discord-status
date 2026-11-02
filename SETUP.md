# Setup

This guide is written so a person or an OpenCode agent can follow it top to
bottom. If you are an agent working in this repository, the
`setup-opencode-discord-status` skill in `.opencode/skills/` is the short form.

## Requirements

- OpenCode V2. Configuration uses `plugins`; the older `plugin` key is deprecated.
- The Discord desktop app, running and signed in, on the machine that should show
  the card.
- A Discord Application ID. Create one at
  <https://discord.com/developers/applications> → **New Application**, then copy
  the Application ID from **General Information**. No bot token is needed.
- Node.js 22.18+ only if you want to run the tests, `doctor`, or `watch`.

## Database watcher (simplest)

No plugin entry and no config edit.

```sh
cd /path/to/opencode-discord-status
npm run watch -- --client-id 123456789012345678
```

Options: `--interval <ms>`, `--idle-after <seconds>`, `--db <path>`,
`--exit-when-closed`, `--debug`.

Every two seconds it runs a read-only query against
`~/.local/share/opencode/opencode.db`. It reads `session_v2` and the newest
`session_message`:

- no `time.completed` and no `finish` → streaming, **busy**
- `finish: "tool-calls"` → waiting on tools, **busy**
- any other `finish` → **idle**
- no writes for `--idle-after` (default 15 minutes) → **idle**

This reads OpenCode's internal schema, so a major upgrade can change it. The
plugin below uses the event stream and reacts instantly; use it if you prefer
that surface.

### Run only while OpenCode is open (macOS)

`--exit-when-closed` clears the card and exits when no OpenCode process is
running. Pair it with `StartInterval` so launchd checks for OpenCode every 15
seconds instead of keeping a stale process alive.

Create `~/Library/LaunchAgents/dev.opencode.discord-watch.plist`. Replace the
node path, repo path, and Application ID:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.opencode.discord-watch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/absolute/path/to/opencode-discord-status/scripts/watch.ts</string>
    <string>--client-id</string>
    <string>123456789012345678</string>
    <string>--exit-when-closed</string>
    <string>--debug</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>15</integer>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/opencode-discord-watch.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/opencode-discord-watch.log</string>
</dict>
</plist>
```

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.opencode.discord-watch.plist
```

Use `command -v node` for the node path. On Linux, run the same command under
systemd or the equivalent user service manager.

## Plugin install (optional)

### 1. Get the plugin

```sh
git clone https://github.com/Jerit3787/opencode-discord-status.git
```

Put it somewhere stable. OpenCode loads the directory directly; there is no build
step and the plugin has no runtime dependencies.

### 2. Add it to the global config

Config lives at `~/.config/opencode/opencode.jsonc` (or `opencode.json`, or under
`$XDG_CONFIG_HOME`). Back it up first.

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-discord-status",
      "options": {
        "clientId": "123456789012345678"
      }
    }
  ]
}
```

Rules:

- Keep every entry already in `plugins`.
- `clientId` is a **string**. Discord IDs are too large for JavaScript numbers.
- If the file has comments, edit it as text. Do not parse and re-serialize it.

OpenCode watches config files and reloads plugins after a save. `/reload` forces
a reload.

### 3. Verify

```sh
opencode plugin list
```

The plugin should appear as `local` with its path. Then check the Discord path:

```sh
cd /absolute/path/to/opencode-discord-status
npm run doctor -- 123456789012345678
```

`doctor` connects to Discord, sets a test card for eight seconds, and clears it.

Finally, in Discord open **User Settings → Activity Privacy** and enable
**Display current activity as a status message**.

## Configuration reference

| Option | Default | Description |
| --- | --- | --- |
| `clientId` | — | **Required.** Discord Application ID, as a string. |
| `enabled` | `true` | Disable without removing the entry. |
| `details` | `{project}` | Top line while working. |
| `state` | `{model} · {tokens} · {cost}` | Bottom line while working. |
| `idleDetails` | `Idle` | Top line while idle. |
| `idleState` | `{project} · {tokens} · {cost}` | Bottom line while idle. |
| `showElapsed` | `true` | Elapsed timer while working. |
| `largeImage` / `smallImage` | — | Discord asset keys. |
| `largeText` | `OpenCode` | Hover text for the large image. |
| `buttons` | `[]` | Up to two `{ label, url }` buttons. |
| `minUpdateIntervalMs` | `4000` | Discord rate-limit guard. |
| `reconnect` | `true` | Retry the Discord connection. |
| `debug` | `false` | Log connection details. |

Template variables: `{project}`, `{sessionTitle}`, `{model}`, `{agent}`,
`{status}`, `{attempt}`, `{tokens}`, `{tokenCount}`, `{cost}`.

## Troubleshooting

**The plugin is not listed** — check the `plugins` key (not `plugin`), the
`package` path, and that `index.ts` exists at the root of that path. Run
`/reload`.

**`Discord is not reachable`** — start the Discord desktop app and sign in. The
plugin retries with backoff.

**Card is set but not visible** — enable **Display current activity as a status
message** in Discord's Activity Privacy settings.

**Card stays after quitting** — on macOS, closing the window is not quitting.
Use ⌘Q. The watcher's `--exit-when-closed` clears the card when OpenCode stops;
the plugin clears it when its host process disappears.

**Presence goes quiet after many restarts** — Discord limits connections per
application ID. The plugin shares one connection per process; quit OpenCode
fully once to release stale ones.

## Uninstall

Remove the plugin entry from `plugins`, then delete the clone if you no longer
need it. If you installed the watcher LaunchAgent, run:

```sh
launchctl bootout gui/$(id -u)/dev.opencode.discord-watch
rm ~/Library/LaunchAgents/dev.opencode.discord-watch.plist
```
