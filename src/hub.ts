import type { PresenceStatus } from "./activity.ts"
import type { DiscordActivity, DiscordRpcClient, Logger } from "./discord/client.ts"
import type { ActivitySink, PublishMeta } from "./presence.ts"

interface Participant {
  token: symbol
  activity: DiscordActivity | null
  meta: PublishMeta
}

export interface ParticipantHandle {
  sink: ActivitySink
  /** Stop participating. The hub re-elects a winner from whoever is left. */
  leave(): Promise<void>
}

const STATUS_PRIORITY: Record<PresenceStatus, number> = {
  idle: 0,
  retry: 1,
  busy: 2,
}

/**
 * The desktop app keeps its `opencode-cli serve --service` child alive after
 * the window closes, so the Discord card can outlive the UI. When the parent
 * goes away the child is reparented, which is the one reliable signal that
 * nobody is looking any more. Polling is cheap and only runs until shutdown.
 */
const ORPHAN_CHECK_INTERVAL_MS = 5_000

export interface PresenceHubOptions {
  /** Reads the current parent pid. Injectable so the orphan watch can be tested. */
  parentPid?: () => number
  orphanCheckIntervalMs?: number
}

/**
 * Discord shows one activity per application, but OpenCode runs one plugin
 * instance per open project. Without arbitration every instance writes to the
 * same card and the last writer wins, so the card flickers between projects.
 *
 * The hub keeps the latest activity from each instance and publishes the most
 * deserving one: a working session beats an idle one, then the most recently
 * active project wins. Ties keep the incumbent, so the card stays put instead
 * of flapping between idle locations.
 */
export class PresenceHub {
  readonly #client: DiscordRpcClient
  readonly #logger: Logger
  readonly #participants = new Map<string, Participant>()
  readonly #readParentPid: () => number
  readonly #parentPid: number
  readonly #orphanCheckIntervalMs: number
  #winner: string | undefined
  #starting: Promise<void> | undefined
  #orphanTimer: NodeJS.Timeout | undefined

  constructor(client: DiscordRpcClient, logger: Logger, options: PresenceHubOptions = {}) {
    this.#client = client
    this.#logger = logger
    this.#readParentPid = options.parentPid ?? (() => process.ppid)
    this.#parentPid = this.#readParentPid()
    this.#orphanCheckIntervalMs = options.orphanCheckIntervalMs ?? ORPHAN_CHECK_INTERVAL_MS
    this.#watchForOrphanedHost()
  }

  #watchForOrphanedHost(): void {
    this.#orphanTimer = setInterval(() => {
      if (this.#readParentPid() === this.#parentPid) return

      this.#logger.debug("The OpenCode host exited; clearing Discord presence")
      this.#stopOrphanWatch()
      this.destroy()
    }, this.#orphanCheckIntervalMs)
    this.#orphanTimer.unref?.()
  }

  #stopOrphanWatch(): void {
    if (this.#orphanTimer === undefined) return
    clearInterval(this.#orphanTimer)
    this.#orphanTimer = undefined
  }

  start(): Promise<void> {
    // Every project's setup asks to start; only the first attempt should run,
    // so a failure produces one warning instead of one per open project.
    this.#starting ??= this.#client.start().catch((error: unknown) => {
      this.#starting = undefined
      throw error
    })
    return this.#starting
  }

  /** Join as one plugin instance. `id` is usually the project directory. */
  join(id: string): ParticipantHandle {
    const token = Symbol(id)

    return {
      sink: {
        setActivity: (activity, meta) => {
          this.#participants.set(id, { token, activity, meta })
          this.#render()
        },
      },
      leave: async () => {
        const current = this.#participants.get(id)
        // A newer setup for the same project may already have replaced us.
        if (current?.token !== token) return
        this.#participants.delete(id)
        if (this.#winner === id) this.#winner = undefined
        await this.#render()
      },
    }
  }

  /** Drop the socket immediately. Discord clears the activity when it closes. */
  destroy(): void {
    this.#client.destroy()
  }

  async shutdown(): Promise<void> {
    this.#stopOrphanWatch()
    this.#participants.clear()
    this.#winner = undefined
    await this.#client.stop()
  }

  #render(): Promise<void> {
    const winner = this.#pick()
    this.#winner = winner
    const activity = winner ? (this.#participants.get(winner)?.activity ?? null) : null

    try {
      const result = this.#client.setActivity(activity)
      return Promise.resolve(result).catch((error: unknown) => {
        this.#logger.warn(`Could not update Discord presence: ${describe(error)}`)
      })
    } catch (error) {
      this.#logger.warn(`Could not update Discord presence: ${describe(error)}`)
      return Promise.resolve()
    }
  }

  #pick(): string | undefined {
    let best: string | undefined

    for (const [id, participant] of this.#participants) {
      if (best === undefined) {
        best = id
        continue
      }
      const contender = this.#participants.get(best)
      if (contender && outranks(participant, contender)) best = id
    }

    // Never hand the card to an equal: only a strictly better instance wins.
    if (this.#winner !== undefined) {
      const incumbent = this.#participants.get(this.#winner)
      if (incumbent) {
        const challenger = best === undefined ? undefined : this.#participants.get(best)
        if (!challenger || !outranks(challenger, incumbent)) return this.#winner
      }
    }

    return best
  }
}

function outranks(a: Participant, b: Participant): boolean {
  const priorityA = STATUS_PRIORITY[a.meta.status]
  const priorityB = STATUS_PRIORITY[b.meta.status]
  if (priorityA !== priorityB) return priorityA > priorityB
  return a.meta.lastActive > b.meta.lastActive
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
