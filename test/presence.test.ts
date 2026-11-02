import test from "node:test"
import assert from "node:assert/strict"

import type { ActivityConfig } from "../src/activity.ts"
import type { DiscordActivity } from "../src/discord/client.ts"
import {
  PresenceController,
  type PresenceEvent,
  type SessionDetails,
  type SessionReader,
} from "../src/presence.ts"

const config: ActivityConfig = {
  details: "{project}",
  state: "{model}",
  idleDetails: "Idle",
  idleState: "{project}",
  showElapsed: true,
}

class FakeSessions implements SessionReader {
  readonly details = new Map<string, SessionDetails>()
  calls = 0

  async get(input: { sessionID: string }): Promise<SessionDetails | undefined> {
    this.calls += 1
    return this.details.get(input.sessionID)
  }
}

function setup(
  options: {
    project?: string
    reader?: SessionReader
    resolveModelName?: (providerID: string, id: string) => string | undefined
    config?: ActivityConfig
  } = {},
) {
  const sent: DiscordActivity[] = []
  const fake = new FakeSessions()
  const reader = options.reader ?? fake
  let now = 1_700_000_000_000
  const controller = new PresenceController({
    config: { ...(options.config ?? config) },
    sink: {
      setActivity(activity) {
        sent.push(activity as DiscordActivity)
      },
    },
    session: reader,
    initialDirectory: options.project === undefined ? "/work/my-app" : options.project,
    resolveModelName: options.resolveModelName,
    now: () => now,
  })

  return {
    controller,
    sent,
    reader,
    fake,
    last: () => sent.at(-1),
    advance(ms: number) {
      now += ms
      return now
    },
    get now() {
      return now
    },
  }
}

function event(
  type: string,
  sessionID: string,
  data: Record<string, unknown> = {},
  extra: Partial<PresenceEvent> = {},
): PresenceEvent {
  return { type, created: 1_700_000_000_000, data: { sessionID, ...data }, ...extra }
}

test("publishes an idle presence immediately on start", () => {
  const { controller, last } = setup()

  controller.start()

  assert.deepEqual(last(), { details: "Idle", state: "my-app" })
})

test("shows a busy session with details fetched from OpenCode", async () => {
  const { controller, fake, last, now } = setup()
  fake.details.set("s1", {
    title: "Fix the login bug",
    model: { providerID: "anthropic", id: "claude-sonnet-4-5" },
    agent: "build",
    location: { directory: "/work/my-app" },
  })

  controller.handle(
    event("session.execution.started", "s1", {}, { created: now, location: { directory: "/work/my-app" } }),
  )
  await controller.flush()

  assert.deepEqual(last(), {
    details: "my-app",
    state: "claude-sonnet-4-5",
    timestamps: { start: now },
  })
  assert.equal(fake.calls, 1)
})

test("publishes enriched details as soon as the lookup resolves", async () => {
  const { controller, fake, last, now } = setup()
  fake.details.set("s1", {
    title: "Fix the login bug",
    model: { providerID: "anthropic", id: "claude-sonnet-4-5" },
    agent: "build",
  })

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  assert.equal(last()?.state, undefined)

  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(last(), {
    details: "my-app",
    state: "claude-sonnet-4-5",
    timestamps: { start: now },
  })
})

test("uses the event location for the project name", async () => {
  const { controller, last, now } = setup({ project: "/work/first" })

  controller.handle(
    event("session.execution.started", "s1", {}, { created: now, location: { directory: "/work/second" } }),
  )
  await controller.flush()

  assert.equal(last()?.details, "second")
})

test("renamed sessions update a custom template", async () => {
  const { controller, last, now } = setup()
  controller.config.details = "{sessionTitle}"

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  controller.handle(event("session.renamed", "s1", { title: "Refactor the parser" }))
  await controller.flush()

  assert.equal(last()?.details, "Refactor the parser")
})

test("model selections are resolved to friendly display names", async () => {
  const { controller, last, now } = setup({
    resolveModelName: (providerID, id) => `${providerID}:${id}`,
  })

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  controller.handle(
    event("session.model.selected", "s1", { model: { providerID: "openai", id: "gpt-5" } }),
  )
  await controller.flush()

  assert.equal(last()?.state, "openai:gpt-5")
})

