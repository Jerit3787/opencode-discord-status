import { mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  configPath,
  DEFAULT_CONFIG,
  parseConfig,
  readConfigFile,
  readStatusFile,
  statusPath,
  writeConfigFile,
} from "./config"

describe("parseConfig", () => {
  it("returns defaults for empty or malformed input", () => {
    expect(parseConfig("")).toEqual({ config: DEFAULT_CONFIG })
    expect(parseConfig("{not json").config).toEqual(DEFAULT_CONFIG)
    expect(parseConfig("{not json").error).toBeTruthy()
    expect(parseConfig("[]").config).toEqual(DEFAULT_CONFIG)
    expect(parseConfig("[]").error).toBeTruthy()
  })

  it("keeps valid fields and reports wrong-typed ones", () => {
    const result = parseConfig(
      JSON.stringify({ enabled: false, showCost: false, showModel: "yes" }),
    )
    expect(result.config.enabled).toBe(false)
    expect(result.config.showCost).toBe(false)
    expect(result.config.showModel).toBe(true)
    expect(result.error).toContain("showModel")
  })

  it("accepts a complete config and ignores unknown fields", () => {
    const result = parseConfig(
      JSON.stringify({ ...DEFAULT_CONFIG, enabled: false, futureField: "ignored" }),
    )
    expect(result).toEqual({ config: { ...DEFAULT_CONFIG, enabled: false } })
  })
})

it("round-trips a config atomically with owner-only permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ods-config-"))
  const path = join(dir, "config.json")
  await writeConfigFile(path, { ...DEFAULT_CONFIG, enabled: false })

  const read = await readConfigFile(path)
  expect(read).toEqual({ config: { ...DEFAULT_CONFIG, enabled: false } })

  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  }
})

it("returns defaults when the config is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ods-config-missing-"))
  expect(await readConfigFile(join(dir, "absent.json"))).toEqual({ config: DEFAULT_CONFIG })
})

it("uses the opencode-discord-status config directory", () => {
  expect(configPath()).toMatch(/opencode-discord-status[\\/]config\.json$/)
  expect(statusPath()).toMatch(/opencode-discord-status[\\/]status\.json$/)
})

it("treats a malformed status file as absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ods-status-"))
  const path = join(dir, "status.json")
  await writeFile(path, "{not json")
  expect(await readStatusFile(path)).toBeUndefined()
})

it("rejects a status with a missing required field", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ods-status-invalid-"))
  const path = join(dir, "status.json")
  await writeFile(path, JSON.stringify({ version: 1, pid: 1 }))
  expect(await readStatusFile(path)).toBeUndefined()
})
