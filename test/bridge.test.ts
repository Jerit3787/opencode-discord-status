import test from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_STATE_PATH,
  buildTailCommand,
  parsePresenceLine,
  quoteRemotePath,
} from "../src/bridge.ts"

test("parses a presence frame", () => {
  const line = JSON.stringify({
    v: 1,
    updatedAt: 1,
    pid: 2,
    activity: { details: "alpha", state: "beta" },
  })

  assert.deepEqual(parsePresenceLine(line), { details: "alpha", state: "beta" })
})

test("treats a null activity as a clear", () => {
  assert.equal(parsePresenceLine(JSON.stringify({ activity: null })), null)
})

test("ignores blank, malformed, and non-object lines", () => {
  assert.equal(parsePresenceLine(""), undefined)
  assert.equal(parsePresenceLine("   "), undefined)
  assert.equal(parsePresenceLine("not json"), undefined)
  assert.equal(parsePresenceLine("null"), undefined)
  assert.equal(parsePresenceLine(JSON.stringify({ activity: "nope" })), undefined)
})

test("quotes remote paths for the remote shell", () => {
  assert.equal(quoteRemotePath("~/state/file.json"), '"$HOME/state/file.json"')
  assert.equal(quoteRemotePath("~"), '"$HOME"')
  assert.equal(quoteRemotePath("/tmp/a b.json"), "'/tmp/a b.json'")
  assert.equal(quoteRemotePath("/tmp/it's.json"), "'/tmp/it'\\''s.json'")
})

test("builds the follow command for the default path", () => {
  assert.equal(
    buildTailCommand(DEFAULT_STATE_PATH),
    'tail -n 1 -F "$HOME/.local/state/opencode-discord-status/presence.json"',
  )
})
