import type { Config, Status } from "./contract"

export type Preview = {
  details: string
  state: string
  elapsed?: string
  sample: boolean
}

const STALE_AFTER_MS = 10_000
const SAMPLE_STARTED_MS = 45 * 60_000

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000
    if (thousands >= 999.95) return "1.0M"
    return `${thousands.toFixed(1)}K`
  }
  return String(tokens)
}

export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00"
  if (cost >= 1) return `$${cost.toFixed(2)}`

  let value = cost.toFixed(4).replace(/0+$/, "")
  if (value.endsWith(".")) {
    value += "00"
  } else {
    const decimals = value.length - value.indexOf(".") - 1
    if (decimals < 2) value += "0".repeat(2 - decimals)
  }
  return `$${value}`
}

function formatElapsed(startedAt: string | undefined, now: number): string {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN
  if (!Number.isFinite(start)) return "00:00:00"

  const total = Math.max(0, Math.floor((now - start) / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
}

type PreviewData = {
  project: string
  model: string
  tokens: number
  costUSD: number
  startedAt?: string
  busy: boolean
}

function detailsFor(data: PreviewData, config: Config): string {
  if (!data.busy) return "Idle"
  if (config.privateMode || !config.showProject) return "Working on: a session"
  if (data.project !== "") return `Working on: ${data.project}`
  return "Working on: OpenCode"
}

function stateFor(data: PreviewData, config: Config): string {
  const parts: string[] = []

  if (data.busy) {
    if (config.showModel) parts.push(data.model !== "" ? data.model : "OpenCode")
  } else if (config.showProject && !config.privateMode && data.project !== "") {
    parts.push(data.project)
  }

  if (config.showTokens) parts.push(`${formatTokens(data.tokens)} tokens`)
  if (config.showCost) parts.push(formatCost(data.costUSD))

  return parts.length > 0 ? parts.join(" | ") : "OpenCode"
}

export function isStatusStale(status: Status | undefined, now: number): boolean {
  if (!status) return true
  const updated = Date.parse(status.updatedAt)
  if (!Number.isFinite(updated)) return true
  return now - updated > STALE_AFTER_MS
}

/**
 * Builds the two Discord lines plus the elapsed line. Fresh daemon status wins;
 * otherwise a sample session demonstrates the selected format.
 */
export function buildPreview(config: Config, status: Status | undefined, now: number): Preview {
  const fresh = status !== undefined && !isStatusStale(status, now)
  const data: PreviewData = fresh
    ? {
        project: status.project,
        model: status.model,
        tokens: status.tokens,
        costUSD: status.costUSD,
        startedAt: status.startedAt,
        busy: status.busy,
      }
    : {
        project: "my-project",
        model: "DeepSeek V4.1 Flash",
        tokens: 12_300,
        costUSD: 0.0421,
        startedAt: new Date(now - SAMPLE_STARTED_MS).toISOString(),
        busy: true,
      }

  const elapsed =
    config.showElapsed && data.busy ? formatElapsed(data.startedAt, now) : undefined
  return {
    details: detailsFor(data, config),
    state: stateFor(data, config),
    ...(elapsed !== undefined ? { elapsed } : {}),
    sample: !fresh,
  }
}
