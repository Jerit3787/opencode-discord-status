import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { StateFile, expandHome } from "../src/state-file.ts"

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-state-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("writes the rendered activity as a frame", async () => {
  await withDirectory(async (directory) => {
    const state = new StateFile(join(directory, "presence.json"))
    state.write({ details: "alpha", state: "beta · 1K tokens · $0.01" })
    await state.flush()

    const frame = JSON.parse((await readFile(state.path, "utf8")).trim())
    assert.equal(frame.v, 1)
    assert.equal(frame.pid, process.pid)
    assert.equal(typeof frame.updatedAt, "number")
    assert.deepEqual(frame.activity, {
      details: "alpha",
      state: "beta · 1K tokens · $0.01",
    })
  })
})

test("keeps only the newest activity", async () => {
  await withDirectory(async (directory) => {
    const state = new StateFile(join(directory, "presence.json"))
    state.write({ details: "first" })
    state.write({ details: "second" })
    state.write(null)
    await state.flush()

    const frame = JSON.parse((await readFile(state.path, "utf8")).trim())
    assert.equal(frame.activity, null)
  })
})

test("expands a leading home marker", () => {
  assert.equal(expandHome("~"), process.env.HOME)
  assert.equal(expandHome("~/state/presence.json"), join(process.env.HOME ?? "", "state/presence.json"))
  assert.equal(expandHome("/tmp/presence.json"), "/tmp/presence.json")
})
