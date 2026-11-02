#!/usr/bin/env node
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { resolve } from "node:path"
import type { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

import {
  DEFAULT_STATE_PATH,
  buildTailCommand,
  parsePresenceLine,
} from "../src/bridge.ts"
import { DiscordRpcClient, type Logger } from "../src/discord/client.ts"

interface Args {
  ssh: string
  clientId: string
  state: string
  debug: boolean
  port?: string
  identity?: string
  options: string[]
}

const HELP = `Usage: opencode-discord-status bridge --ssh <host> --client-id <id> [options]

Shows the presence written by a plugin running on a remote OpenCode host.
The plugin there needs:
  "discord": false,
  "stateFile": "~/.local/state/opencode-discord-status/presence.json"

Options:
  --ssh <host>        SSH destination, anything ssh(1) accepts (user@host, an alias, ...)
  --client-id <id>    Discord Application ID (or set DISCORD_CLIENT_ID)
  --state <path>      Remote state file (default ${DEFAULT_STATE_PATH})
  --port <port>       SSH port, if it is not the default
  --identity <path>   SSH private key, if the host is not in ~/.ssh/config
  --ssh-option <opt>  Extra -o option, repeatable (e.g. ProxyJump=bastion)
  --debug             Log connection details
  -h, --help          Show this message`

function parseArgs(argv: string[]): Args {
  let ssh: string | undefined
  let clientId: string | undefined = process.env.DISCORD_CLIENT_ID
  let state = DEFAULT_STATE_PATH
  let debug = false
  let port: string | undefined
  let identity: string | undefined
  const options: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case "--ssh":
        ssh = argv[++index]
        break
      case "--client-id":
        clientId = argv[++index]
        break
      case "--state":
        state = argv[++index] ?? state
        break
      case "--port":
        port = argv[++index]
        break
      case "--identity":
        identity = argv[++index]
        break
      case "--ssh-option":
        options.push(argv[++index] ?? "")
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

  if (!ssh) throw new Error("--ssh <host> is required")
  if (!clientId) throw new Error("--client-id <id> is required (or set DISCORD_CLIENT_ID)")
  if (!/^\d{17,20}$/.test(clientId)) {
    throw new Error("clientId must be the 17-20 digit Discord Application ID")
  }
  if (port !== undefined && !/^\d+$/.test(port)) {
    throw new Error("--port must be a number")
  }

  return { ssh, clientId, state, debug, port, identity, options: options.filter(Boolean) }
}

function createLogger(debug: boolean): Logger {
  return {
    debug: debug ? (message, ...args) => console.debug(`[bridge] ${message}`, ...args) : () => {},
    warn: (message, ...args) => console.warn(`[bridge] ${message}`, ...args),
    error: (message, ...args) => console.error(`[bridge] ${message}`, ...args),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const logger = createLogger(args.debug)
  const client = new DiscordRpcClient({ clientId: args.clientId, reconnect: true, logger })

  let stopping = false
  let child: ChildProcessByStdio<null, Readable, null> | undefined
  let retry = 0
  let retryTimer: NodeJS.Timeout | undefined

  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    if (retryTimer) clearTimeout(retryTimer)
    child?.kill("SIGTERM")
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

  const connect = (): void => {
    if (stopping) return

    logger.debug(`ssh ${args.ssh}`)
    const sshArguments = [
      "-T",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
    ]
    if (args.port) sshArguments.push("-p", args.port)
    if (args.identity) sshArguments.push("-i", args.identity)
    for (const option of args.options) sshArguments.push("-o", option)
    sshArguments.push(args.ssh, buildTailCommand(args.state))

    const process_ = spawn("ssh", sshArguments, {
      stdio: ["ignore", "pipe", "inherit"],
    })
    child = process_

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

        const activity = parsePresenceLine(line)
        if (activity === undefined) continue

        sawFrame = true
        retry = 0
        void client.setActivity(activity).catch((error: unknown) => {
          logger.warn(`Could not update Discord presence: ${describe(error)}`)
        })
      }
    })

    process_.on("error", (error) => {
      logger.warn(`Could not run ssh: ${describe(error)}`)
    })

    process_.on("close", (code) => {
      if (stopping) return
      // Do not leave a stale card behind while the tunnel is down.
      void client.setActivity(null).catch(() => {})
      retry = sawFrame ? 0 : Math.min(retry + 1, 6)
      const wait = Math.min(1_000 * 2 ** retry, 30_000)
      logger.warn(`ssh exited (code ${code ?? "null"}); reconnecting in ${Math.round(wait / 1_000)}s`)
      retryTimer = setTimeout(connect, wait)
    })
  }

  connect()
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(`[bridge] ${describe(error)}`)
    process.exit(1)
  })
}
