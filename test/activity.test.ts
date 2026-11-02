import test from "node:test"
import assert from "node:assert/strict"

import {
  buildActivity,
  renderTemplate,
  type ActivityConfig,
  type ActivitySnapshot,
} from "../src/activity.ts"

const config: ActivityConfig = {
  details: "{project}",
  state: "{model}",
  idleDetails: "Idle",
  idleState: "{project}",
  showElapsed: true,
}

function snapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
  return {
    status: "busy",
    project: "opencode-discord-status",
    model: "deepseek-v4.1-flash",
    ...overrides,
  }
}

test("busy presence shows the project and model with an elapsed timer", () => {
  const activity = buildActivity(snapshot({ startedAt: 1_700_000_000_000 }), config)

  assert.deepEqual(activity, {
    details: "opencode-discord-status",
    state: "deepseek-v4.1-flash",
    timestamps: { start: 1_700_000_000_000 },
  })
})

test("idle presence uses idle templates and hides the elapsed timer", () => {
  const activity = buildActivity(snapshot({ status: "idle", startedAt: 1_700_000_000_000 }), config)

  assert.deepEqual(activity, {
    details: "Idle",
    state: "opencode-discord-status",
  })
})

test("templates can use session, agent, status, and attempt", () => {
  const activity = buildActivity(
    snapshot({
      status: "retry",
      sessionTitle: "Fix the login bug",
      agent: "build",
      attempt: 3,
    }),
    {
      ...config,
      details: "{sessionTitle} · {project}",
      state: "{status} ({attempt}) · {agent}",
    },
  )

  assert.equal(activity.details, "Fix the login bug · opencode-discord-status")
  assert.equal(activity.state, "Retrying (3) · build")
})

test("missing values collapse without dangling separators", () => {
  const activity = buildActivity(snapshot({ project: undefined, model: undefined }), {
    ...config,
    details: "Working on {project}",
    state: "{model}",
  })

  assert.equal(activity.details, "Working on")
  assert.equal(activity.state, undefined)
})

test("falls back to OpenCode when every template field is empty", () => {
  const activity = buildActivity(snapshot({ project: undefined, model: undefined }), {
    ...config,
    details: "",
    state: "",
    idleDetails: "",
    idleState: "",
  })

  assert.deepEqual(activity, { details: "OpenCode" })
})

test("truncates Discord fields to 128 code points", () => {
  const long = "🚀".repeat(200)
  const activity = buildActivity(snapshot({ project: long }), config)

  assert.equal([...activity.details!].length, 128)
  assert.ok(activity.details!.endsWith("…"))
})

test("omits the elapsed timer when disabled or unknown", () => {
  assert.equal(buildActivity(snapshot({ startedAt: 123 }), { ...config, showElapsed: false }).timestamps, undefined)
  assert.equal(buildActivity(snapshot(), config).timestamps, undefined)
})

test("only includes image assets that are configured", () => {
  assert.equal(buildActivity(snapshot(), config).assets, undefined)

  const activity = buildActivity(snapshot(), {
    ...config,
    largeImage: "opencode",
    largeText: "OpenCode",
    smallImage: "busy",
    smallText: "Working",
  })

  assert.deepEqual(activity.assets, {
    large_image: "opencode",
    large_text: "OpenCode",
    small_image: "busy",
    small_text: "Working",
  })
})

test("keeps at most two valid http buttons", () => {
  const activity = buildActivity(snapshot(), {
    ...config,
    buttons: [
      { label: "Docs", url: "https://opencode.ai/docs" },
      { label: "Bad", url: "javascript:alert(1)" },
      { label: "GitHub", url: "https://github.com/sst/opencode" },
      { label: "Extra", url: "https://example.com" },
    ],
  })

  assert.deepEqual(activity.buttons, [
    { label: "Docs", url: "https://opencode.ai/docs" },
    { label: "GitHub", url: "https://github.com/sst/opencode" },
  ])
})

test("renderTemplate ignores unknown variables and normalizes whitespace", () => {
  assert.equal(renderTemplate("  {a}   {missing}  {b} ", { a: "one", b: "two" }), "one two")
})

test("renders tokens and cost in the state line", () => {
  const activity = buildActivity(
    snapshot({
      tokens: { input: 11_800, output: 460 },
      cost: 0.0421,
    }),
    { ...config, state: "{model} · {tokens} · {cost}" },
  )

  assert.equal(activity.state, "deepseek-v4.1-flash · 12.3K tokens · $0.0421")
})

test("formats large token counts in millions and rounds small ones", () => {
  const million = buildActivity(snapshot({ tokens: { input: 1_240_000, output: 60_000 } }), {
    ...config,
    state: "{tokens}",
  })
  const small = buildActivity(snapshot({ tokens: { input: 812, output: 45 } }), {
    ...config,
    state: "{tokens}",
  })

  assert.equal(million.state, "1.3M tokens")
  assert.equal(small.state, "857 tokens")
})

test("formats cost with more precision below a cent", () => {
  const tiny = buildActivity(snapshot({ cost: 0.00042 }), { ...config, state: "{cost}" })
  const free = buildActivity(snapshot({ cost: 0 }), { ...config, state: "{cost}" })
  const normal = buildActivity(snapshot({ cost: 3.4567 }), { ...config, state: "{cost}" })

  assert.equal(tiny.state, "$0.0004")
  assert.equal(free.state, "$0.00")
  assert.equal(normal.state, "$3.46")
})

test("drops the usage segments when a session has no numbers yet", () => {
  const activity = buildActivity(snapshot(), {
    ...config,
    state: "{model} · {tokens} · {cost}",
  })

  assert.equal(activity.state, "deepseek-v4.1-flash")
})

test("exposes a bare token count for compact layouts", () => {
  const activity = buildActivity(snapshot({ tokens: { input: 5_000, output: 100 } }), {
    ...config,
    state: "{tokenCount} tok",
  })

  assert.equal(activity.state, "5.1K tok")
})
