import test from "node:test"
import assert from "node:assert/strict"

import { socketCandidates } from "../src/discord/socket.ts"

test("uses DISCORD_IPC_PATH verbatim when set", () => {
  assert.deepEqual(
    socketCandidates({ DISCORD_IPC_PATH: "/custom/discord-ipc-7", TMPDIR: "/tmp" }, "darwin"),
    ["/custom/discord-ipc-7"],
  )
})

test("macOS prefers TMPDIR and probes socket indexes 0 through 9", () => {
  const paths = socketCandidates({ TMPDIR: "/var/folders/me/T/" }, "darwin")

  assert.equal(paths[0], "/var/folders/me/T/discord-ipc-0")
  assert.equal(paths[9], "/var/folders/me/T/discord-ipc-9")
  assert.ok(paths.includes("/tmp/discord-ipc-0"))
})

test("Linux probes XDG_RUNTIME_DIR, temp directories, and sandboxed Discord paths", () => {
  const paths = socketCandidates(
    { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp/me" },
    "linux",
  )

  assert.equal(paths[0], "/run/user/1000/discord-ipc-0")
  assert.ok(paths.includes("/run/user/1000/discord-ipc-9"))
  assert.ok(paths.includes("/tmp/me/discord-ipc-0"))
  assert.ok(paths.includes("/tmp/discord-ipc-0"))
  assert.ok(paths.includes("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0"))
  assert.ok(paths.includes("/run/user/1000/snap.discord/discord-ipc-0"))
})

test("Windows uses named pipes", () => {
  const paths = socketCandidates({}, "win32")

  assert.equal(paths.length, 10)
  assert.equal(paths[0], String.raw`\\?\pipe\discord-ipc-0`)
  assert.equal(paths[9], String.raw`\\?\pipe\discord-ipc-9`)
})

test("deduplicates directories that resolve to the same place", () => {
  const paths = socketCandidates(
    { XDG_RUNTIME_DIR: "/tmp", TMPDIR: "/tmp", TMP: "/tmp", TEMP: "/tmp" },
    "linux",
  )

  assert.equal(paths.filter((path) => path === "/tmp/discord-ipc-0").length, 1)
})
