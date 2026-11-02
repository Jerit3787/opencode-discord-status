import type { Plugin } from "@opencode/plugin"

import { parseConfig } from "./config.ts"
import { DiscordRpcClient, type DiscordActivity, type Logger } from "./discord/client.ts"
import { NullTransport, PresenceHub } from "./hub.ts"
import { PresenceController, type PresenceEvent, type SessionReader } from "./presence.ts"
import { StateFile } from "./state-file.ts"

type Context = Plugin.Context

const PREFIX = "[opencode-discord-status]"

/**
 * OpenCode runs one plugin instance per open project, and it can re-run a
 * plugin's setup after a config change or a reload (which also re-evaluates
 * this module from scratch). Discord serves one card per application and only
 * a handful of connections per client id, so both the connection and the
 * arbitration between instances live on `globalThis`, keyed by client id.
 */
interface SharedHub {
  hub: PresenceHub
  refs: number
}

const REGISTRY = Symbol.for("opencode-discord-status.hubs")
const hubs: Map<string, SharedHub> = ((
  globalThis as unknown as Record<symbol, unknown>
)[REGISTRY] ??= new Map()) as Map<string, SharedHub>

const EXIT_HOOK = Symbol.for("opencode-discord-status.exitHook")
if (!(globalThis as unknown as Record<symbol, unknown>)[EXIT_HOOK]) {
  ;(globalThis as unknown as Record<symbol, unknown>)[EXIT_HOOK] = true
  // Discord drops an activity when its IPC socket closes. Closing the socket
  // here means a normal exit leaves nothing stale on the profile.
  process.once("exit", () => {
    for (const { hub } of hubs.values()) hub.destroy()
  })
}

function acquireHub(
  clientId: string,
  create: () => PresenceHub,
): { hub: PresenceHub; release: () => Promise<void> } {
  let entry = hubs.get(clientId)
  if (!entry) {
    entry = { hub: create(), refs: 0 }
    hubs.set(clientId, entry)
  }
  entry.refs += 1

  const shared = entry
  let released = false

  return {
    hub: shared.hub,
    async release() {
      if (released) return
      released = true

      shared.refs -= 1
      if (shared.refs > 0) return
      hubs.delete(clientId)
      await shared.hub.shutdown()
    },
  }
}

function createLogger(debug: boolean): Logger {
  return {
    debug: debug ? (message, ...args) => console.debug(`${PREFIX} ${message}`, ...args) : () => {},
    warn: (message, ...args) => console.warn(`${PREFIX} ${message}`, ...args),
    error: (message, ...args) => console.error(`${PREFIX} ${message}`, ...args),
  }
}

export default {
  id: "opencode-discord-status",

  async setup(ctx: Context) {
    const parsed = parseConfig(ctx.options)
    if (!parsed.ok) {
      console.error(`${PREFIX} ${parsed.error}`)
      return
    }

    const config = parsed.config
    if (!config.enabled) return

    const logger = createLogger(config.debug)
    const modelNames = await loadModelNames(ctx, logger)

    const { hub, release } = acquireHub(config.clientId, () => {
      const transport = config.discord
        ? new DiscordRpcClient({
            clientId: config.clientId,
            reconnect: config.reconnect,
            minUpdateIntervalMs: config.minUpdateIntervalMs,
            logger,
          })
        : new NullTransport()

      let mirror: ((activity: DiscordActivity | null) => void) | undefined
      if (config.stateFile) {
        const stateFile = new StateFile(config.stateFile, logger)
        mirror = (activity) => stateFile.write(activity)
      }

      return new PresenceHub(transport, logger, { mirror })
    })

    const participant = hub.join(ctx.location.directory)

    const session: SessionReader = {
      async get({ sessionID }) {
        const info = await ctx.session.get({
          sessionID: sessionID as Parameters<typeof ctx.session.get>[0]["sessionID"],
        })
        return {
          title: info.title,
          model: info.model,
          agent: info.agent,
          location: info.location,
          cost: info.cost,
          tokens: info.tokens ? { input: info.tokens.input, output: info.tokens.output } : undefined,
        }
      },
    }

    const presence = new PresenceController({
      config,
      sink: participant.sink,
      session,
      resolveModelName: (providerID, id) => modelNames.get(`${providerID}/${id}`),
      initialDirectory: ctx.location.directory,
      logger,
    })

    presence.start()

    void hub.start().catch((error: unknown) => {
      logger.warn(
        `Discord is not reachable: ${describe(error)}. Is the Discord desktop app running?` +
          (config.reconnect ? " Retrying in the background." : ""),
      )
    })

    const abort = new AbortController()
    void subscribe(ctx, presence, abort.signal, logger)

    return async () => {
      abort.abort()
      presence.dispose()
      await participant.leave()
      await release().catch((error: unknown) => {
        logger.debug(`Could not clear presence during unload: ${describe(error)}`)
      })
    }
  },
} satisfies Plugin.Plugin

async function loadModelNames(
  ctx: Context,
  logger: Logger,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()

  try {
    const result = await ctx.model.list()
    for (const model of result.data) {
      names.set(`${model.providerID}/${model.id}`, model.name)
    }
  } catch (error) {
    logger.debug(`Could not read the model list: ${describe(error)}`)
  }

  return names
}

async function subscribe(
  ctx: Context,
  presence: PresenceController,
  signal: AbortSignal,
  logger: Logger,
): Promise<void> {
  while (!signal.aborted) {
    try {
      for await (const event of ctx.event.subscribe({ signal })) {
        presence.handle(event as unknown as PresenceEvent)
      }
    } catch (error) {
      if (signal.aborted) return
      logger.warn(`Lost the OpenCode event stream: ${describe(error)}. Reconnecting...`)
    }

    if (signal.aborted) return
    await delay(1_000, signal)
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
