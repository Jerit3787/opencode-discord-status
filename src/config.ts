import type { ActivityConfig } from "./activity.ts"

export interface PluginConfig extends ActivityConfig {
  clientId: string
  enabled: boolean
  /** Publish straight to Discord on this machine. Turn off when the host has no Discord. */
  discord: boolean
  /** Mirror the rendered card to this file so a bridge can read it over SSH. */
  stateFile?: string
  buttons: { label: string; url: string }[]
  minUpdateIntervalMs: number
  reconnect: boolean
  debug: boolean
}

export type ConfigResult =
  | { ok: true; config: PluginConfig }
  | { ok: false; error: string }

const CLIENT_ID_PATTERN = /^\d{17,20}$/
const DEFAULT_MIN_UPDATE_INTERVAL_MS = 4_000
const MIN_UPDATE_INTERVAL_MS = 1_000
const MAX_UPDATE_INTERVAL_MS = 60_000

export function parseConfig(options: Readonly<Record<string, unknown>>): ConfigResult {
  const rawClientId = options.clientId

  if (typeof rawClientId === "number") {
    return {
      ok: false,
      error:
        'clientId must be a string. Discord application IDs are too large for JavaScript numbers, so quote it in opencode.json (e.g. "123456789012345678").',
    }
  }

  if (typeof rawClientId !== "string" || rawClientId.trim().length === 0) {
    return {
      ok: false,
      error:
        "clientId is required. Create a Discord application at https://discord.com/developers/applications and add its Application ID as clientId.",
    }
  }

  const clientId = rawClientId.trim()
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return {
      ok: false,
      error:
        "clientId must be the 17-20 digit Application ID from your Discord application. Copy it from the General Information page.",
    }
  }

  const config: PluginConfig = {
    clientId,
    enabled: booleanOr(options.enabled, true),
    discord: booleanOr(options.discord, true),
    details: stringOr(options.details, "{project}"),
    state: stringOr(options.state, "{model} · {tokens} · {cost}"),
    idleDetails: stringOr(options.idleDetails, "Idle"),
    idleState: stringOr(options.idleState, "{project} · {tokens} · {cost}"),
    showElapsed: booleanOr(options.showElapsed, true),
    largeText: stringOr(options.largeText, "OpenCode"),
    buttons: parseButtons(options.buttons),
    minUpdateIntervalMs: clampInterval(options.minUpdateIntervalMs),
    reconnect: booleanOr(options.reconnect, true),
    debug: booleanOr(options.debug, false),
  }

  const stateFile = stringOrUndefined(options.stateFile)
  if (stateFile) config.stateFile = stateFile

  if (!config.discord && !config.stateFile) {
    return {
      ok: false,
      error:
        'Nothing to publish: set "discord": true (default) or "stateFile" to a path a bridge can read. On a remote host, use "discord": false with "stateFile".',
    }
  }

  const largeImage = stringOrUndefined(options.largeImage)
  if (largeImage) config.largeImage = largeImage

  const smallImage = stringOrUndefined(options.smallImage)
  if (smallImage) config.smallImage = smallImage

  const smallText = stringOrUndefined(options.smallText)
  if (smallText) config.smallText = smallText

  return { ok: true, config }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function clampInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MIN_UPDATE_INTERVAL_MS
  }
  return Math.min(Math.max(Math.round(value), MIN_UPDATE_INTERVAL_MS), MAX_UPDATE_INTERVAL_MS)
}

function parseButtons(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((entry): entry is { label: string; url: string } => {
      if (typeof entry !== "object" || entry === null) return false
      const button = entry as { label?: unknown; url?: unknown }
      return typeof button.label === "string" && typeof button.url === "string"
    })
    .slice(0, 2)
    .map((button) => ({ label: button.label, url: button.url }))
}
