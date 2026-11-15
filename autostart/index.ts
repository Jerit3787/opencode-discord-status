import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { closeSync, openSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
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

function stopSupervisor(globals: Global): void {
  const entry = globals[KEY] as Entry | undefined
  if (!entry) return

  if (entry.timer) clearInterval(entry.timer)
  entry.child?.kill("SIGTERM")
  delete globals[KEY]
}

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

// Mirrors os.UserConfigDir()/opencode-discord-status in the daemon.
function configDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "opencode-discord-status")
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode-discord-status")
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode-discord-status")
}

// The settings page writes this switch. A missing or malformed config means
// the historical default: start with OpenCode.
function autoStartEnabled(): boolean {
  try {
    const config = JSON.parse(readFileSync(join(configDir(), "config.json"), "utf8")) as {
      autostart?: unknown
    }
    return config.autostart !== false
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

function childAlive(entry: Entry): boolean {
  return entry.child !== undefined && entry.child.exitCode === null && !entry.child.killed
}

function stopChild(entry: Entry): void {
  if (!entry.child) return
  entry.child.kill("SIGTERM")
  entry.child = undefined
}

function supervise(entry: Entry): void {
  const tick = () => {
    if (!autoStartEnabled() || !isOpenCodeRunning()) {
      stopChild(entry)
      return
    }
    if (!childAlive(entry)) startWatcher(entry)
  }

  entry.timer = setInterval(tick, CHECK_INTERVAL_MS)
  entry.timer.unref?.()
  tick()
}

export default {
  id: "opencode-discord-status-autostart",

  async setup(ctx: { options?: { enabled?: boolean } }) {
    const globals = globalThis as Global

    if (ctx?.options?.enabled === false) {
      stopSupervisor(globals)
      return
    }

    let entry = globals[KEY] as Entry | undefined

    if (!entry) {
      entry = { refs: 0 }
      globals[KEY] = entry
    }

    entry.refs += 1

    // Re-arm on plugin reload so supervision changes take effect without an
    // OpenCode restart. An existing child is kept, not duplicated.
    const current = entry
    if (current.timer) clearInterval(current.timer)
    current.timer = undefined
    supervise(current)

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
