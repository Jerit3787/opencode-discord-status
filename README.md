# opencode-discord-status

[![CI](https://github.com/Jerit3787/opencode-discord-status/actions/workflows/ci.yml/badge.svg)](https://github.com/Jerit3787/opencode-discord-status/actions/workflows/ci.yml)

Discord Rich Presence for [OpenCode](https://opencode.ai). Your Discord profile shows the project you are in, the model doing the work, and how long the current turn has been running.

```
Playing OpenCode
opencode-discord-status
DeepSeek V4.1 Flash · 12.3K tokens · $0.0421
00:42 elapsed
```

It talks to the Discord desktop app over its local IPC socket. There is no bot token, no OAuth, and no network traffic.

Full setup, remote SSH hosts, and troubleshooting: **[SETUP.md](SETUP.md)**. OpenCode agents can load the `setup-opencode-discord-status` skill in `.opencode/skills/`.

## One command for your agent

Replace the Application ID and run:

```sh
opencode run "Set up Discord Rich Presence for OpenCode from https://github.com/Jerit3787/opencode-discord-status using Discord Application ID <YOUR_APPLICATION_ID>. Use the database watcher, not the plugin. Read SETUP.md first. Clone it to ~/.config/opencode/plugins/opencode-discord-status and run 'npm run watch -- --client-id <YOUR_APPLICATION_ID>' on the machine where Discord runs. If this workspace is on a remote SSH host, give me the exact command to run on my laptop with --ssh. Verify the card appears before saying it is done."
```

See **[PROMPT.md](PROMPT.md)** for the paste-into-any-agent version.

## Simplest: watch the database

No plugin entry, no config edit, no remote install.

```sh
cd /path/to/opencode-discord-status
npm run watch -- --client-id 123456789012345678
```

For a remote SSH workspace, read that host's database instead:

```sh
npm run watch -- --ssh user@host --client-id 123456789012345678
```

It polls `~/.local/share/opencode/opencode.db` every two seconds, picks the
newest session, and derives busy/idle from the last assistant message. On a
remote host it needs `sqlite3` or `python3`; the loop tries both.

This reads OpenCode's internal schema, so a major upgrade can change it. The
plugin below uses the event stream instead and is the better choice if you want
the card to react instantly.

## Quick start (plugin)

### 1. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and choose **New Application**.
2. Name it **OpenCode** (or anything else — Discord displays `Playing <application name>`).
3. Copy the **Application ID** from **General Information**.

Your Discord desktop app must be running on the same machine as OpenCode.

### 2. Add the plugin to OpenCode

In your project's `opencode.json` / `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./opencode-discord-status",
      "options": {
        "clientId": "123456789012345678"
      }
    }
  ]
}
```

Use an absolute path (`"/Users/you/opencode-discord-status"`) if the plugin lives outside the project, or publish the package and use its name. A local path must point at the plugin directory: OpenCode loads its root `index.ts`.

There is no build step and no runtime dependency, so `npm install` is only needed to run the tests, `doctor`, or the bridge.

`clientId` must be a string. Discord IDs are larger than JavaScript's safe integer range, so an unquoted number silently loses digits.

Optional logo: in the Discord Developer Portal open **Rich Presence → Art Assets**, upload an image, and name the asset `opencode`. Then add:

```jsonc
"largeImage": "opencode",
"largeText": "OpenCode"
```

### 3. Reload the config

OpenCode watches config files and reloads plugins after a save; `/reload` forces it. The status should appear within a few seconds. Verify the Discord side independently with:

```sh
npm run doctor -- 123456789012345678
```

This sets a test presence for eight seconds and then clears it.

## What gets shown

| State | Line 1 (`details`) | Line 2 (`state`) | Timer |
| --- | --- | --- | --- |
| Working | project folder name | model · tokens · cost | elapsed time |
| Idle | `Idle` | project · tokens · cost | hidden |

For example, a busy session reads `opencode-discord-status` over
`DeepSeek V4.1 Flash · 12.3K tokens · $0.0421`.

Defaults are deliberately boring and private: the session title is **not** shown. To show it:

```jsonc
{
  "details": "Working on {project}",
  "state": "{sessionTitle}"
}
```

Token and cost totals come from OpenCode's own session accounting and refresh
each time a run finishes, so the numbers on the card track the session rather
than the whole machine.

## Remote SSH hosts

Discord's IPC socket only exists on the machine where Discord runs. When
OpenCode runs on a remote host — for example a server added to the desktop app
over SSH — the plugin there cannot reach your laptop's Discord.

It can still publish the card by writing it to a small state file, which a
bridge on your Mac reads over SSH.

**1. Copy the plugin to the remote host.** It has no runtime dependencies, so
no `npm install` is needed:

```sh
rsync -av --exclude node_modules --exclude test \
  ./opencode-discord-status user@host:~/.config/opencode/plugins/
