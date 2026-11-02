import { basename } from "node:path"

import {
  buildActivity,
  type ActivityConfig,
  type ActivitySnapshot,
  type PresenceStatus,
} from "./activity.ts"
import type { DiscordActivity, Logger } from "./discord/client.ts"

export interface PresenceEvent {
  type: string
  created?: number
  location?: { directory?: string }
  data?: Record<string, unknown>
}

export interface SessionDetails {
  title?: string
  model?: { providerID: string; id: string }
  agent?: string
  location?: { directory?: string }
  cost?: number
  tokens?: { input: number; output: number }
}

export interface SessionReader {
  get(input: { sessionID: string }): Promise<SessionDetails | undefined>
}

/**
 * Why this activity changed. A hub uses it to decide which of several plugin
 * instances (one per open project) should own the single Discord card.
 */
export interface PublishMeta {
  status: PresenceStatus
  /** Newest session activity in this instance, or 0 when it has no sessions. */
  lastActive: number
}

export interface ActivitySink {
  setActivity(activity: DiscordActivity | null, meta: PublishMeta): Promise<void> | void
}

export interface PresenceControllerOptions {
  config: ActivityConfig
  sink: ActivitySink
  session?: SessionReader
  resolveModelName?: (providerID: string, id: string) => string | undefined
  initialDirectory?: string
  logger?: Logger
  now?: () => number
  detailTimeoutMs?: number
}

interface SessionState {
  id: string
  status: PresenceStatus
  project?: string
  sessionTitle?: string
  model?: string
  agent?: string
  attempt?: number
  startedAt?: number
  lastActive: number
  detailsLoaded: boolean
  detailsLoading: boolean
  cost?: number
  tokens?: { input: number; output: number }
}

/**
 * OpenCode V2 emits step-level events, not the older `session.execution.*`
 * ones, so the card has to be driven by `session.step.*`. The legacy names are
 * kept for hosts that still send them. High-frequency deltas are deliberately
 * excluded: they never change what the card says.
 */
const RECOGNIZED_EVENTS = new Set([
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.usage.updated",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.status",
  "session.idle",
  "session.created",
  "session.renamed",
  "session.model.selected",
  "session.agent.selected",
  "session.deleted",
])

const DEFAULT_DETAIL_TIMEOUT_MS = 3_000
const silentLogger: Logger = { debug() {}, warn() {}, error() {} }

/**
 * Turns OpenCode session events into one Discord activity.
 *
 * Multiple sessions can run at once. The most recently active busy session
 * wins; when everything is idle, the most recently touched session supplies
 * the project name.
 */
export class PresenceController {
  readonly config: ActivityConfig

  readonly #sink: ActivitySink
  readonly #session?: SessionReader
  readonly #resolveModelName?: (providerID: string, id: string) => string | undefined
  readonly #initialProject?: string
  readonly #logger: Logger
  readonly #now: () => number
  readonly #detailTimeoutMs: number

  readonly #sessions = new Map<string, SessionState>()
  readonly #pending = new Set<Promise<void>>()
  #published: string | undefined
  #disposed = false

  constructor(options: PresenceControllerOptions) {
    this.config = options.config
    this.#sink = options.sink
    this.#session = options.session
    this.#resolveModelName = options.resolveModelName
    this.#initialProject = projectName(options.initialDirectory)
    this.#logger = options.logger ?? silentLogger
    this.#now = options.now ?? Date.now
    this.#detailTimeoutMs = options.detailTimeoutMs ?? DEFAULT_DETAIL_TIMEOUT_MS
  }

  start(): void {
    this.#publish()
  }

