import { homedir } from "node:os"
import { basename, join } from "node:path"

import type { ActivitySnapshot } from "./activity.ts"

export const DEFAULT_DB_PATH = "~/.local/share/opencode/opencode.db"
export const DEFAULT_IDLE_AFTER_MS = 15 * 60 * 1_000
export const DEFAULT_SWITCH_MARGIN_MS = 10_000

/**
 * The newest non-archived session plus its last assistant message.
 *
 * OpenCode V2 keeps current sessions in `session_v2` / `session_message`; the
 * `session`, `message`, and `part` tables are the V1 layout.
 */
export const SESSION_QUERY = `select
  s.id as session_id,
  s.directory as directory,
  s.title as title,
  s.model as model,
  s.agent as agent,
  s.cost as cost,
  s.tokens_input as tokens_input,
  s.tokens_output as tokens_output,
  s.time_updated as time_updated,
  m.data as message
from session_v2 s
left join session_message m on m.id = (
  select id from session_message
  where session_id = s.id and type = 'assistant'
  order by seq desc limit 1
)
where s.time_archived is null
order by s.time_updated desc
limit 20`

export interface SessionRow {
  session_id?: string
  directory?: string | null
  title?: string | null
  model?: string | null
  agent?: string | null
  cost?: number | null
  tokens_input?: number | null
  tokens_output?: number | null
  time_updated?: number | null
  message?: string | null
}

interface MessageData {
  time?: { created?: number; streamed?: number; completed?: number }
  finish?: string
  agent?: string
  model?: { id?: string }
}

const BRANDS: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  gpt: "GPT",
  glm: "GLM",
  kimi: "Kimi",
  minimax: "MiniMax",
  claude: "Claude",
  gemini: "Gemini",
  qwen: "Qwen",
  llama: "Llama",
  mistral: "Mistral",
  grok: "Grok",
  mimo: "MiMo",
}

/**
 * Turn a database row into a card.
 *
 * Busy means the last assistant message is still streaming, or it finished
 * asking for tools. Anything else — including a session that has not changed
 * for `idleAfterMs` — is idle.
 */
export function snapshotFromRow(
  row: SessionRow | undefined,
  now: number = Date.now(),
  idleAfterMs: number = DEFAULT_IDLE_AFTER_MS,
): ActivitySnapshot {
  return row ? analyze(row, now, idleAfterMs).snapshot : { status: "idle" }
}

export interface PickSessionOptions {
  /** Session currently on the card. Kept unless another is clearly newer. */
  incumbent?: string
  /** How much newer another session must be before it takes over. */
  switchMarginMs?: number
}

/**
 * Choose the session that should own the card: a busy one beats an idle one,
 * then the most recently written wins. Mirrors the plugin's hub so two open
 * projects do not flicker between idle and working.
 */
export function pickSessionRow(
  rows: readonly SessionRow[],
  now: number = Date.now(),
  idleAfterMs: number = DEFAULT_IDLE_AFTER_MS,
  options: PickSessionOptions = {},
): SessionRow | undefined {
  let best: { row: SessionRow; busy: boolean; updated: number } | undefined

  for (const row of rows) {
    const analysis = analyze(row, now, idleAfterMs)
    if (
      !best ||
      (analysis.busy && !best.busy) ||
      (analysis.busy === best.busy && analysis.updated > best.updated)
    ) {
      best = { row, busy: analysis.busy, updated: analysis.updated }
    }
  }

  if (!best) return undefined

  const incumbent = options.incumbent
    ? rows.find((row) => row.session_id === options.incumbent)
    : undefined
  if (!incumbent) return best.row

  const current = analyze(incumbent, now, idleAfterMs)
  const margin = options.switchMarginMs ?? DEFAULT_SWITCH_MARGIN_MS

  // Keep the current session unless the challenger is in a different state or
  // has been active for a while longer. Prevents millisecond-level flapping
  // between two sessions that are both working.
  if (current.busy && !best.busy) return incumbent
  if (current.busy === best.busy && best.updated - current.updated < margin) {
    return incumbent
  }

  return best.row
}

interface Analysis {
  snapshot: ActivitySnapshot
  busy: boolean
  updated: number
}

function analyze(row: SessionRow, now: number, idleAfterMs: number): Analysis {
  const message = parseJson<MessageData>(row.message)
  const updated = numberOrUndefined(row.time_updated) ?? 0
  const fresh = updated > 0 && now - updated <= idleAfterMs
  const streaming =
    message !== undefined &&
    message.time?.completed === undefined &&
    message.finish === undefined
  const waitingOnTools = message?.finish === "tool-calls"
  const busy = fresh && (streaming || waitingOnTools)

  const model = modelId(row.model) ?? message?.model?.id
  const input = numberOrUndefined(row.tokens_input)
  const output = numberOrUndefined(row.tokens_output)

  return {
    busy,
    updated,
    snapshot: {
      status: busy ? "busy" : "idle",
      project: row.directory ? basename(row.directory) : undefined,
      model: formatModelName(model),
      agent: row.agent ?? message?.agent ?? undefined,
      cost: numberOrUndefined(row.cost),
      tokens: input !== undefined && output !== undefined ? { input, output } : undefined,
      startedAt: busy ? message?.time?.created : undefined,
    },
  }
}

/** `deepseek-v4.1-flash` → `DeepSeek V4.1 Flash`. */
export function formatModelName(id: string | undefined): string | undefined {
  if (!id) return undefined
  const parts = id.split(/[-_/]+/).filter(Boolean)
  if (parts.length === 0) return id
  return parts.map(formatPart).join(" ")
}

export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

function formatPart(part: string): string {
  const lower = part.toLowerCase()
  if (BRANDS[lower]) return BRANDS[lower]
  if (/^v?\d+(?:\.\d+)*$/.test(lower)) {
    return lower.startsWith("v") ? `V${lower.slice(1)}` : lower
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function modelId(value: unknown): string | undefined {
  const parsed = parseJson<{ id?: unknown }>(typeof value === "string" ? value : undefined)
  return typeof parsed?.id === "string" ? parsed.id : undefined
}

function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