```

**2. On the remote host, load it without Discord and with a state file**
(replace `/home/you` with the real home directory):

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

**3. On your Mac, run the bridge:**

```sh
npm run bridge -- --ssh user@host --client-id 123456789012345678
```

Add `--port`, `--identity`, or `--ssh-option ProxyJump=bastion` if your host
needs them. The bridge opens one SSH connection, follows the state file, and
publishes each new card. If the tunnel drops it clears the presence and
reconnects with backoff.

The state file holds only the text Discord would have shown — project, model,
tokens, cost — never prompts, messages, or code.

## Configuration

All options live under the plugin's `options` object.

| Option | Default | Description |
| --- | --- | --- |
| `clientId` | — | **Required.** Discord Application ID, as a string. |
| `enabled` | `true` | Set to `false` to disable without removing the plugin. |
| `discord` | `true` | Publish to a Discord client on this machine. Set to `false` on a remote host. |
| `stateFile` | — | Mirror the card to this file so a bridge can read it over SSH. |
| `details` | `{project}` | Top line while working. |
| `state` | `{model} · {tokens} · {cost}` | Bottom line while working. |
| `idleDetails` | `Idle` | Top line while idle. |
| `idleState` | `{project} · {tokens} · {cost}` | Bottom line while idle. |
| `showElapsed` | `true` | Show the elapsed timer while working. |
| `largeImage` | — | Discord asset key for the large image. |
| `largeText` | `OpenCode` | Hover text for the large image. |
| `smallImage` | — | Discord asset key for the small image. |
| `smallText` | — | Hover text for the small image. |
| `buttons` | `[]` | Up to two `{ "label": "...", "url": "https://..." }` buttons. |
| `minUpdateIntervalMs` | `4000` | Minimum gap between presence updates, clamped to 1000–60000. Values below ~4000 may hit Discord's rate limit. |
| `reconnect` | `true` | Keep retrying while Discord is closed. |
| `debug` | `false` | Log connection and event details. |

### Template variables

`details`, `state`, `idleDetails`, and `idleState` support:

- `{project}` — project folder name
- `{sessionTitle}` — current session title
- `{model}` — model display name
- `{tokens}` — session token count with its label, e.g. `12.3K tokens`
- `{tokenCount}` — the bare count, e.g. `12.3K`, for compact layouts
- `{cost}` — session cost in USD, e.g. `$0.0421`
- `{agent}` — active agent
- `{status}` — `Working`, `Retrying`, or `Idle`
- `{attempt}` — retry attempt number

`{tokens}` counts input plus output. Cache reads and writes are left out
because they run into the millions on every request; they are already part of
`{cost}`.

Missing values collapse cleanly, so `"Working on {project}"` becomes `Working on` when there is no project.

### Buttons

```jsonc
"buttons": [
  { "label": "OpenCode", "url": "https://opencode.ai" },
  { "label": "Docs", "url": "https://opencode.ai/docs" }
]
```

Only `http` and `https` URLs are accepted, and Discord shows at most two.

## Privacy

Only the strings you configure are sent to Discord. With the default templates that is the project folder name, model name, and elapsed time.

If you use `{sessionTitle}`, remember that session titles can contain customer names, ticket IDs, or other sensitive text. Discord displays activity to anyone who can see your profile, depending on their and your activity privacy settings.

The session title is read only when a template needs it (or when OpenCode pushes a rename event). Message content, prompts, and code are never read.

## Troubleshooting

**`Discord is not reachable`** — start the Discord desktop app and sign in. The plugin retries in the background when `reconnect` is enabled.

**`doctor` says no socket was found** — Discord is not running, or it uses a non-standard socket. Set `DISCORD_IPC_PATH` to the socket path and retry:

```sh
DISCORD_IPC_PATH=/run/user/1000/discord-ipc-0 npm run doctor -- 123456789012345678
```

Flatpak, Snap, Vesktop, and multiple Discord clients are probed automatically on Linux.

**Presence is set but not visible** — in Discord open **User Settings → Activity Privacy** and enable **Display current activity as a status message**.

**The app name is wrong** — Discord shows the name of your Discord application. Rename the application in the developer portal.

**Updates feel delayed** — Discord rate-limits presence updates. The default four-second throttle keeps the plugin inside that limit.

**Presence goes quiet after restarting OpenCode a few times** — Discord only serves a small number of connections per application ID, and an earlier build of this plugin opened a fresh one on every reload. Connections are now shared per process, so restarting OpenCode once after upgrading clears the stale ones.

**The card stays after quitting OpenCode** — on macOS, closing the window does not quit the app; use **⌘Q**. Even then the desktop app can leave its `opencode-cli serve --service` helper running. The plugin watches for that: once the host is gone it drops the Discord socket, and Discord clears the activity when the connection closes. A hard kill clears it too, because Discord ties the activity to the process that set it.

## How it works

- OpenCode V2 plugin hooks load the plugin and expose the event stream.
- The card is driven by `session.step.started` / `session.step.ended` (which carry the model, agent, tokens, and cost) plus `session.usage.updated`. `session.step.ended` reports `finish: "tool-calls"` while a turn continues, and any other finish ends it. The older `session.execution.*` and `session.status` events are still honoured.
- Concurrent sessions are ranked by recent activity; the newest busy session wins.
- One plugin instance runs per open project, so a hub elects a single owner for the card: working beats idle, then the most recently active project wins. The card does not flicker between open projects.
- Session metadata (title, model, agent, project, token and cost totals) is fetched lazily and refreshed when a run finishes.
- A zero-dependency Discord RPC client finds the local socket, performs the `v: 1` handshake, sends `SET_ACTIVITY`, answers pings, coalesces updates, and reconnects with backoff.
- One Discord connection is shared per process, however many times OpenCode loads the plugin.
- On exit the socket is closed, and an orphan watch clears the card if the host process disappears without running cleanup.

## Development

Requires Node 22.18+ for native TypeScript execution. Install dependencies once before running the tests or the doctor:

```sh
npm install
npm test
npm run typecheck
```

The test suite runs against an in-process fake Discord IPC server, so it does not need Discord or a real application ID. It has also been smoke-tested against OpenCode 2.1.3 with a fake Discord socket: the host loads `index.ts`, connects, publishes the idle activity, and clears it on unload.

The npm name `opencode-discord-presence` was already taken, hence `opencode-discord-status`. Rename the package if you publish your own build.

## License

MIT
