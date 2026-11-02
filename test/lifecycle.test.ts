import test from "node:test"
import assert from "node:assert/strict"

import { hasOpenCodeProcess } from "../src/lifecycle.ts"

test("detects the desktop app and its service", () => {
  assert.equal(hasOpenCodeProcess("/Applications/OpenCode.app/Contents/MacOS/OpenCode\n"), true)
  assert.equal(hasOpenCodeProcess("/Users/you/.opencode/bin/opencode-cli\n"), true)
  assert.equal(hasOpenCodeProcess("opencode\n"), true)
})

test("does not match unrelated processes or the watcher itself", () => {
  assert.equal(
    hasOpenCodeProcess(
      ["/opt/homebrew/bin/node", "/usr/sbin/cfprefsd", "/opt/homebrew/bin/node", ""].join("\n"),
    ),
    false,
  )
})

test("matches the process name, not a path that contains opencode", () => {
  assert.equal(
    hasOpenCodeProcess("/Users/you/Documents/opencode-discord-status/scripts/watch.ts\n"),
    false,
  )
})
