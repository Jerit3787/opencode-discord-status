---
name: Set up opencode-discord-status
description: Use when installing, configuring, or troubleshooting opencode-discord-status (Discord Rich Presence for OpenCode), including remote SSH hosts and the database watcher.
---

# Set up opencode-discord-status

Show OpenCode sessions on Discord: project, model, tokens, and cost.

## Before you start

- OpenCode V2.
- Discord desktop running and signed in on the machine that should show the card.
- A Discord Application ID. If the user has none, send them to
  <https://discord.com/developers/applications> → **New Application** → copy the
  Application ID. No bot token is needed, and the ID is not a secret.

## Preferred: database watcher

No plugin entry, no config edit, no OpenCode restart.

1. Clone the repo:

   ```sh
   git clone https://github.com/Jerit3787/opencode-discord-status.git
   ```

2. Run the watcher on the machine with Discord:

   ```sh
   cd opencode-discord-status
   npm run watch -- --client-id 123456789012345678
   ```

   For an SSH workspace, run it on the laptop and point it at the host:

   ```sh
   npm run watch -- --ssh user@host --client-id 123456789012345678
   ```

   Add `--port`, `--identity`, or `--ssh-option ProxyJump=bastion` if needed.
   The host needs `sqlite3` or `python3`; the remote loop tries both.

3. Verify: the card should appear within two seconds. `--debug` logs the SSH and
   Discord connections. In Discord, enable **User Settings → Activity Privacy →
   Display current activity as a status message**.

The watcher reads `~/.local/share/opencode/opencode.db`:

- `session_v2` supplies directory, model, agent, cost, and tokens.
- The newest `session_message` supplies `time.completed` and `finish`.
- Missing `completed`/`finish`, or `finish: "tool-calls"`, means busy.
- Any other `finish` means idle.

The schema is internal. If a major OpenCode upgrade changes it, use the plugin.

## Plugin install (optional)

Use this when the user wants instant updates or prefers the event surface.

1. Clone as above.
2. Back up and edit `~/.config/opencode/opencode.jsonc` (respect
   `$XDG_CONFIG_HOME`):

   ```jsonc
   {
     "plugins": [
       {
         "package": "/absolute/path/to/opencode-discord-status",
         "options": { "clientId": "123456789012345678" }
       }
     ]
   }
   ```

   Preserve existing entries. Keep `clientId` a **string** of 17–20 digits. If
   the file has comments, edit it as text.

3. Save; OpenCode reloads config automatically. `/reload` forces it.
4. Verify with `opencode plugin list` and
   `npm run doctor -- 123456789012345678`.

### Remote plugin

Only when the user explicitly wants the plugin on an SSH host:

1. `rsync -av --exclude node_modules --exclude test --exclude .git`
   `./opencode-discord-status user@host:~/.config/opencode/plugins/`
2. On the host, configure `discord: false` and
   `stateFile: "~/.local/state/opencode-discord-status/presence.json"`.
3. On the laptop, run
   `npm run bridge -- --ssh user@host --client-id 123456789012345678`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Installing the plugin when the watcher is enough | Prefer `npm run watch`; it needs no config. |
| Running the watcher on the SSH host | Run it where Discord is, and add `--ssh host`. |
| Remote host has no `sqlite3` | The loop falls back to `python3`; install one. |
| Using `plugin` instead of `plugins` | V2 uses `plugins`; keep existing entries. |
| Unquoted `clientId` | Must be a string; 18-digit numbers lose precision. |
| Card stays after quitting | macOS: use ⌘Q; closing the window is not quitting. |

## Verify the result

- Watcher: `--debug` shows `ssh <host>` and `Connected to Discord`.
- Plugin: `opencode plugin list` lists it.
- `grep "opencode-discord-status" ~/.local/share/opencode/log/opencode.log`
  shows no errors.
- If nothing appears, check Discord Activity Privacy first.
