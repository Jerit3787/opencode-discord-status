import test from "node:test"
import assert from "node:assert/strict"

import type { DiscordActivity } from "../src/discord/client.ts"
import { PresenceHub } from "../src/hub.ts"

function setup() {
  const sent: Array<DiscordActivity | null> = []
  const client = {
    start: async () => {},
    stop: async () => {},
    destroy: () => {},
    setActivity: async (activity: DiscordActivity | null) => {
      sent.push(activity)
    },
  }
  const logger = { debug() {}, warn() {}, error() {} }

  const hub = new PresenceHub(client as never, logger)

  return { hub, sent, last: () => sent.at(-1) }
}

test("a working project outranks an idle one no matter who joined first", () => {
  const { hub, last } = setup()
  const idle = hub.join("/work/alpha")
  const busy = hub.join("/work/beta")

  idle.sink.setActivity({ details: "Idle", state: "alpha" }, { status: "idle", lastActive: 0 })
  busy.sink.setActivity({ details: "beta" }, { status: "busy", lastActive: 100 })

  assert.deepEqual(last(), { details: "beta" })

  // The idle project re-announcing itself must not steal the card.
  idle.sink.setActivity(
    { details: "Idle", state: "alpha" },
    { status: "idle", lastActive: 500 },
  )
  assert.deepEqual(last(), { details: "beta" })
})

test("the most recently active working project wins", () => {
  const { hub, last } = setup()
  const first = hub.join("/work/alpha")
  const second = hub.join("/work/beta")

  first.sink.setActivity({ details: "alpha" }, { status: "busy", lastActive: 100 })
  second.sink.setActivity({ details: "beta" }, { status: "busy", lastActive: 200 })

  assert.deepEqual(last(), { details: "beta" })

  first.sink.setActivity({ details: "alpha" }, { status: "busy", lastActive: 300 })
  assert.deepEqual(last(), { details: "alpha" })
})

test("a finished project keeps the card instead of reverting to another idle one", () => {
  const { hub, last } = setup()
  const worked = hub.join("/work/beta")
  const other = hub.join("/work/alpha")

  other.sink.setActivity({ details: "Idle", state: "alpha" }, { status: "idle", lastActive: 0 })
  worked.sink.setActivity({ details: "beta" }, { status: "busy", lastActive: 100 })
  worked.sink.setActivity(
    { details: "Idle", state: "beta" },
    { status: "idle", lastActive: 200 },
  )

  assert.deepEqual(last(), { details: "Idle", state: "beta" })

  // A stale idle announcement from the other project changes nothing.
  other.sink.setActivity(
    { details: "Idle", state: "alpha" },
    { status: "idle", lastActive: 0 },
  )
  assert.deepEqual(last(), { details: "Idle", state: "beta" })
})

test("switching to another idle project moves the card", () => {
  const { hub, last } = setup()
  const first = hub.join("/work/alpha")
  const second = hub.join("/work/beta")

  first.sink.setActivity({ details: "Idle", state: "alpha" }, { status: "idle", lastActive: 100 })
  second.sink.setActivity({ details: "Idle", state: "beta" }, { status: "idle", lastActive: 200 })

  assert.deepEqual(last(), { details: "Idle", state: "beta" })
})

test("leaving hands the card to the next instance, and the last one clears it", async () => {
  const { hub, last } = setup()
  const alpha = hub.join("/work/alpha")
  const beta = hub.join("/work/beta")

  alpha.sink.setActivity({ details: "alpha" }, { status: "busy", lastActive: 100 })
  beta.sink.setActivity({ details: "beta" }, { status: "idle", lastActive: 50 })
  assert.deepEqual(last(), { details: "alpha" })

  await alpha.leave()
  assert.deepEqual(last(), { details: "beta" })

  await beta.leave()
  assert.equal(last(), null)
})

test("a replaced setup cannot remove the newer participant for the same project", async () => {
  const { hub, last } = setup()
  const old = hub.join("/work/alpha")
  const current = hub.join("/work/alpha")

  old.sink.setActivity({ details: "old" }, { status: "busy", lastActive: 100 })
  current.sink.setActivity({ details: "current" }, { status: "busy", lastActive: 100 })

  await old.leave()
  assert.deepEqual(last(), { details: "current" })
})

test("drops the socket when the OpenCode host goes away", async () => {
  let parentPid = 500
  let destroyed = 0
  const client = {
    start: async () => {},
    stop: async () => {},
    destroy: () => {
      destroyed += 1
    },
    setActivity: async () => {},
  }
  const hub = new PresenceHub(
    client as never,
    { debug() {}, warn() {}, error() {} },
    { parentPid: () => parentPid, orphanCheckIntervalMs: 10 },
  )

  try {
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(destroyed, 0, "a live host keeps the card")

    parentPid = 1
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(destroyed, 1, "an orphaned host clears the card once")
  } finally {
    await hub.shutdown()
  }
})

