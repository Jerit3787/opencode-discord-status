import { execFileSync } from "node:child_process"

/** Process names that mean "OpenCode is open": the app, its service, or the CLI. */
const OPEN_CODE_NAMES = new Set(["opencode", "opencode-cli", "OpenCode"])

/** Parse `ps -Ao comm=` output. Kept separate so it can be tested. */
export function hasOpenCodeProcess(output: string): boolean {
  return output.split("\n").some((line) => {
    const name = line.trim().split("/").pop() ?? ""
    return OPEN_CODE_NAMES.has(name)
  })
}

/**
 * Is OpenCode running on this machine?
 *
 * Looks at executable names, not full command lines, so the watcher's own
 * `opencode-discord-status` path can never match itself. If `ps` fails, assume
 * it is running: better to keep the card than to silently disappear.
 */
export function openCodeRunning(): boolean {
  try {
    const output = execFileSync("ps", ["-Ao", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return hasOpenCodeProcess(output)
  } catch {
    return true
  }
}
