# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-06

First release of the Go, database-backed presence daemon.

### Added

- Standalone Go daemon that reads `session_v2` and `session_message` from
  OpenCode's SQLite database.
- Discord IPC client with handshake validation, PING/PONG, nonce-correlated
  `SET_ACTIVITY`, and automatic reconnect.
- Busy/idle detection from the newest assistant message's `time.completed` and
  `finish`.
- Session picker: busy beats idle, then the most recently written session wins,
  with a 10-second incumbent margin to prevent flicker.
- Card text: `Working on: <project>` over
  `<model> | <tokens> tokens | <cost>`. Idle keeps the project visible.
- Stable elapsed timer based on the latest user message rather than the newest
  assistant step.
- `autostart` plugin that starts and stops the watcher with OpenCode.
- Flags: `--client-id`, `--db`, `--interval`, `--idle-after`,
  `--exit-when-closed`, `--doctor`, `--once`, `--debug`.
- Cross-platform builds for macOS, Linux, and Windows.
- CI matrix on Ubuntu, macOS, and Windows, plus the race detector.
- Setup guide, agent skill, one-command prompt, and preview image.

### Changed

- Defaults to the shared Discord application ID; `--client-id` is only an
  override.
- `{tokens}` is input plus output, formatted like `cc-discord-presence`
  (`12.3K`, `$0.0421`).
- Token/cost churn is throttled to one update every four seconds; busy/idle and
  project changes go immediately.

### Fixed

- Fragmented socket frames are read with `io.ReadFull`.
- Handshake failures (CLOSE/ERROR) and timeouts surface instead of looking
  connected.
- Long-lived clients answer PING and drain `SET_ACTIVITY` replies.
- The client reconnects after Discord restarts even when the card text has not
  changed.
- `SET_ACTIVITY` errors are no longer discarded.
- The elapsed timer no longer resets on every assistant step.
- An orphaned `opencode-cli serve --service` no longer keeps the watcher alive.
- Cost and token formatting edge cases (`$0.00`, `$0.01`, `1.0M`).

### Removed

- The TypeScript plugin and Node watcher.
- The SSH relay and state-file bridge.
- The launchd/LaunchAgent requirement.

## [0.1.0] - 2026-10-24

### Added

- Initial TypeScript plugin for OpenCode V2: project, model, tokens, and cost,
  event-driven updates, a shared per-process Discord connection, and a hub that
  elects one card owner across open projects.

[1.0.0]: https://github.com/Jerit3787/opencode-discord-status/releases/tag/v1.0.0
[0.1.0]: https://github.com/Jerit3787/opencode-discord-status/commits/main
