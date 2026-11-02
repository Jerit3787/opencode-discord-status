# Setup

This guide is written so a person or an OpenCode agent can follow it top to
bottom. If you are an agent working in this repository, the
`setup-opencode-discord-status` skill in `.opencode/skills/` is the short form.

## Requirements

- OpenCode V2.
- The Discord desktop app, running and signed in, on the same machine as
  OpenCode.
- A Discord Application ID. Create one at
  <https://discord.com/developers/applications> → **New Application**, then copy
  the Application ID from **General Information**. No bot token is needed.
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
./bin/opencode-discord-status --client-id 123456789012345678
```

It polls `~/.local/share/opencode/opencode.db` every two seconds and updates
the card when the winning session changes.

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
./bin/opencode-discord-status --client-id 123456789012345678 --doctor
```

`--doctor` sets a test card for eight seconds and clears it.

Finally, in Discord open **User Settings → Activity Privacy** and enable
**Display current activity as a status message**.

## Run only while OpenCode is open (macOS)

`--exit-when-closed` clears the card and exits when no OpenCode process is
running. Pair it with `StartInterval` so launchd checks for OpenCode every 15
seconds instead of keeping a stale process alive.

Create `~/Library/LaunchAgents/dev.opencode.discord-watch.plist`. Replace the
binary path and Application ID:

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
    <string>/absolute/path/to/opencode-discord-status/bin/opencode-discord-status</string>
    <string>--client-id</string>
    <string>123456789012345678</string>
    <string>--exit-when-closed</string>
    <string>--debug</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/absolute/path/to/opencode-discord-status</string>
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

No `KeepAlive`: when OpenCode closes, the watcher clears the card and exits;
launchd starts it again within 15 seconds of OpenCode reopening. On Linux, use
the same pattern under systemd or your user service manager.

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--client-id` | `$DISCORD_CLIENT_ID` | **Required.** Discord Application ID. |
| `--db` | `~/.local/share/opencode/opencode.db` | OpenCode database. |
| `--interval` | `2s` | Poll interval. |
| `--idle-after` | `15m` | Treat a session with no writes for this long as idle. |
| `--exit-when-closed` | `false` | Clear and exit when OpenCode is not running. |
| `--debug` | `false` | Log each published card. |
| `--doctor` | `false` | Set a test card for 8 seconds, then clear it. |
| `--once` | `false` | Print the current card and exit. |

## Troubleshooting

**`--once` prints `Idle`** — OpenCode has no current session, or the database is
not at the default path. Point `--db` at `opencode.db`.

**`Discord not reachable`** — start the Discord desktop app and sign in. The
watcher retries every five seconds.

**Card is set but not visible** — enable **Display current activity as a status
message** in Discord's Activity Privacy settings.

**Card stays after quitting** — with `--exit-when-closed`, it clears within five
seconds. On macOS, closing the window is not quitting; use ⌘Q.

**Two projects alternate on the card** — both are working and writing within the
10-second switch margin. The card stays on the current one until the other is
clearly more recent.

**A major OpenCode upgrade changed the database** — the watcher reads
`session_v2` and `session_message`. If those change, update `opencode.go` or
pin the previous binary until the schema settles.

## Uninstall

```sh
launchctl bootout gui/$(id -u)/dev.opencode.discord-watch
rm ~/Library/LaunchAgents/dev.opencode.discord-watch.plist
```

Delete the clone if you no longer need it.
