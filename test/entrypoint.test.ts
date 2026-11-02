import test from "node:test"
import assert from "node:assert/strict"

import plugin from "../index.ts"

test("the package root exposes the OpenCode plugin", () => {
  assert.equal(plugin.id, "opencode-discord-status")
  assert.equal(typeof plugin.setup, "function")
})
