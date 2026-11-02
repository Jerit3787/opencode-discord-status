---
name: Set up opencode-discord-status
description: Use when installing, configuring, or troubleshooting opencode-discord-status (Discord Rich Presence for OpenCode), including running it only while OpenCode is open.
---

# Set up opencode-discord-status

Show OpenCode sessions on Discord: project, model, tokens, and cost. It reads
OpenCode's local SQLite database; there is no plugin and no network.

## Before you start

- Go 1.26+ to build the binary.
- OpenCode V2 and the Discord desktop app on the same machine, signed in.
- No Discord Application ID is needed: the binary ships with a shared one.
  `--client-id` only changes the application name Discord shows.

## Build and run

1. Clone and build:

   ```sh
   git clone https://github.com/Jerit3787/opencode-discord-status.git
   cd opencode-discord-status
   go build -trimpath -o bin/opencode-discord-status .
   ```

2. Run it on the machine with Discord:

   ```sh
   ./bin/opencode-discord-status
   ```

3. Verify:

   ```sh
   ./bin/opencode-discord-status -once
   ./bin/opencode-discord-status --doctor
   ```

   `-once` prints the card without Discord. `--doctor` sets a test card for
   eight seconds.

4. In Discord, enable **User Settings → Activity Privacy → Display current
   activity as a status message**.

## Run only while OpenCode is open

Add `--exit-when-closed`: it clears the card and exits when no OpenCode process
is running. Use a launchd job with `StartInterval` (not `KeepAlive`) so it
starts again within 15 seconds of OpenCode reopening. The full plist is in
`SETUP.md`.

## What it reads

`~/.local/share/opencode/opencode.db`:

- `session_v2` supplies directory, model, agent, cost, and tokens.
- The newest assistant `session_message` supplies `time.completed` and `finish`.
- Missing `completed`/`finish`, or `finish: "tool-calls"`, means busy.
- Any other `finish` means idle.
- A busy session beats an idle one; the current session is kept unless another
  is clearly newer (10 seconds).

The schema is internal. If a major OpenCode upgrade changes it, update
`opencode.go`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Running the binary somewhere without Discord | Run it on the machine with the Discord desktop app. |
| Expecting it to keep running after OpenCode closes | Add `--exit-when-closed`; without it the watcher keeps polling. |
| Using `KeepAlive` in launchd | Use `StartInterval: 15` so it checks for OpenCode. |
| Database path differs | Pass `--db /path/to/opencode.db`. |
| Card is set but invisible | Enable **Display current activity as a status message**. |
| Card stays after quitting on macOS | Closing the window is not quitting; use ⌘Q. |

## Verify the result

- `-once` prints a project and a state line.
- `--doctor` shows a test card for eight seconds.
- `--debug` logs each published card; the Discord connection is logged always.
- If nothing appears, check Discord Activity Privacy first.
