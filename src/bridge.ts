import type { DiscordActivity } from "./discord/client.ts"

export const DEFAULT_STATE_PATH = "~/.local/state/opencode-discord-status/presence.json"

/**
 * Turn one line from the remote state file into an activity.
 *
 * Returns `undefined` for blank or malformed lines (nothing to do), `null` for
 * an explicit clear, and an activity otherwise.
 */
export function parsePresenceLine(line: string): DiscordActivity | null | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  let frame: unknown
  try {
    frame = JSON.parse(trimmed)
  } catch {
    return undefined
  }

  if (typeof frame !== "object" || frame === null) return undefined
  const activity = (frame as { activity?: unknown }).activity

  if (activity === null) return null
  if (typeof activity !== "object" || activity === null) return undefined
  return activity as DiscordActivity
}

/**
 * Quote a remote path for the shell `ssh` hands the command to. A leading `~`
 * must stay outside single quotes so the remote shell can expand it.
 */
export function quoteRemotePath(path: string): string {
  if (path === "~") return '"$HOME"'
  if (path.startsWith("~/")) return `"$HOME/${escapeDoubleQuoted(path.slice(2))}"`
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/** Print the last frame and follow the file as the plugin rewrites it. */
export function buildTailCommand(path: string): string {
  return `tail -n 1 -F ${quoteRemotePath(path)}`
}

function escapeDoubleQuoted(value: string): string {
  return value.replace(/[\\"$`]/g, (character) => `\\${character}`)
}
