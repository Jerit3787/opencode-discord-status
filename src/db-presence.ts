import { basename } from "node:path"

import type { ActivitySnapshot } from "./activity.ts"
import { quoteRemotePath } from "./bridge.ts"

export const DEFAULT_DB_PATH = "~/.local/share/opencode/opencode.db"
export const DEFAULT_IDLE_AFTER_MS = 15 * 60 * 1_000

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
limit 1`

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

/** Parse one line of `sqlite3 -json` or Python output. */
export function parseFrame(line: string): SessionRow[] | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return undefined
    return parsed as SessionRow[]
  } catch {
    return undefined
  }
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
  if (!row) return { status: "idle" }

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
    status: busy ? "busy" : "idle",
    project: row.directory ? basename(row.directory) : undefined,
    model: formatModelName(model),
    agent: row.agent ?? message?.agent ?? undefined,
    cost: numberOrUndefined(row.cost),
    tokens: input !== undefined && output !== undefined ? { input, output } : undefined,
    startedAt: busy ? message?.time?.created : undefined,
  }
}

/** `deepseek-v4.1-flash` → `DeepSeek V4.1 Flash`. */
export function formatModelName(id: string | undefined): string | undefined {
  if (!id) return undefined
  const parts = id.split(/[-_/]+/).filter(Boolean)
  if (parts.length === 0) return id
  return parts.map(formatPart).join(" ")
}

/**
 * Run a loop on the host that prints one JSON array per interval. `sqlite3` is
 * preferred; `python3` is the fallback because minimal servers often have one
 * but not the other.
 */
export function buildRemoteScript(
  dbPath: string,
  intervalSeconds: number,
  sql: string = SESSION_QUERY,
): string {
  const seconds = Math.max(1, Math.round(intervalSeconds))

  return `db=${quoteRemotePath(dbPath)}
interval=${seconds}
sql=${shellQuote(sql)}

if command -v sqlite3 >/dev/null 2>&1 && sqlite3 :memory: -json 'select 1' >/dev/null 2>&1; then
  while :; do
    out=$(sqlite3 -readonly -json "$db" "$sql" 2>/dev/null) || out='[]'
    printf '%s\\n' "\${out:-[]}"
    sleep "$interval"
  done
elif command -v python3 >/dev/null 2>&1; then
  while :; do
    out=$(python3 - "$db" "$sql" <<'PY' 2>/dev/null
import json, sqlite3, sys
con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
con.row_factory = sqlite3.Row
print(json.dumps([dict(row) for row in con.execute(sys.argv[2])]))
PY
) || out='[]'
    printf '%s\\n' "\${out:-[]}"
    sleep "$interval"
  done
else
  printf 'opencode-discord-status: install sqlite3 or python3 on the host\\n' >&2
  exit 1
fi
`
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
