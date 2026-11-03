import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BINARY = join(ROOT, "bin", "opencode-discord-status")
const LOG = join(ROOT, "watch.log")
const KEY = Symbol.for("opencode-discord-status.autostart")
const CHECK_INTERVAL_MS = 2_000

interface Entry {
  refs: number
  timer?: ReturnType<typeof setInterval>
  child?: ChildProcess
}

type Global = Record<symbol, unknown>

// The desktop app's `opencode-cli serve --service` child outlives the app, so
// it is not evidence that OpenCode is open. A normal CLI/TUI process is.
function isOpenCodeRunning(): boolean {
  try {
    const comm = execFileSync("ps", ["-Ao", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    if (comm.split("\n").some((line) => basename(line.trim()) === "OpenCode")) {
      return true
    }

    const args = execFileSync("ps", ["-Ao", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return args.split("\n").some((line) => {
      const fields = line.trim().split(/\s+/)
      const name = basename(fields[0] ?? "")
      if (name === "opencode") return true
      if (name === "opencode-cli") return !fields.includes("--service")
      return false
    })
  } catch {
    return true
  }
}

function startWatcher(entry: Entry): void {
  let log: number | undefined
  try {
    log = openSync(LOG, "a")
  } catch {
    log = undefined
  }

  const child = spawn(BINARY, ["--exit-when-closed", "--debug"], {
    detached: false,
    stdio: ["ignore", log ?? "ignore", log ?? "ignore"],
  })
  if (log !== undefined) closeSync(log)

  child.on("error", (error) => {
    console.error(`[opencode-discord-status] could not start ${BINARY}: ${error.message}`)
  })
  child.on("exit", () => {
    if (entry.child === child) entry.child = undefined
  })

  entry.child = child
}

function supervise(entry: Entry): void {
  entry.timer = setInterval(() => {
    if (isOpenCodeRunning()) {
      if (!entry.child || entry.child.exitCode !== null || entry.child.killed) {
        startWatcher(entry)
      }
      return
    }

    if (entry.child) {
      entry.child.kill("SIGTERM")
      entry.child = undefined
    }
  }, CHECK_INTERVAL_MS)

  entry.timer.unref?.()
  if (isOpenCodeRunning()) startWatcher(entry)
}

export default {
  id: "opencode-discord-status-autostart",

  async setup() {
    const globals = globalThis as Global
    let entry = globals[KEY] as Entry | undefined

    if (!entry) {
      entry = { refs: 0 }
      globals[KEY] = entry
      supervise(entry)
    }

    entry.refs += 1
    const current = entry
    let released = false

    return async () => {
      if (released) return
      released = true

      current.refs -= 1
      if (current.refs > 0) return

      if (current.timer) clearInterval(current.timer)
      current.child?.kill("SIGTERM")
      if (globals[KEY] === current) delete globals[KEY]
    }
  },
}
