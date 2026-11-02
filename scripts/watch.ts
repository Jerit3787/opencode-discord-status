#!/usr/bin/env node
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { buildActivity } from "../src/activity.ts"
import { parseConfig } from "../src/config.ts"
import {
  DEFAULT_DB_PATH,
  DEFAULT_IDLE_AFTER_MS,
  pickSessionRow,
  snapshotFromRow,
  type SessionRow,
} from "../src/db-presence.ts"
import { DiscordRpcClient, type Logger } from "../src/discord/client.ts"
import { openCodeRunning } from "../src/lifecycle.ts"
import { readLocalRows } from "../src/opencode-db.ts"

interface Args {
  clientId: string
  db: string
  intervalMs: number
  idleAfterMs: number
  exitWhenClosed: boolean
  debug: boolean
}

const HELP = `Usage: opencode-discord-status watch --client-id <id> [options]

Publishes the newest OpenCode session straight from its SQLite database.
No plugin entry and no OpenCode restart are needed.

Options:
  --client-id <id>     Discord Application ID (or set DISCORD_CLIENT_ID)
  --db <path>          OpenCode database (default ${DEFAULT_DB_PATH})
  --interval <ms>      Poll interval (default 2000)
  --idle-after <sec>   Treat a session with no writes for this long as idle (default 900)
  --exit-when-closed   Exit when no OpenCode process is running (use under launchd)
  --debug              Log connection details
  -h, --help           Show this message`

function parseArgs(argv: string[]): Args {
  let clientId: string | undefined = process.env.DISCORD_CLIENT_ID
  let db = DEFAULT_DB_PATH
  let intervalMs = 2_000
  let idleAfterMs = DEFAULT_IDLE_AFTER_MS
  let exitWhenClosed = false
  let debug = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case "--client-id":
        clientId = argv[++index]
        break
      case "--db":
        db = argv[++index] ?? db
        break
      case "--interval":
        intervalMs = Number(argv[++index])
        break
      case "--idle-after":
        idleAfterMs = Number(argv[++index]) * 1_000
        break
      case "--exit-when-closed":
        exitWhenClosed = true
        break
      case "--debug":
        debug = true
        break
      case "-h":
      case "--help":
        console.log(HELP)
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (!clientId) throw new Error("--client-id <id> is required (or set DISCORD_CLIENT_ID)")
  if (!/^\d{17,20}$/.test(clientId)) {
    throw new Error("clientId must be the 17-20 digit Discord Application ID")
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) {
    throw new Error("--interval must be at least 1000 ms")
  }
  if (!Number.isFinite(idleAfterMs) || idleAfterMs < 60_000) {
    throw new Error("--idle-after must be at least 60 seconds")
  }

  return { clientId, db, intervalMs, idleAfterMs, exitWhenClosed, debug }
}

function createLogger(debug: boolean): Logger {
  return {
    debug: debug ? (message, ...args) => console.debug(`[watch] ${message}`, ...args) : () => {},
    warn: (message, ...args) => console.warn(`[watch] ${message}`, ...args),
    error: (message, ...args) => console.error(`[watch] ${message}`, ...args),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  // Started by launchd while OpenCode is closed: leave without touching Discord.
  if (args.exitWhenClosed && !openCodeRunning()) {
    process.exit(0)
  }

  const parsed = parseConfig({ clientId: args.clientId })
  if (!parsed.ok) throw new Error(parsed.error)

  const logger = createLogger(args.debug)
  const client = new DiscordRpcClient({ clientId: args.clientId, reconnect: true, logger })

  let stopping = false
  let timer: NodeJS.Timeout | undefined
  let lifecycleTimer: NodeJS.Timeout | undefined
  let running = false
  let last = ""
  let lastError = ""
  let currentSession: string | undefined

  const publish = async (row: SessionRow | undefined): Promise<void> => {
    const activity = buildActivity(snapshotFromRow(row, Date.now(), args.idleAfterMs), parsed.config)
    const key = JSON.stringify(activity)
    if (key === last) return
    last = key
    logger.debug(`publishing ${key}`)
    try {
      await client.setActivity(activity)
    } catch (error) {
      logger.warn(`Could not update Discord presence: ${describe(error)}`)
    }
  }

  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    if (timer) clearInterval(timer)
    if (lifecycleTimer) clearInterval(lifecycleTimer)
    await client.setActivity(null).catch(() => {})
    await client.stop().catch(() => {})
    process.exit(0)
  }

  process.on("SIGINT", () => void stop())
  process.on("SIGTERM", () => void stop())

  await client.start().catch((error: unknown) => {
    logger.warn(
      `Discord is not reachable: ${describe(error)}. Start the Discord desktop app; retrying in the background.`,
    )
  })

  const tick = async (): Promise<void> => {
    if (running || stopping) return
    running = true
    try {
      const row = pickSessionRow(readLocalRows(args.db), Date.now(), args.idleAfterMs, {
        incumbent: currentSession,
      })
      if (row?.session_id) currentSession = row.session_id
      await publish(row)
      lastError = ""
    } catch (error) {
      const message = describe(error)
      if (message !== lastError) {
        lastError = message
        logger.warn(`Could not read ${args.db}: ${message}`)
      }
    } finally {
      running = false
    }
  }

  void tick()
  timer = setInterval(() => void tick(), args.intervalMs)

  if (args.exitWhenClosed) {
    lifecycleTimer = setInterval(() => {
      if (openCodeRunning()) return
      logger.debug("OpenCode closed; clearing presence and exiting")
      void stop()
    }, 5_000)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(`[watch] ${describe(error)}`)
    process.exit(1)
  })
}