test("going idle removes the timer and the model", () => {
  const { controller, last, now } = setup()

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  controller.handle(event("session.execution.succeeded", "s1"))

  assert.deepEqual(last(), { details: "Idle", state: "my-app" })
})

test("a new execution restarts the timer", () => {
  const { controller, last, advance } = setup()

  controller.handle(event("session.execution.started", "s1", {}, { created: 1_700_000_000_000 }))
  const restarted = advance(60_000)
  controller.handle(event("session.execution.started", "s1", {}, { created: restarted }))

  assert.deepEqual(last(), {
    details: "my-app",
    timestamps: { start: restarted },
  })
})

test("surfaces retry attempts through the status template", async () => {
  const { controller, last, now } = setup()
  controller.config.state = "{status} ({attempt})"

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  controller.handle(
    event("session.status", "s1", {
      status: { type: "retry", attempt: 2, message: "rate limited", next: 0 },
    }),
  )
  await controller.flush()

  assert.equal(last()?.state, "Retrying (2)")
})

test("falls back to the remaining busy session when the newest goes idle", () => {
  const { controller, last, advance } = setup()

  controller.handle(
    event("session.execution.started", "s1", {}, { location: { directory: "/work/first" } }),
  )
  advance(1_000)
  controller.handle(
    event("session.execution.started", "s2", {}, { location: { directory: "/work/second" } }),
  )
  assert.equal(last()?.details, "second")

  controller.handle(event("session.execution.succeeded", "s2"))
  assert.equal(last()?.details, "first")
  assert.ok(last()?.timestamps)
})

test("falls back to the initial project when every session is deleted", () => {
  const { controller, last, advance } = setup()

  controller.handle(
    event("session.execution.started", "s1", {}, { location: { directory: "/work/first" } }),
  )
  advance(1_000)
  controller.handle(
    event("session.execution.started", "s2", {}, { location: { directory: "/work/second" } }),
  )
  controller.handle(event("session.deleted", "s2"))
  controller.handle(event("session.deleted", "s1"))

  assert.deepEqual(last(), { details: "Idle", state: "my-app" })
})

test("does not resend an identical presence", () => {
  const { controller, sent } = setup()
  controller.start()

  controller.handle({ type: "session.idle", data: { sessionID: "s1" } })
  controller.handle({ type: "session.idle", data: { sessionID: "s1" } })

  assert.equal(sent.length, 1)
})

test("ignores events without a session id and unknown event types", () => {
  const { controller, sent } = setup()
  controller.start()
  const count = sent.length

  controller.handle({ type: "session.idle" })
  controller.handle({ type: "tui.toast.show", data: { sessionID: "s1" } })
  controller.handle(event("unknown.event", "s1"))

  assert.equal(sent.length, count)
})

test("status busy starts the timer even without an execution event", () => {
  const { controller, last, now } = setup()

  controller.handle(event("session.status", "s1", { status: { type: "busy" } }))

  assert.deepEqual(last(), {
    details: "my-app",
    timestamps: { start: now },
  })
})

test("a failing session lookup still leaves a usable presence", async () => {
  const reader: SessionReader = {
    async get() {
      throw new Error("session went away")
    },
  }
  const { controller, last, now } = setup({ reader })

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  await controller.flush()

  assert.deepEqual(last(), {
    details: "my-app",
    timestamps: { start: now },
  })
})

test("refreshes token and cost totals once a run finishes", async () => {
  const usageConfig: ActivityConfig = {
    ...config,
    state: "{model} · {tokens} · {cost}",
    idleState: "{project} · {tokens} · {cost}",
  }
  let reads = 0
  const { controller, fake, last, now } = setup({
    config: usageConfig,
    reader: {
      async get({ sessionID }) {
        reads += 1
        return fake.details.get(sessionID)
      },
    },
  })
  fake.details.set("s1", {
    model: { providerID: "openai", id: "gpt-5.6-luna" },
    tokens: { input: 1_000, output: 200 },
    cost: 0.01,
  })

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  await controller.flush()
  assert.equal(last()?.state, "gpt-5.6-luna · 1.2K tokens · $0.01")

  fake.details.set("s1", {
    model: { providerID: "openai", id: "gpt-5.6-luna" },
    tokens: { input: 12_000, output: 400 },
    cost: 0.0842,
  })
  controller.handle(event("session.execution.succeeded", "s1", {}, { created: now }))
  await controller.flush()

  assert.equal(last()?.state, "my-app · 12.4K tokens · $0.0842")
  assert.equal(reads, 2)
})

