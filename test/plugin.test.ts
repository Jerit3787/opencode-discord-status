import test from "node:test"
import assert from "node:assert/strict"

import plugin from "../src/index.ts"
import { FakeDiscord } from "./helpers/fake-discord.ts"

interface QueuedEvent {
  type: string
  created?: number
  location?: { directory?: string }
  data?: Record<string, unknown>
}

class EventQueue {
  readonly #items: QueuedEvent[] = []
  readonly #waiters: Array<(result: IteratorResult<QueuedEvent>) => void> = []
  #closed = false

  push(event: QueuedEvent): void {
    const waiter = this.#waiters.shift()
    if (waiter) {
      waiter({ value: event, done: false })
      return
    }
    this.#items.push(event)
  }

  close(): void {
    this.#closed = true
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  async *iterate(signal?: AbortSignal): AsyncGenerator<QueuedEvent> {
    while (!this.#closed && !signal?.aborted) {
      const item = this.#items.shift()
      if (item) {
        yield item
        continue
      }

      const result = await new Promise<IteratorResult<QueuedEvent>>((resolve) => {
        this.#waiters.push(resolve)
        signal?.addEventListener("abort", () => resolve({ value: undefined, done: true }), {
          once: true,
        })
      })

      if (result.done) return
      yield result.value
    }
  }
}

test("the plugin connects, follows a session, and clears presence on unload", async () => {
  const fake = await FakeDiscord.start()
  const queue = new EventQueue()
  const previousPath = process.env.DISCORD_IPC_PATH
  process.env.DISCORD_IPC_PATH = fake.path

  const ctx = {
    options: { clientId: "123456789012345678", minUpdateIntervalMs: 1_000 },
    location: {
      directory: "/work/my-app",
      project: { id: "project-1", directory: "/work/my-app", canonical: "/work/my-app" },
    },
    model: {
      list: async () => ({
        location: { directory: "/work/my-app" },
        data: [
          { providerID: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
        ],
      }),
    },
    session: {
      get: async () => ({
        title: "Fix the login bug",
        model: { providerID: "anthropic", id: "claude-sonnet-4-5" },
        agent: "build",
        location: { directory: "/work/my-app" },
      }),
    },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => queue.iterate(options?.signal),
    },
  }

  let cleanup: (() => Promise<void> | void) | void = undefined

  try {
    cleanup = await plugin.setup(ctx as never)

    await fake.waitFor(
      () => fake.activities.find((activity) => (activity as { details?: string })?.details === "Idle"),
      "the idle presence",
    )

    queue.push({
      type: "session.execution.started",
      created: Date.now(),
      location: { directory: "/work/my-app" },
      data: { sessionID: "session-1" },
    })

    const busy = await fake.waitFor(
      () =>
        fake.activities.find(
          (activity) => (activity as { state?: string })?.state === "Claude Sonnet 4.5",
        ),
      `the busy presence with the friendly model name (saw ${JSON.stringify(fake.activities)})`,
      5_000,
    )
    assert.equal((busy as { details?: string }).details, "my-app")
    assert.ok((busy as { timestamps?: { start?: number } }).timestamps?.start)

    queue.push({
      type: "session.execution.succeeded",
      location: { directory: "/work/my-app" },
      data: { sessionID: "session-1" },
    })

    await fake.waitFor(
      () =>
        fake.activities.at(-1) &&
        (fake.activities.at(-1) as { details?: string }).details === "Idle",
      "the idle presence after the turn",
    )

    assert.equal(typeof cleanup, "function")
    await (cleanup as () => Promise<void>)()
    assert.equal(fake.activities.at(-1), null)
  } finally {
    queue.close()
    if (typeof cleanup === "function") await cleanup()
    if (previousPath === undefined) delete process.env.DISCORD_IPC_PATH
    else process.env.DISCORD_IPC_PATH = previousPath
    await fake.close()
  }
})

test("reuses one Discord connection when setup runs more than once", async () => {
  const fake = await FakeDiscord.start()
  const previousPath = process.env.DISCORD_IPC_PATH
  process.env.DISCORD_IPC_PATH = fake.path

  const queue = new EventQueue()
  const ctx = {
    options: { clientId: "987654321098765432", minUpdateIntervalMs: 1_000 },
    location: { directory: "/work/my-app" },
    model: { list: async () => ({ location: { directory: "/work/my-app" }, data: [] }) },
    session: { get: async () => ({ location: { directory: "/work/my-app" } }) },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => queue.iterate(options?.signal),
    },
  }

  const cleanups: Array<() => Promise<void> | void> = []

  try {
    cleanups.push((await plugin.setup(ctx as never)) as () => Promise<void>)
    cleanups.push((await plugin.setup(ctx as never)) as () => Promise<void>)

    await fake.waitFor(() => fake.readyCount >= 1, "the first connection")

    // Give a second connection every chance to appear before asserting.
    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(fake.handshakes.length, 1, "only one Discord connection should be opened")

    await cleanups[0]!()
    assert.notEqual(fake.activities.at(-1), null, "the second setup should keep the presence alive")

    await cleanups[1]!()
    assert.equal(fake.activities.at(-1), null)
  } finally {
    queue.close()
    for (const cleanup of cleanups.reverse()) await cleanup()
    if (previousPath === undefined) delete process.env.DISCORD_IPC_PATH
    else process.env.DISCORD_IPC_PATH = previousPath
    await fake.close()
  }
})