  handle(event: PresenceEvent): void {
    if (this.#disposed || !RECOGNIZED_EVENTS.has(event.type)) return

    const data = event.data ?? {}
    const sessionID = data.sessionID
    if (typeof sessionID !== "string" || sessionID.length === 0) return

    if (event.type === "session.deleted") {
      if (!this.#sessions.delete(sessionID)) return
      this.#publish()
      return
    }

    const state = this.#state(sessionID)
    state.lastActive = this.#now()

    const directory = event.location?.directory ?? locationDirectory(data.location)
    if (directory) state.project = projectName(directory)

    switch (event.type) {
      case "session.step.started":
        this.#beginWork(state, data, event, false)
        this.#ensureDetails(sessionID)
        break

      case "session.step.ended":
        this.#applyUsage(state, data)
        // A step that ends asking for tools is mid-turn; anything else means
        // the assistant is done and the card should go idle.
        if (turnEnded(data.finish)) this.#markIdle(state)
        break

      case "session.step.failed":
        this.#applyUsage(state, data)
        this.#markIdle(state)
        break

      case "session.usage.updated":
        this.#applyUsage(state, data)
        break

      case "session.tool.called":
      case "session.tool.success":
      case "session.tool.failed":
        this.#touchActivity(state)
        break

      case "session.execution.started":
        this.#beginWork(state, data, event, true)
        this.#ensureDetails(sessionID)
        break

      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
      case "session.idle":
        this.#applyUsage(state, data)
        this.#markIdle(state)
        // Token and cost totals only settle once the run is over, so this is
        // where the numbers on the card actually move on older hosts.
        this.#ensureDetails(sessionID, true)
        break

      case "session.status":
        this.#applyStatus(state, data.status, sessionID)
        break

      case "session.created":
        this.#ensureDetails(sessionID)
        break

      case "session.renamed":
        if (typeof data.title === "string") state.sessionTitle = data.title
        break

      case "session.model.selected":
        this.#applyModel(state, data.model)
        break

      case "session.agent.selected":
        if (typeof data.agent === "string") state.agent = data.agent
        break
    }

    this.#publish()
  }

  /** Wait for in-flight session lookups, then publish. Mostly useful for tests and shutdown. */
  async flush(): Promise<void> {
    if (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending])
    }
    this.#publish()
  }

  dispose(): void {
    this.#disposed = true
    this.#sessions.clear()
  }

  #state(sessionID: string): SessionState {
    const existing = this.#sessions.get(sessionID)
    if (existing) return existing