test("keeps usage on the card when the session goes idle", async () => {
  const { controller, last, now } = setup({
    config: { ...config, idleState: "{project} · {tokens} · {cost}" },
    reader: {
      async get() {
        return {
          model: { providerID: "openai", id: "gpt-5.6-luna" },
          tokens: { input: 9_000, output: 400 },
          cost: 0.03,
        }
      },
    },
  })

  controller.handle(event("session.execution.started", "s1", {}, { created: now }))
  await controller.flush()
  controller.handle(event("session.idle", "s1"))
  await controller.flush()

  assert.equal(last()?.details, "Idle")
  assert.equal(last()?.state, "my-app · 9.4K tokens · $0.03")
})

test("drives the card from step events, which is what OpenCode V2 actually sends", async () => {
  const { controller, last } = setup({
    config: { ...config, state: "{model} · {tokens} · {cost}" },
    resolveModelName: (providerID, id) =>
      providerID === "opencode" && id === "deepseek-v4.1-flash" ? "DeepSeek V4.1 Flash" : undefined,
  })

  controller.handle(
    event("session.step.started", "s1", {
      model: { providerID: "opencode", id: "deepseek-v4.1-flash" },
      agent: "build",
      started: 1_700_000_000_000,
    }),
  )

  assert.equal(last()?.details, "my-app")
  assert.equal(last()?.state, "DeepSeek V4.1 Flash")
  assert.deepEqual(last()?.timestamps, { start: 1_700_000_000_000 })
  await controller.flush()
})

test("keeps the card busy while a step is waiting on tools", async () => {
  const { controller, last } = setup({ config: { ...config, state: "{model} · {tokens} · {cost}" } })

  controller.handle(
    event("session.step.started", "s1", {
      model: { providerID: "opencode", id: "deepseek" },
      started: 1_700_000_000_000,
    }),
  )
  controller.handle(
    event("session.step.ended", "s1", {
      finish: "tool-calls",
      cost: 0.01,
      tokens: { input: 1_000, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )

  assert.equal(last()?.details, "my-app")
  assert.equal(last()?.state, "deepseek · 1K tokens · $0.01")
  await controller.flush()
})

test("goes idle when the turn finishes and keeps the usage", async () => {
  const { controller, last } = setup({
    config: { ...config, idleState: "{project} · {tokens} · {cost}" },
  })

  controller.handle(
    event("session.step.started", "s1", {
      model: { providerID: "opencode", id: "deepseek" },
      started: 1_700_000_000_000,
    }),
  )
  controller.handle(
    event("session.step.ended", "s1", {
      finish: "stop",
      cost: 0.0842,
      tokens: { input: 12_000, output: 400, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )

  assert.equal(last()?.details, "Idle")
  assert.equal(last()?.state, "my-app · 12.4K tokens · $0.0842")
  await controller.flush()
})

test("tracks usage updates while a turn is still running", async () => {
  const { controller, last } = setup({ config: { ...config, state: "{model} · {tokens} · {cost}" } })

  controller.handle(
    event("session.step.started", "s1", {
      model: { providerID: "opencode", id: "deepseek" },
      started: 1_700_000_000_000,
    }),
  )
  controller.handle(
    event("session.usage.updated", "s1", {
      cost: 0.0042,
      tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )

  assert.equal(last()?.state, "deepseek · 600 tokens · $0.0042")
  await controller.flush()
})

test("a second step does not restart the elapsed timer", async () => {
  const { controller, last } = setup()

  controller.handle(
    event("session.step.started", "s1", {
      model: { providerID: "opencode", id: "deepseek" },
      started: 1_700_000_000_000,
    }),
  )
  controller.handle(event("session.step.ended", "s1", { finish: "tool-calls" }))
  controller.handle(
    event("session.step.started", "s1", {
      model: { providerID: "opencode", id: "deepseek" },
      started: 1_700_000_005_000,
    }),
  )

  assert.deepEqual(last()?.timestamps, { start: 1_700_000_000_000 })
  await controller.flush()
})
