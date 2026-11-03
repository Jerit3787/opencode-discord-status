# Setup

This guide is written so a person or an OpenCode agent can follow it top to
bottom. If you are an agent working in this repository, the
`setup-opencode-discord-status` skill in `.opencode/skills/` is the short form.

## Requirements

- OpenCode V2.
- The Discord desktop app, running and signed in, on the same machine as
  OpenCode.
- No Discord Application ID is needed: the binary ships with a shared one. Pass
  `--client-id` only if you want your own application name.
- Go 1.26+ to build the binary.

## Build

```sh
git clone https://github.com/Jerit3787/opencode-discord-status.git
cd opencode-discord-status
go build -trimpath -o bin/opencode-discord-status .
```

`scripts/build.sh` cross-compiles darwin, linux, and windows binaries into
`bin/`.

## Run

```sh
./bin/opencode-discord-status
```

It polls `~/.local/share/opencode/opencode.db` every two seconds and updates the
card when it changes. If Discord restarts, it reconnects and republishes the
current card on the next poll.

`--db` and `OPENCODE_DB` / `XDG_DATA_HOME` control the database path.

## Verify

Print the card without touching Discord:

```sh
./bin/opencode-discord-status -once
```

Expected shape:

```
Working on: opencode-discord-status
DeepSeek V4.1 Flash | 12.3K tokens | $0.0421
```

Then check the Discord path independently:

```sh
./bin/opencode-discord-status --doctor
```

`--doctor` sets a test card for eight seconds and clears it.

Finally, in Discord open **User Settings → Activity Privacy** and enable
**Display current activity as a status message**.

## Run only while OpenCode is open

Add the `autostart` plugin to the global `plugins` array:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-discord-status/autostart",
      "options": {}
    }
  ]
}
```

OpenCode starts `bin/opencode-discord-status --exit-when-closed` when it starts
and kills it when it exits. There is no launchd job and no
`opencode-discord-status` process while OpenCode is closed. The plugin checks
every two seconds and restarts the watcher if it crashes.

The watcher logs to `watch.log` in the repo root.

The desktop app's `opencode-cli serve --service` child is ignored because it can
outlive the app. On macOS, closing the window is not quitting; use ⌘Q.

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--client-id` | shared app ID | Override with your own Discord Application ID. |
| `--db` | `~/.local/share/opencode/opencode.db` | OpenCode database. |
| `--interval` | `2s` | Poll interval. |
| `--idle-after` | `15m` | Treat a session with no writes for this long as idle. |
| `--exit-when-closed` | `false` | Clear and exit when OpenCode is not running. |
| `--debug` | `false` | Log each published card. |
| `--doctor` | `false` | Set a test card for 8 seconds, then clear it. |
| `--once` | `false` | Print the current card and exit. |

## Troubleshooting

**`--once` prints `Idle`** — the database opened but has no current session.

**`--once` prints `Could not read ...`** — the database path is wrong. Pass
`--db`, or set `OPENCODE_DB` / `XDG_DATA_HOME`.

**`Discord not reachable`** — start the Discord desktop app and sign in. The
watcher retries every five seconds.

**Card is set but not visible** — enable **Display current activity as a status
message** in Discord's Activity Privacy settings.

**Card stays after quitting** — the autostart plugin kills the watcher within two
seconds. If it stays, OpenCode is still running: closing the window is not
quitting on macOS; use ⌘Q.

**Discord restarted** — the watcher reconnects on the next poll and republishes
the current card, even if the text has not changed.

**Two projects alternate on the card** — both are working and writing within the
10-second switch margin. The card stays on the current one until the other is
clearly more recent.

**A major OpenCode upgrade changed the database** — the watcher reads
`session_v2` and `session_message`. If those change, update `opencode.go` or
pin the previous binary until the schema settles.

## Upgrading from the TypeScript version

If you used the old plugin, Node watcher, or launchd job:

1. Remove the old `opencode-discord-status` entry from `plugins`. The repo no
   longer contains `index.ts`, so an old entry will fail to load.
2. If you created the old LaunchAgent:
   `launchctl bootout gui/$(id -u)/dev.opencode.discord-watch` and
   `rm -f ~/Library/LaunchAgents/dev.opencode.discord-watch.plist`.
3. Delete `node_modules` from the clone; it is no longer used.
4. `go build -trimpath -o bin/opencode-discord-status .`
5. Add the `autostart` plugin entry from the section above.

## Uninstall

Remove the `autostart` entry from `plugins`. If you previously installed the
launchd job, also run:

```sh
launchctl bootout gui/$(id -u)/dev.opencode.discord-watch
rm -f ~/Library/LaunchAgents/dev.opencode.discord-watch.plist
```

Delete the clone if you no longer need it.
