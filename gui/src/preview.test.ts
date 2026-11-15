import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "./config"
import type { Status } from "./contract"
import { buildPreview, isStatusStale } from "./preview"

const baseStatus: Status = {
  version: 1,
  pid: 123,
  daemonVersion: "1.1.0",
  enabled: true,
  discordConnected: true,
  source: "opencode database",
  project: "opencode-discord-status",
  model: "DeepSeek V4.1 Flash",
  tokens: 12_345,
  costUSD: 0.0421,
  startedAt: new Date().toISOString(),
  busy: true,
  updatedAt: new Date().toISOString(),
}

describe("buildPreview", () => {
  it("mirrors the daemon formatting rules", () => {
    const status = {
      ...baseStatus,
      project: "demo",
      model: "DeepSeek V4.1 Flash",
      tokens: 12_300,
      costUSD: 0.0421,
      busy: true,
      startedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    }

    expect(buildPreview({ ...DEFAULT_CONFIG }, status, Date.now()).details).toBe(
      "Working on: demo",
    )
    expect(buildPreview({ ...DEFAULT_CONFIG }, status, Date.now()).state).toBe(
      "DeepSeek V4.1 Flash | 12.3K tokens | $0.0421",
    )
    expect(buildPreview({ ...DEFAULT_CONFIG }, status, Date.now()).elapsed).toMatch(/^00:4[45]:/)
    expect(
      buildPreview({ ...DEFAULT_CONFIG, privateMode: true }, status, Date.now()).details,
    ).toBe("Working on: a session")
    expect(
      buildPreview({ ...DEFAULT_CONFIG, showElapsed: false }, status, Date.now()).elapsed,
    ).toBeUndefined()
    expect(
      buildPreview(
        { ...DEFAULT_CONFIG, showModel: false, showTokens: false, showCost: false },
        status,
        Date.now(),
      ).state,
    ).toBe("OpenCode")
    expect(
      buildPreview({ ...DEFAULT_CONFIG, showProject: false }, status, Date.now()).details,
    ).toBe("Working on: a session")
  })

  it("formats idle sessions", () => {
    const idle = { ...baseStatus, busy: false, project: "demo", tokens: 12_300, costUSD: 0.0421 }
    expect(buildPreview({ ...DEFAULT_CONFIG }, idle, Date.now())).toMatchObject({
      details: "Idle",
      state: "demo | 12.3K tokens | $0.0421",
    })
    expect(
      buildPreview({ ...DEFAULT_CONFIG, privateMode: true }, idle, Date.now()).state,
    ).toBe("12.3K tokens | $0.0421")
    expect(buildPreview({ ...DEFAULT_CONFIG }, idle, Date.now()).elapsed).toBeUndefined()
  })

  it("uses sample values when status is stale or missing", () => {
    const missing = buildPreview({ ...DEFAULT_CONFIG }, undefined, Date.now())
    expect(missing.sample).toBe(true)
    expect(missing.details).toContain("my-project")
    expect(missing.state).toContain("12.3K tokens")

    const stale = buildPreview(
      { ...DEFAULT_CONFIG },
      { ...baseStatus, updatedAt: new Date(Date.now() - 11_000).toISOString() },
      Date.now(),
    )
    expect(stale.sample).toBe(true)
  })

  it("uses the real status when fresh", () => {
    const preview = buildPreview({ ...DEFAULT_CONFIG }, baseStatus, Date.now())
    expect(preview.sample).toBe(false)
    expect(preview.details).toBe("Working on: opencode-discord-status")
  })
})

describe("isStatusStale", () => {
  it("detects missing and old status", () => {
    expect(isStatusStale(undefined, Date.now())).toBe(true)
    expect(
      isStatusStale(
        { ...baseStatus, updatedAt: new Date(Date.now() - 11_000).toISOString() },
        Date.now(),
      ),
    ).toBe(true)
    expect(
      isStatusStale({ ...baseStatus, updatedAt: new Date().toISOString() }, Date.now()),
    ).toBe(false)
  })

  it("treats an unparseable timestamp as stale", () => {
    expect(isStatusStale({ ...baseStatus, updatedAt: "not-a-date" }, Date.now())).toBe(true)
  })
})
