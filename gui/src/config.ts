import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Schema } from "effect"
import { type Config, StatusSchema, type Status } from "./contract"

export const DEFAULT_CONFIG: Config = {
  version: 1,
  enabled: true,
  autostart: true,
  showProject: true,
  showModel: true,
  showTokens: true,
  showCost: true,
  showElapsed: true,
  privateMode: false,
}

const BOOLEAN_FIELDS = [
  "enabled",
  "autostart",
  "showProject",
  "showModel",
  "showTokens",
  "showCost",
  "showElapsed",
  "privateMode",
] as const

export type ParsedConfig = { config: Config; error?: string }

type MutableConfig = { -readonly [Key in keyof Config]: Config[Key] }

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Parses a config tolerantly: valid fields apply, invalid ones keep defaults. */
export function parseConfig(text: string): ParsedConfig {
  const config: MutableConfig = { ...DEFAULT_CONFIG }
  if (text.trim() === "") return { config }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return { config, error: `Invalid JSON: ${messageOf(cause)}` }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { config, error: "Config must be a JSON object" }
  }

  const fields = parsed as Record<string, unknown>
  const invalid: string[] = []

  if ("version" in fields) {
    if (fields.version === 1) config.version = 1
    else invalid.push("version")
  }

  for (const key of BOOLEAN_FIELDS) {
    if (!(key in fields)) continue
    const value = fields[key]
    if (typeof value === "boolean") config[key] = value
    else invalid.push(key)
  }

  return invalid.length > 0
    ? { config, error: `Invalid config fields: ${invalid.join(", ")}` }
    : { config }
}

/** Mirrors os.UserConfigDir()/opencode-discord-status in the Go daemon. */
function configDir(): string {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || join(homedir(), "AppData", "Roaming")
    return join(base, "opencode-discord-status")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode-discord-status")
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode-discord-status")
}

export function configPath(): string {
  return join(configDir(), "config.json")
}

export function statusPath(): string {
  return join(configDir(), "status.json")
}

/** Reads the config; a missing file is the defaults, not an error. */
export async function readConfigFile(path: string): Promise<ParsedConfig> {
  try {
    return parseConfig(await readFile(path, "utf8"))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: { ...DEFAULT_CONFIG } }
    }
    return { config: { ...DEFAULT_CONFIG }, error: messageOf(cause) }
  }
}

/** Writes the config atomically with owner-only permissions. */
export async function writeConfigFile(path: string, config: Config): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
  } catch (cause) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw cause
  }
}

/** Reads the daemon status; a missing or malformed file is absent. */
export async function readStatusFile(path: string): Promise<Status | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"))
    return Schema.decodeUnknownSync(StatusSchema)(parsed)
  } catch {
    return undefined
  }
}
