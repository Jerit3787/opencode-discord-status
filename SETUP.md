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
- Node.js 22.18+ only if you want to run the tests, `doctor`, or the bridge.

## Local install

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

## Remote SSH hosts

When OpenCode runs on an SSH host (for example a server added to the desktop app
over SSH), the plugin runs there. That machine has no Discord socket, so the
plugin writes the card to a file and a bridge on your laptop publishes it.

### 1. Copy the plugin to the host

```sh
rsync -av --exclude node_modules --exclude test --exclude .git \
  /absolute/path/to/opencode-discord-status \
  user@host:~/.config/opencode/plugins/
```

### 2. Configure the host

Edit `~/.config/opencode/opencode.jsonc` on the host. Replace `/home/you` with
the real home directory:

```jsonc
{
  "plugins": [
    {
      "package": "/home/you/.config/opencode/plugins/opencode-discord-status",
      "options": {
        "clientId": "123456789012345678",
        "discord": false,
        "stateFile": "~/.local/state/opencode-discord-status/presence.json"
      }
    }
  ]
}
```

Reconnect the SSH workspace, or run `/reload`, so the host loads the plugin.

### 3. Run the bridge on your laptop

```sh
cd /absolute/path/to/opencode-discord-status
npm run bridge -- --ssh user@host --client-id 123456789012345678
```

- `--port 2222` for a non-default SSH port.
- `--identity ~/.ssh/id_ed25519` when the host is not in `~/.ssh/config`.
- `--ssh-option ProxyJump=bastion` for anything else `ssh -o` accepts.
- `--state <path>` if you changed `stateFile` on the host.
- `--debug` to log the SSH and Discord connections.

The bridge opens one SSH connection, follows the state file, and publishes each
new card. If the tunnel drops it clears the presence and reconnects with backoff.

Check the host is writing:

```sh
ssh user@host 'cat ~/.local/state/opencode-discord-status/presence.json'
```

### 4. Keep it running (macOS)

Create `~/Library/LaunchAgents/dev.opencode.discord-bridge.plist`. Replace the
node path, plugin path, host, and Application ID:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.opencode.discord-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/absolute/path/to/opencode-discord-status/scripts/bridge.ts</string>
    <string>--ssh</string>
    <string>user@host</string>
    <string>--client-id</string>
    <string>123456789012345678</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/opencode-discord-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/opencode-discord-bridge.log</string>
</dict>
</plist>
```

```sh
launchctl load ~/Library/LaunchAgents/dev.opencode.discord-bridge.plist
```

Use `command -v node` for the node path. On Linux, run the same command under
systemd or the equivalent user service manager.

## Configuration reference

| Option | Default | Description |
| --- | --- | --- |
| `clientId` | — | **Required.** Discord Application ID, as a string. |
| `enabled` | `true` | Disable without removing the entry. |
| `discord` | `true` | Publish to a local Discord client. Set `false` on a remote host. |
| `stateFile` | — | Mirror the card to this file for a bridge. |
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
Use ⌘Q. The plugin also clears the card if its host process disappears.

**Remote sessions show nothing** — the host needs `discord: false` **and**
`stateFile`; the bridge must be running on the laptop.

**Presence goes quiet after many restarts** — Discord limits connections per
application ID. The plugin shares one connection per process; quit OpenCode
fully once to release stale ones.

## Uninstall

Remove the plugin entry from `plugins`, then delete the clone if you no longer
need it. On a remote host, remove the copied directory and its entry. If you
installed the LaunchAgent, run:

```sh
launchctl unload ~/Library/LaunchAgents/dev.opencode.discord-bridge.plist
rm ~/Library/LaunchAgents/dev.opencode.discord-bridge.plist
```