    const state: SessionState = {
      id: sessionID,
      status: "idle",
      lastActive: this.#now(),
      detailsLoaded: false,
      detailsLoading: false,
    }
    this.#sessions.set(sessionID, state)
    return state
  }

  #markIdle(state: SessionState): void {
    state.status = "idle"
    state.startedAt = undefined
    state.attempt = undefined
  }

  /** First signal of real work in a turn: start the timer and keep it. */
  #beginWork(
    state: SessionState,
    data: Record<string, unknown>,
    event: PresenceEvent,
    restart: boolean,
  ): void {
    if (restart || state.status === "idle") {
      state.startedAt = timestamp(data.started ?? event.created, this.#now())
    }
    state.status = "busy"
    state.attempt = undefined
    if (typeof data.agent === "string") state.agent = data.agent
    this.#applyModel(state, data.model)
  }

  /** Tool traffic keeps a session busy without restarting its timer. */
  #touchActivity(state: SessionState): void {
    if (state.status !== "idle") return
    state.status = "busy"
    state.startedAt ??= this.#now()
  }

  #applyUsage(state: SessionState, data: Record<string, unknown>): void {
    if (typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0) {
      state.cost = data.cost
    }

    const tokens = data.tokens
    if (typeof tokens !== "object" || tokens === null) return
    const { input, output } = tokens as { input?: unknown; output?: unknown }
    if (typeof input === "number" && Number.isFinite(input) && typeof output === "number" && Number.isFinite(output)) {
      state.tokens = { input, output }
    }
  }

  #applyStatus(state: SessionState, value: unknown, sessionID: string): void {
    if (typeof value !== "object" || value === null) return
    const status = value as { type?: unknown; attempt?: unknown }

    if (status.type === "busy") {
      state.status = "busy"
      state.attempt = undefined
      state.startedAt ??= this.#now()
      this.#ensureDetails(sessionID)
      return
    }

    if (status.type === "retry") {
      state.status = "retry"
      state.attempt = typeof status.attempt === "number" ? status.attempt : undefined
      state.startedAt ??= this.#now()
      this.#ensureDetails(sessionID)
      return
    }

    if (status.type === "idle") {
      this.#markIdle(state)
      this.#ensureDetails(sessionID, true)
    }
  }

  #applyModel(state: SessionState, value: unknown): void {
    if (typeof value !== "object" || value === null) return
    const model = value as { providerID?: unknown; id?: unknown }
    if (typeof model.providerID !== "string" || typeof model.id !== "string") return

    state.model = this.#resolveModelName?.(model.providerID, model.id) ?? model.id
  }

  #ensureDetails(sessionID: string, refresh = false): void {
    const state = this.#sessions.get(sessionID)
    if (!state || state.detailsLoading || !this.#session) return
    if (state.detailsLoaded && !refresh) return

    state.detailsLoading = true

    const pending = (async () => {
      try {
        const details = await withTimeout(
          this.#session!.get({ sessionID }),
          this.#detailTimeoutMs,
          "session lookup",
        )
        const current = this.#sessions.get(sessionID)
        if (!current || !details) return

        if (details.title) current.sessionTitle = details.title
        if (details.agent && !current.agent) current.agent = details.agent
        if (details.model && !current.model) {
          current.model =
            this.#resolveModelName?.(details.model.providerID, details.model.id) ?? details.model.id
        }
        if (details.location?.directory && !current.project) {
          current.project = projectName(details.location.directory)
        }
        if (typeof details.cost === "number" && Number.isFinite(details.cost) && details.cost >= 0) {
          current.cost = details.cost
        }
        if (details.tokens) {
          const { input, output } = details.tokens
          if (Number.isFinite(input) && Number.isFinite(output)) {
            current.tokens = { input, output }
          }
        }
      } catch (error) {
        this.#logger.debug(`Could not read session ${sessionID}: ${describe(error)}`)
      } finally {
        state.detailsLoading = false
        state.detailsLoaded = true
        this.#publish()
      }
    })()

    this.#pending.add(pending)
    void pending.finally(() => this.#pending.delete(pending))
  }

  #publish(): void {
    if (this.#disposed) return

    const sessions = [...this.#sessions.values()].sort((a, b) => b.lastActive - a.lastActive)
    const busy = sessions.find((session) => session.status !== "idle")
    const chosen = busy ?? sessions[0]

    const snapshot: ActivitySnapshot = chosen
      ? {
          status: chosen.status,
          project: chosen.project ?? this.#initialProject,
          sessionTitle: chosen.sessionTitle,
          model: chosen.model,
          agent: chosen.agent,
          attempt: chosen.attempt,
          startedAt: chosen.startedAt,
          tokens: chosen.tokens,
          cost: chosen.cost,
        }
      : {
          status: "idle",
          project: this.#initialProject,
        }

    const activity = buildActivity(snapshot, this.config)
    const serialized = JSON.stringify(activity)
    if (serialized === this.#published) return
    this.#published = serialized

    try {
      const result = this.#sink.setActivity(activity, {
        status: snapshot.status,
        lastActive: sessions[0]?.lastActive ?? 0,
      })
      if (result instanceof Promise) {
        void result.catch((error: unknown) => {
          this.#logger.warn(`Could not update Discord presence: ${describe(error)}`)
        })
      }
    } catch (error) {
      this.#logger.warn(`Could not update Discord presence: ${describe(error)}`)
    }
  }
}

function projectName(directory: string | undefined): string | undefined {
  if (!directory) return undefined
  const name = basename(directory)
  return name.length > 0 ? name : undefined
}

function locationDirectory(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const directory = (value as { directory?: unknown }).directory
  return typeof directory === "string" ? directory : undefined
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback
  return value < 1_000_000_000_000 ? value * 1_000 : value
}

/**
 * `session.step.ended` fires for every step. `finish: "tool-calls"` means the
 * assistant is waiting on tools and the turn continues; any other finish means
 * the turn is over. An unknown finish is treated as "not over" so a host that
 * omits the field does not flip the card to idle mid-turn.
 */
function turnEnded(finish: unknown): boolean {
  return typeof finish === "string" && finish !== "tool-calls"
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    timer.unref?.()
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