test("one card follows the project that is actually working", async () => {
  const fake = await FakeDiscord.start()
  const previousPath = process.env.DISCORD_IPC_PATH
  process.env.DISCORD_IPC_PATH = fake.path

  const alphaQueue = new EventQueue()
  const betaQueue = new EventQueue()

  const ctxFor = (directory: string, queue: EventQueue) => ({
    options: { clientId: "111122223333444455", minUpdateIntervalMs: 1_000 },
    location: { directory, project: { id: directory, directory, canonical: directory } },
    model: { list: async () => ({ location: { directory }, data: [] }) },
    session: { get: async () => ({ location: { directory } }) },
    event: {
      subscribe: (options?: { signal?: AbortSignal }) => queue.iterate(options?.signal),
    },
  })

  const cleanups: Array<() => Promise<void> | void> = []

  try {
    // Two projects open at once, exactly like the desktop app.
    cleanups.push((await plugin.setup(ctxFor("/work/alpha", alphaQueue) as never)) as () => Promise<void>)
    cleanups.push((await plugin.setup(ctxFor("/work/beta", betaQueue) as never)) as () => Promise<void>)

    await fake.waitFor(() => fake.readyCount >= 1, "the shared connection")

    betaQueue.push({
      type: "session.execution.started",
      created: Date.now(),
      location: { directory: "/work/beta" },
      data: { sessionID: "beta-1" },
    })

    await fake.waitFor(
      () => fake.activities.find((activity) => (activity as { details?: string })?.details === "beta"),
      "the beta card",
    )

    // Alpha re-announcing its idle state must not steal the card from beta.
    alphaQueue.push({
      type: "session.created",
      location: { directory: "/work/alpha" },
      data: { sessionID: "alpha-1" },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal((fake.activities.at(-1) as { details?: string })?.details, "beta")

    // When beta finishes, the card stays on beta rather than flipping to alpha.
    betaQueue.push({
      type: "session.execution.succeeded",
      location: { directory: "/work/beta" },
      data: { sessionID: "beta-1" },
    })
    await fake.waitFor(
      () => (fake.activities.at(-1) as { state?: string })?.state?.startsWith("beta"),
      "the idle beta card",
    )
    assert.equal((fake.activities.at(-1) as { details?: string })?.details, "Idle")
  } finally {
    alphaQueue.close()
    betaQueue.close()
    for (const cleanup of cleanups.reverse()) await cleanup()
    if (previousPath === undefined) delete process.env.DISCORD_IPC_PATH
    else process.env.DISCORD_IPC_PATH = previousPath
    await fake.close()
  }
})

