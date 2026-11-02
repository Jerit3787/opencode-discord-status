import type { DiscordActivity } from "./discord/client.ts"

export type PresenceStatus = "idle" | "busy" | "retry"

export interface TokenCounts {
  input: number
  output: number
}

export interface ActivitySnapshot {
  status: PresenceStatus
  project?: string
  sessionTitle?: string
  model?: string
  agent?: string
  attempt?: number
  startedAt?: number
  tokens?: TokenCounts
  cost?: number
}

export interface ActivityConfig {
  details: string
  state: string
  idleDetails: string
  idleState: string
  showElapsed: boolean
  largeImage?: string
  largeText?: string
  smallImage?: string
  smallText?: string
  buttons?: { label: string; url: string }[]
}

export type TemplateVariables = Record<string, string | number | undefined>

const STATUS_LABELS: Record<PresenceStatus, string> = {
  idle: "Idle",
  busy: "Working",
  retry: "Retrying",
}

const MAX_FIELD_LENGTH = 128
const MAX_BUTTON_LABEL_LENGTH = 32
const MAX_BUTTON_URL_LENGTH = 512

/**
 * Headline token count. Cache reads and writes are deliberately left out: they
 * run into the millions on every request and would swamp the number. They are
 * already reflected in `cost`, which OpenCode computes for us.
 */
export function formatTokens(tokens: TokenCounts | undefined): string | undefined {
  if (!tokens) return undefined
  const total = tokens.input + tokens.output
  if (!Number.isFinite(total) || total < 0) return undefined

  if (total >= 1_000_000) return `${oneDecimal(total / 1_000_000)}M`
  if (total >= 1_000) return `${oneDecimal(total / 1_000)}K`
  return String(Math.round(total))
}

export function formatCost(cost: number | undefined): string | undefined {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return undefined
  if (cost === 0) return "$0.00"
  if (cost >= 1) return `$${cost.toFixed(2)}`
  // Sub-dollar amounts keep four decimals so cheap models stay legible, but
  // trailing zeros are trimmed: $0.0100 reads worse than $0.01.
  return `$${cost.toFixed(4).replace(/(\.\d{2})0+$/, "$1")}`
}

function oneDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = variables[key]
      return value === undefined ? "" : String(value)
    })
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[·|]\s*)+/, "")
    .replace(/(?:\s*[·|])+$/, "")
    .trim()
}

export function truncate(text: string, maxLength = MAX_FIELD_LENGTH): string {
  const characters = [...text]
  if (characters.length <= maxLength) return text
  return `${characters.slice(0, maxLength - 1).join("")}…`
}

export function buildActivity(snapshot: ActivitySnapshot, config: ActivityConfig): DiscordActivity {
  const idle = snapshot.status === "idle"
  const tokenCount = formatTokens(snapshot.tokens)
  const variables: TemplateVariables = {
    project: snapshot.project,
    sessionTitle: snapshot.sessionTitle,
    model: snapshot.model,
    agent: snapshot.agent,
    status: STATUS_LABELS[snapshot.status],
    attempt: snapshot.attempt,
    tokens: tokenCount === undefined ? undefined : `${tokenCount} tokens`,
    tokenCount,
    cost: formatCost(snapshot.cost),
  }

  const details = truncate(
    renderTemplate(idle ? config.idleDetails : config.details, variables),
  )
  const state = truncate(renderTemplate(idle ? config.idleState : config.state, variables))

  const activity: DiscordActivity = {}
  if (details) activity.details = details
  if (state) activity.state = state
  if (!activity.details && !activity.state) activity.details = "OpenCode"

  if (
    !idle &&
    config.showElapsed &&
    typeof snapshot.startedAt === "number" &&
    Number.isFinite(snapshot.startedAt) &&
    snapshot.startedAt > 0
  ) {
    activity.timestamps = { start: Math.floor(snapshot.startedAt) }
  }

  const assets: NonNullable<DiscordActivity["assets"]> = {}
  if (config.largeImage) {
    assets.large_image = config.largeImage
    if (config.largeText) assets.large_text = truncate(config.largeText)
  }
  if (config.smallImage) {
    assets.small_image = config.smallImage
    if (config.smallText) assets.small_text = truncate(config.smallText)
  }
  if (Object.keys(assets).length > 0) activity.assets = assets

  const buttons = (config.buttons ?? [])
    .filter((button) => button.label.trim().length > 0 && isHttpUrl(button.url))
    .slice(0, 2)
    .map((button) => ({
      label: truncate(button.label.trim(), MAX_BUTTON_LABEL_LENGTH),
      url: button.url.trim().slice(0, MAX_BUTTON_URL_LENGTH),
    }))
  if (buttons.length > 0) activity.buttons = buttons

  return activity
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
