#!/usr/bin/env node
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { resolve } from "node:path"
import type { Readable, Writable } from "node:stream"
import { pathToFileURL } from "node:url"

import { buildActivity } from "../src/activity.ts"
import { parseConfig } from "../src/config.ts"
import {
  DEFAULT_DB_PATH,
  DEFAULT_IDLE_AFTER_MS,
  buildRemoteScript,
  parseFrame,
  snapshotFromRow,
  type SessionRow,
} from "../src/db-presence.ts"
import { DiscordRpcClient, type Logger } from "../src/discord/client.ts"
import { readLocalRow } from "../src/opencode-db.ts"

interface Args {
  clientId: string
  db: string
  ssh?: string
  port?: string
  identity?: string
  sshOptions: string[]
  intervalMs: number
  idleAfterMs: number
  debug: boolean
}

const HELP = `Usage: opencode-discord-status watch --client-id <id> [options]

Publishes the newest OpenCode session straight from its SQLite database.
No plugin entry and no OpenCode restart are needed.

Options:
  --client-id <id>    Discord Application ID (or set DISCORD_CLIENT_ID)
  --db <path>         OpenCode database (default ${DEFAULT_DB_PATH})
  --ssh <host>        Read the database on a remote host over SSH
  --port <port>       SSH port, if it is not the default
  --identity <path>   SSH private key
  --ssh-option <opt>  Extra -o option, repeatable (e.g. ProxyJump=bastion)
  --interval <ms>     Poll interval (default 2000)
  --idle-after <sec>  Treat a session with no writes for this long as idle (default 900)
  --debug             Log connection details
  -h, --help          Show this message`

function parseArgs(argv: string[]): Args {
  let clientId: string | undefined = process.env.DISCORD_CLIENT_ID
  let db = DEFAULT_DB_PATH
  let ssh: string | undefined
  let port: string | undefined
  let identity: string | undefined
  let intervalMs = 2_000
  let idleAfterMs = DEFAULT_IDLE_AFTER_MS
  let debug = false
  const sshOptions: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case "--client-id":
        clientId = argv[++index]
        break
      case "--db":
        db = argv[++index] ?? db
        break
      case "--ssh":
        ssh = argv[++index]
        break
      case "--port":
        port = argv[++index]
        break
      case "--identity":
        identity = argv[++index]
        break
      case "--ssh-option":
        sshOptions.push(argv[++index] ?? "")
        break
      case "--interval":
        intervalMs = Number(argv[++index])
        break
      case "--idle-after":
        idleAfterMs = Number(argv[++index]) * 1_000
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
  if (port !== undefined && !/^\d+$/.test(port)) {
    throw new Error("--port must be a number")
  }

  return {
    clientId,
    db,
    ssh,
    port,
    identity,
    sshOptions: sshOptions.filter(Boolean),
    intervalMs,
    idleAfterMs,
    debug,
  }
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
  const parsed = parseConfig({ clientId: args.clientId })
  if (!parsed.ok) throw new Error(parsed.error)

  const logger = createLogger(args.debug)
  const client = new DiscordRpcClient({ clientId: args.clientId, reconnect: true, logger })

  let stopping = false
  let timer: NodeJS.Timeout | undefined
  let retryTimer: NodeJS.Timeout | undefined
  let child: ChildProcessByStdio<Writable, Readable, null> | undefined
  let retry = 0
  let last = ""

  const publish = async (row: SessionRow | undefined): Promise<void> => {
    const activity = buildActivity(snapshotFromRow(row, Date.now(), args.idleAfterMs), parsed.config)
    const key = JSON.stringify(activity)
    if (key === last) return
    last = key
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
    if (retryTimer) clearTimeout(retryTimer)
    child?.kill("SIGTERM")
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

  const connectRemote = (): void => {
    if (stopping || !args.ssh) return

    const script = buildRemoteScript(args.db, args.intervalMs / 1_000)
    const sshArguments = [
      "-T",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
    ]
    if (args.port) sshArguments.push("-p", args.port)
    if (args.identity) sshArguments.push("-i", args.identity)
    for (const option of args.sshOptions) sshArguments.push("-o", option)
    sshArguments.push(args.ssh, "sh -s")

    logger.debug(`ssh ${args.ssh}`)
    const process_ = spawn("ssh", sshArguments, { stdio: ["pipe", "pipe", "inherit"] })
    child = process_
    process_.stdin.end(script)

    let buffer = ""
    let sawFrame = false

    process_.stdout.setEncoding("utf8")
    process_.stdout.on("data", (chunk: string) => {
      buffer += chunk

      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")

        const rows = parseFrame(line)
        if (!rows) continue

        sawFrame = true
        retry = 0
        void publish(rows[0])
      }
    })

    process_.on("error", (error) => {
      logger.warn(`Could not run ssh: ${describe(error)}`)
    })

    process_.on("close", (code) => {
      if (stopping) return
      void publish(undefined)
      retry = sawFrame ? 0 : Math.min(retry + 1, 6)
      const wait = Math.min(1_000 * 2 ** retry, 30_000)
      logger.warn(
        `ssh exited (code ${code ?? "null"}); reconnecting in ${Math.round(wait / 1_000)}s`,
      )
      retryTimer = setTimeout(connectRemote, wait)
    })
  }

  if (args.ssh) {
    connectRemote()
  } else {
    let running = false
    const tick = async (): Promise<void> => {
      if (running || stopping) return
      running = true
      try {
        await publish(readLocalRow(args.db))
      } catch (error) {
        logger.warn(`Could not read ${args.db}: ${describe(error)}`)
      } finally {
        running = false
      }
    }
    void tick()
    timer = setInterval(() => void tick(), args.intervalMs)
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
