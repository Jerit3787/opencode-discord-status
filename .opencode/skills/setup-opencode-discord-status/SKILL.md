---
name: Set up opencode-discord-status
description: Use when installing, configuring, or troubleshooting opencode-discord-status (Discord Rich Presence for OpenCode), including remote SSH hosts and the local bridge.
---

# Set up opencode-discord-status

Show OpenCode sessions on Discord: project, model, tokens, and cost.

## Before you start

- OpenCode V2. Its config uses `plugins`; the old `plugin` key is deprecated.
- Discord desktop running and signed in on the machine that should show the card.
- A Discord Application ID. If the user has none, send them to
  <https://discord.com/developers/applications> → **New Application** → copy the
  Application ID. No bot token is needed, and the ID is not a secret.

## Decide the topology

1. **Local** — OpenCode and Discord run on the same machine. Use the local install.
2. **Remote SSH** — OpenCode runs on a host reached over SSH and Discord runs on
   the laptop. Use the remote install.

If unsure, compare `hostname` on the machine running OpenCode with the machine
running Discord. A remote session has no Discord socket, so a local install
there will only log `Discord is not reachable`.

## Local install

1. Clone the plugin somewhere stable:

   ```sh
   git clone https://github.com/Jerit3787/opencode-discord-status.git
   ```

2. Back up and edit the global config — `~/.config/opencode/opencode.jsonc`
   (respect `$XDG_CONFIG_HOME`; the file may be `.json`):

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

   - Preserve every existing entry in `plugins`.
   - Keep `clientId` a **string** of 17–20 digits.
   - If the file contains comments, edit it as text; do not
     `JSON.parse`/`JSON.stringify` it.

3. Save. OpenCode reloads config automatically; `/reload` forces a reload.

4. Verify:

   ```sh
   opencode plugin list    # should list opencode-discord-status
   cd /absolute/path/to/opencode-discord-status
   npm run doctor -- 123456789012345678
   ```

   `doctor` sets a test presence for eight seconds.

5. In Discord: **User Settings → Activity Privacy → Display current activity as
   a status message**.

Done when a session shows the project over `<model> · <tokens> · <cost>`.

## Remote SSH install

The plugin runs on the SSH host. Discord lives on the laptop, so the host writes
a state file and a bridge on the laptop publishes it.

1. On the laptop, copy the plugin to the host:

   ```sh
   rsync -av --exclude node_modules --exclude test --exclude .git \
     /absolute/path/to/opencode-discord-status \
     user@host:~/.config/opencode/plugins/
   ```

2. On the host, add to `~/.config/opencode/opencode.jsonc` (replace
   `/home/you` with the real home):

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

   Reconnect the SSH workspace (or `/reload`) so the host loads it.

3. On the laptop, run the bridge:

   ```sh
   cd /absolute/path/to/opencode-discord-status
   npm run bridge -- --ssh user@host --client-id 123456789012345678
   ```

   Add `--port`, `--identity`, or `--ssh-option ProxyJump=bastion` if needed.

4. Verify on the host:

   ```sh
   ssh user@host 'cat ~/.local/state/opencode-discord-status/presence.json'
   ```

   It should print a JSON frame. Run the bridge with `--debug` to see the SSH
   and Discord connection. The bridge clears the card when the tunnel drops and
   reconnects with backoff.

For login-time autostart, see the LaunchAgent section of `SETUP.md`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Using `plugin` instead of `plugins` | V2 uses `plugins`; keep existing entries intact. |
| Unquoted `clientId` | Must be a string; JavaScript loses precision on 18-digit numbers. |
| Remote install without the bridge | The host has no Discord socket; run the bridge on the laptop. |
| Bridge but no `stateFile` on the host | Set `discord: false` **and** `stateFile`. |
| Card stays after quitting | On macOS, closing the window is not quitting. Use ⌘Q. |

## Verify the result

- `opencode plugin list` lists the plugin.
- `grep "opencode-discord-status" ~/.local/share/opencode/log/opencode.log`
  shows no connection errors.
- One Discord IPC connection per OpenCode process is expected.
- If nothing appears, check Activity Privacy before anything else.
