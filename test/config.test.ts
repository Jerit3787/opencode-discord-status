import test from "node:test"
import assert from "node:assert/strict"

import { parseConfig } from "../src/config.ts"

const valid = { clientId: "123456789012345678" }

test("applies sensible defaults", () => {
  const result = parseConfig(valid)

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.config, {
    clientId: "123456789012345678",
    enabled: true,
    details: "{project}",
    state: "{model} · {tokens} · {cost}",
    idleDetails: "Idle",
    idleState: "{project} · {tokens} · {cost}",
    showElapsed: true,
    largeText: "OpenCode",
    buttons: [],
    minUpdateIntervalMs: 4_000,
    reconnect: true,
    debug: false,
  })
})

test("requires a client id", () => {
  const result = parseConfig({})

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /clientId/)
  assert.match(result.error, /Discord application/i)
})

test("rejects numeric client ids with a quoting hint", () => {
  const result = parseConfig({ clientId: 123456789012345678 })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /string/i)
  assert.match(result.error, /quote/i)
})

test("rejects malformed client ids", () => {
  for (const clientId of ["", "abc", "123", "12345678901234567x"]) {
    const result = parseConfig({ clientId })
    assert.equal(result.ok, false, `expected ${JSON.stringify(clientId)} to be rejected`)
  }
})

test("clamps the update interval to Discord-safe values", () => {
  const low = parseConfig({ ...valid, minUpdateIntervalMs: 0 })
  const high = parseConfig({ ...valid, minUpdateIntervalMs: 999_999 })

  assert.equal(low.ok && low.config.minUpdateIntervalMs, 1_000)
  assert.equal(high.ok && high.config.minUpdateIntervalMs, 60_000)
})

test("keeps custom templates, assets, and buttons", () => {
  const result = parseConfig({
    ...valid,
    details: "Working on {project}",
    state: "{sessionTitle}",
    idleDetails: "Away",
    idleState: "{project}",
    showElapsed: false,
    largeImage: "opencode",
    largeText: "OpenCode",
    smallImage: "busy",
    smallText: "Coding",
    buttons: [
      { label: "Docs", url: "https://opencode.ai/docs" },
      { label: "GitHub", url: "https://github.com/sst/opencode" },
    ],
    reconnecting: false,
    reconnect: false,
    debug: true,
  })

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.config.details, "Working on {project}")
  assert.equal(result.config.state, "{sessionTitle}")
  assert.equal(result.config.idleDetails, "Away")
  assert.equal(result.config.showElapsed, false)
  assert.equal(result.config.largeImage, "opencode")
  assert.equal(result.config.smallImage, "busy")
  assert.equal(result.config.buttons.length, 2)
  assert.equal(result.config.reconnect, false)
  assert.equal(result.config.debug, true)
})

test("treats largeImage: false as disabled", () => {
  const result = parseConfig({ ...valid, largeImage: false })

  assert.equal(result.ok && result.config.largeImage, undefined)
})

test("passes through enabled: false", () => {
  const result = parseConfig({ ...valid, enabled: false })

  assert.equal(result.ok && result.config.enabled, false)
})

test("ignores invalid optional values instead of throwing", () => {
  const result = parseConfig({
    ...valid,
    details: 42,
    showElapsed: "yes",
    minUpdateIntervalMs: "fast",
    reconnect: "nope",
    buttons: "docs",
    debug: 1,
  })

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.config.details, "{project}")
  assert.equal(result.config.showElapsed, true)
  assert.equal(result.config.minUpdateIntervalMs, 4_000)
  assert.equal(result.config.reconnect, true)
  assert.deepEqual(result.config.buttons, [])
  assert.equal(result.config.debug, false)
})

test("filters malformed buttons and keeps at most two", () => {
  const result = parseConfig({
    ...valid,
    buttons: [
      { label: "Docs", url: "https://opencode.ai/docs" },
      { label: 1, url: "https://example.com" },
      { label: "No URL" },
      { label: "GitHub", url: "https://github.com/sst/opencode" },
      { label: "Extra", url: "https://example.com" },
    ],
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.config.buttons, [
    { label: "Docs", url: "https://opencode.ai/docs" },
    { label: "GitHub", url: "https://github.com/sst/opencode" },
  ])
})
