import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { DiscordRpcClient, DiscordRpcError, type Logger } from "../src/discord/client.ts"
import { FakeDiscord } from "./helpers/fake-discord.ts"

const CLIENT_ID = "123456789012345678"
const silent: Logger = { debug() {}, warn() {}, error() {} }

function makeClient(fake: FakeDiscord | string, overrides: Partial<ConstructorParameters<typeof DiscordRpcClient>[0]> = {}) {
  const path = typeof fake === "string" ? fake : fake.path
  return new DiscordRpcClient({
    clientId: CLIENT_ID,
    socketPaths: [path],
    reconnect: false,
    minUpdateIntervalMs: 0,
    requestTimeoutMs: 500,
    logger: silent,
    ...overrides,
  })
}

test("handshakes with the Discord client id and waits for READY", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake)

  try {
    await client.start()
    assert.deepEqual(fake.handshakes, [{ v: 1, client_id: CLIENT_ID }])
    assert.equal(fake.readyCount, 1)
    assert.equal(client.connected, true)
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("tries the next socket path when the first one is unavailable", async () => {
  const fake = await FakeDiscord.start()
  const missing = join(tmpdir(), `missing-discord-${process.pid}-${Date.now()}`)
  const client = makeClient(fake.path, {
    socketPaths: [missing, fake.path],
  })

  try {
    await client.start()
    assert.equal(client.connected, true)
    assert.equal(fake.readyCount, 1)
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("reports the primary socket path when every candidate is missing", async () => {
  const primary = join(tmpdir(), `missing-discord-primary-${process.pid}-${Date.now()}`)
  const fallback = join(tmpdir(), `missing-discord-fallback-${process.pid}-${Date.now()}`)
  const client = makeClient(primary, { socketPaths: [primary, fallback] })

  try {
    await assert.rejects(client.start(), (error: Error) => {
      assert.match(error.message, new RegExp(primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      assert.doesNotMatch(error.message, new RegExp(fallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      return true
    })
  } finally {
    await client.stop()
  }
})

test("sends SET_ACTIVITY with the process id and activity payload", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake)
  const activity = { details: "Working on a thing", state: "deepseek-v4.1-flash" }

  try {
    await client.start()
    await client.setActivity(activity)

    assert.deepEqual(fake.activities, [activity])
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("answers Discord PING frames with a PONG", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake)

  try {
    await client.start()
    fake.sendPing({ at: 42 })
    const pong = await fake.waitFor(() => fake.pongs[0], "a PONG")
    assert.deepEqual(pong, { at: 42 })
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("rejects setActivity when Discord returns an error", async () => {
  const fake = await FakeDiscord.start({
    errorOnSetActivity: { code: 4000, message: "rate limited" },
  })
  const client = makeClient(fake)

  try {
    await client.start()
    await assert.rejects(client.setActivity({ details: "nope" }), (error) => {
      assert.ok(error instanceof DiscordRpcError)
      assert.equal(error.code, 4000)
      assert.match(error.message, /rate limited/)
      return true
    })
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("surfaces a rejected handshake with Discord's message", async () => {
  const fake = await FakeDiscord.start({
    rejectHandshake: { code: 4000, message: "Invalid Client ID" },
  })
  const client = makeClient(fake)

  try {
    await assert.rejects(client.start(), /Invalid Client ID/)
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("times out when Discord never answers the handshake", async () => {
  const fake = await FakeDiscord.start({ ignoreHandshake: true })
  const client = makeClient(fake, { requestTimeoutMs: 60 })

  try {
    await assert.rejects(client.start(), /timed out/i)
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("reconnects and restores the latest activity after Discord restarts", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake, {
    reconnect: true,
    reconnectDelayMs: 10,
    maxReconnectDelayMs: 20,
  })
  const activity = { details: "Still here", state: "reconnecting" }

  try {
    await client.start()
    await client.setActivity(activity)
    assert.equal(fake.readyCount, 1)

    fake.dropConnections()
    await fake.waitFor(() => fake.readyCount === 2, "a reconnect")
    await fake.waitFor(
      () => fake.activities.filter((item) => JSON.stringify(item) === JSON.stringify(activity)).length >= 2,
      "the activity to be restored",
    )
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("stop clears the presence before closing the socket", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake)

  try {
    await client.start()
    await client.setActivity({ details: "Visible" })
    await client.stop()

    assert.equal(fake.activities.at(-1), null)
    assert.equal(client.connected, false)
  } finally {
    await fake.close()
  }
})

test("deduplicates identical consecutive activities", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake)

  try {
    await client.start()
    await client.setActivity({ details: "Same" })
    await client.setActivity({ details: "Same" })

    assert.equal(fake.activities.length, 1)
  } finally {
    await client.stop()
    await fake.close()
  }
})

test("keeps automatic reconnect failures quiet after the initial error", async () => {
  const warnings: string[] = []
  const missing = join(tmpdir(), `missing-discord-retry-${process.pid}-${Date.now()}`)
  const client = new DiscordRpcClient({
    clientId: CLIENT_ID,
    socketPaths: [missing],
    reconnect: true,
    reconnectDelayMs: 10,
    maxReconnectDelayMs: 20,
    requestTimeoutMs: 100,
    logger: { debug() {}, warn: (message) => warnings.push(message), error() {} },
  })

  try {
    await assert.rejects(client.start())
    await new Promise((resolve) => setTimeout(resolve, 60))
    await client.stop()
    assert.deepEqual(warnings, [])
  } finally {
    await client.stop()
  }
})

test("coalesces rapid updates and sends the newest activity last", async () => {
  const fake = await FakeDiscord.start()
  const client = makeClient(fake, { minUpdateIntervalMs: 40 })

  try {
    await client.start()
    const first = client.setActivity({ details: "one" })
    const second = client.setActivity({ details: "two" })
    const third = client.setActivity({ details: "three" })
    await Promise.all([first, second, third])

    assert.deepEqual(fake.activities, [{ details: "one" }, { details: "three" }])
  } finally {
    await client.stop()
    await fake.close()
  }
})
