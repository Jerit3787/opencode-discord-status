import { randomUUID } from "node:crypto"
import { createConnection, type Socket } from "node:net"

import { FrameDecoder, Op, encodeFrame, type Frame } from "./frames.ts"
import { socketCandidates } from "./socket.ts"

export interface DiscordActivity {
  details?: string
  state?: string
  timestamps?: { start?: number; end?: number }
  assets?: {
    large_image?: string
    large_text?: string
    small_image?: string
    small_text?: string
  }
  buttons?: { label: string; url: string }[]
  instance?: boolean
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export const consoleLogger: Logger = {
  debug: (message, ...args) => console.debug(`[opencode-discord-status] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[opencode-discord-status] ${message}`, ...args),
  error: (message, ...args) => console.error(`[opencode-discord-status] ${message}`, ...args),
}

export class DiscordRpcError extends Error {
  override name = "DiscordRpcError"
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

export interface DiscordRpcClientOptions {
  clientId: string
  socketPaths?: string[]
  pid?: number
  reconnect?: boolean
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
  /** Discord rate-limits presence updates; keep well above 1 per second. */
  minUpdateIntervalMs?: number
  requestTimeoutMs?: number
  logger?: Logger
  now?: () => number
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

interface WirePayload {
  cmd?: string
  evt?: string | null
  nonce?: string
  data?: unknown
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000
const DEFAULT_MIN_UPDATE_INTERVAL_MS = 4_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Minimal Discord RPC client over the local IPC socket.
 *
 * No bot token is involved: Discord's desktop client exposes a socket and the
 * handshake only needs a Discord application (client) id.
 */
export class DiscordRpcClient {
  readonly #clientId: string
  readonly #socketPaths: string[]
  readonly #pid: number
  readonly #reconnect: boolean
  readonly #reconnectDelayMs: number
  readonly #maxReconnectDelayMs: number
  readonly #minUpdateIntervalMs: number
  readonly #requestTimeoutMs: number
  readonly #logger: Logger
  readonly #now: () => number

  #socket: Socket | null = null
  #decoder = new FrameDecoder()
  #connected = false
  #connecting: Promise<void> | null = null
  #stopping: Promise<void> | null = null
  #stopRequested = false

  #reconnectTimer: NodeJS.Timeout | null = null
  #reconnectAttempt = 0

  readonly #pending = new Map<string, PendingRequest>()

  /** What the owner wants Discord to show. Persisted across reconnects. */
  #wanted: DiscordActivity | null = null
  /** Latest update waiting to be flushed. `undefined` means nothing queued. */
  #desired: DiscordActivity | null | undefined = undefined
  #lastSentKey: string | undefined = undefined
  #lastSentAt = Number.NEGATIVE_INFINITY
  #flushPromise: Promise<void> | null = null

  constructor(options: DiscordRpcClientOptions) {
    this.#clientId = options.clientId
    this.#socketPaths = options.socketPaths ?? socketCandidates()
    this.#pid = options.pid ?? process.pid
    this.#reconnect = options.reconnect ?? true
    this.#reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    this.#maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS
    this.#minUpdateIntervalMs = options.minUpdateIntervalMs ?? DEFAULT_MIN_UPDATE_INTERVAL_MS
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.#logger = options.logger ?? consoleLogger
    this.#now = options.now ?? Date.now
  }

  get connected(): boolean {
    return this.#connected
  }

  async start(): Promise<void> {
    this.#stopRequested = false
    if (this.#connected) return

    try {
      await this.#connect()
    } catch (error) {
      if (this.#reconnect && !this.#stopRequested) this.#scheduleReconnect()
      throw error
    }
  }

  /**
   * Ask Discord to show `activity`, or clear it with `null`. Resolves once the
   * latest requested activity has been written (or immediately while offline).
   * Updates are coalesced and throttled to avoid Discord's rate limit.
   */
  setActivity(activity: DiscordActivity | null): Promise<void> {
    this.#wanted = activity
    this.#desired = activity
    return this.#flush()
  }

  async stop(): Promise<void> {
    if (this.#stopping) return this.#stopping

    this.#stopping = this.#stop().finally(() => {
      this.#stopping = null
    })
    return this.#stopping
  }

  /**
   * Drop the socket without waiting for a reply. Discord clears the activity
   * as soon as the connection closes, so this is the only reliable way to
   * clean up from a synchronous `exit` handler.
   */
  destroy(): void {
    this.#stopRequested = true
    this.#desired = undefined
    this.#teardown()
  }

  async #stop(): Promise<void> {
    this.#stopRequested = true
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    this.#reconnectAttempt = 0
    this.#desired = undefined

    if (this.#connected) {
      try {
        await Promise.race([
          this.#request("SET_ACTIVITY", { pid: this.#pid, activity: null }),
          delay(500),
        ])
      } catch (error) {
        this.#logger.debug(`Could not clear Discord presence: ${describe(error)}`)
      }
    }

    this.#teardown()
    this.#stopRequested = false
  }

  #scheduleReconnect(): void {
    if (!this.#reconnect || this.#stopRequested || this.#reconnectTimer) return

    const wait = Math.min(
      this.#reconnectDelayMs * 2 ** this.#reconnectAttempt,
      this.#maxReconnectDelayMs,
    )
    this.#reconnectAttempt += 1
    this.#logger.debug(`Reconnecting to Discord in ${wait}ms`)

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      void this.#connect().catch((error: unknown) => {
        this.#logger.debug(`Discord reconnect failed: ${describe(error)}`)
        this.#scheduleReconnect()
      })
    }, wait)
    this.#reconnectTimer.unref?.()
  }

  #connect(): Promise<void> {
    if (this.#connecting) return this.#connecting

    this.#connecting = this.#connectOnce().finally(() => {
      this.#connecting = null
    })
    return this.#connecting
  }

  async #connectOnce(): Promise<void> {
    let firstError: unknown
    let firstReachableError: unknown

    for (const path of this.#socketPaths) {
      try {
        const socket = await this.#handshake(path)
        this.#socket = socket
        this.#connected = true
        this.#reconnectAttempt = 0
        this.#attach(socket)
        this.#logger.debug(`Connected to Discord at ${path}`)

        this.#lastSentKey = undefined
        this.#lastSentAt = Number.NEGATIVE_INFINITY
        if (this.#wanted !== null) {
          this.#desired = this.#wanted
          void this.#flush().catch((error: unknown) => {
            this.#logger.warn(`Could not restore Discord presence: ${describe(error)}`)
          })
        }
        return
      } catch (error) {
        // Keep the first error so the message points at the primary socket path
        // instead of the last fallback (/tmp on macOS), which is rarely the one
        // the user cares about. A socket that exists but refuses us is more
        // informative than one that was never there, so prefer it.
        firstError ??= error
        if (firstReachableError === undefined && !isMissingSocket(error)) {
          firstReachableError = error
        }
      }
    }

    const error = firstReachableError ?? firstError
    throw error instanceof Error ? error : new DiscordRpcError("No Discord IPC socket was available")
  }

  #handshake(path: string): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const socket = createConnection(path)
      const decoder = new FrameDecoder()
      let settled = false

      const cleanup = () => {
        clearTimeout(timer)
        socket.off("data", onData)
        socket.off("error", onError)
        socket.off("close", onClose)
        socket.off("connect", onConnect)
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        socket.destroy()
        reject(error)
      }

      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(socket)
      }

      const onConnect = () => {
        socket.write(encodeFrame(Op.HANDSHAKE, { v: 1, client_id: this.#clientId }))
      }

      const onError = (error: Error) => fail(error)

      const onClose = () => fail(new DiscordRpcError("Discord IPC socket closed during handshake"))

      const onData = (chunk: Buffer) => {
        let frames: Frame[]
        try {
          frames = decoder.push(chunk)
        } catch (error) {
          fail(error instanceof Error ? error : new DiscordRpcError(String(error)))
          return
        }

        for (const frame of frames) {
          if (frame.op === Op.CLOSE) {
            const data = frame.data as { code?: number; message?: string } | undefined
            fail(new DiscordRpcError(data?.message ?? "Discord closed the handshake", data?.code))
            return
          }

          if (frame.op !== Op.FRAME) continue

          const payload = frame.data as WirePayload | undefined
          if (payload?.evt === "ERROR") {
            const data = payload.data as { code?: number; message?: string } | undefined
            fail(new DiscordRpcError(data?.message ?? "Discord rejected the handshake", data?.code))
            return
          }

          if (payload?.cmd === "DISPATCH" && payload.evt === "READY") {
            succeed()
            return
          }
        }
      }

      const timer = setTimeout(() => {
        fail(new DiscordRpcError("Discord IPC handshake timed out"))
      }, this.#requestTimeoutMs)

      socket.on("connect", onConnect)
      socket.on("data", onData)
      socket.on("error", onError)
      socket.on("close", onClose)
    })
  }

  #attach(socket: Socket): void {
    this.#decoder = new FrameDecoder()

    socket.setNoDelay(true)
    socket.on("data", (chunk: Buffer) => this.#onData(chunk))
    socket.on("error", (error) => this.#logger.debug(`Discord socket error: ${describe(error)}`))
    socket.on("close", () => this.#onClose())
  }

  #onData(chunk: Buffer): void {
    let frames: Frame[]
    try {
      frames = this.#decoder.push(chunk)
    } catch (error) {
      this.#logger.warn(`Discord protocol error: ${describe(error)}`)
      this.#socket?.destroy()
      return
    }

    for (const frame of frames) {
      if (frame.op === Op.PING) {
        this.#socket?.write(encodeFrame(Op.PONG, frame.data))
        continue
      }

      if (frame.op === Op.CLOSE) {
        const data = frame.data as { code?: number; message?: string } | undefined
        this.#logger.warn(`Discord closed the IPC connection: ${data?.message ?? "unknown reason"}`)
        this.#socket?.destroy()
        continue
      }

      if (frame.op !== Op.FRAME) continue

      const payload = frame.data as WirePayload | undefined
      if (!payload?.nonce) continue

      if (payload.evt === "ERROR") {
        const data = payload.data as { code?: number; message?: string } | undefined
        this.#rejectPending(
          payload.nonce,
          new DiscordRpcError(data?.message ?? "Discord rejected the request", data?.code),
        )
        continue
      }

      this.#resolvePending(payload.nonce, payload.data)
    }
  }

  #onClose(): void {
    const wasConnected = this.#connected
    this.#teardown()

    if (this.#stopRequested) return
    if (wasConnected) this.#logger.debug("Discord IPC connection closed")
    this.#scheduleReconnect()
  }

  #teardown(): void {
    this.#connected = false

    for (const [nonce, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new DiscordRpcError("Discord IPC connection closed"))
      this.#pending.delete(nonce)
    }

    if (this.#socket) {
      this.#socket.removeAllListeners()
      this.#socket.destroy()
      this.#socket = null
    }
  }

  #request(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    const socket = this.#socket
    if (!socket || !this.#connected) {
      return Promise.reject(new DiscordRpcError("Not connected to Discord"))
    }

    const nonce = randomUUID()
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(nonce)
        reject(new DiscordRpcError(`Discord did not answer ${cmd} in time`))
        socket.destroy()
      }, this.#requestTimeoutMs)

      this.#pending.set(nonce, { resolve, reject, timer })
    })

    try {
      socket.write(encodeFrame(Op.FRAME, { cmd, args, nonce }))
    } catch (error) {
      this.#rejectPending(nonce, error instanceof Error ? error : new DiscordRpcError(String(error)))
    }

    return promise
  }

  #resolvePending(nonce: string, value: unknown): void {
    const pending = this.#pending.get(nonce)
    if (!pending) return
    this.#pending.delete(nonce)
    clearTimeout(pending.timer)
    pending.resolve(value)
  }

  #rejectPending(nonce: string, error: Error): void {
    const pending = this.#pending.get(nonce)
    if (!pending) return
    this.#pending.delete(nonce)
    clearTimeout(pending.timer)
    pending.reject(error)
  }

  #flush(): Promise<void> {
    if (this.#flushPromise) return this.#flushPromise

    this.#flushPromise = this.#flushLoop().finally(() => {
      this.#flushPromise = null
    })
    return this.#flushPromise
  }

  async #flushLoop(): Promise<void> {
    while (this.#connected && this.#desired !== undefined) {
      const value = this.#desired
      const key = JSON.stringify(value ?? null)

      if (key === this.#lastSentKey) {
        if (this.#desired === value) this.#desired = undefined
        continue
      }

      const wait = Number.isFinite(this.#lastSentAt)
        ? this.#minUpdateIntervalMs - (this.#now() - this.#lastSentAt)
        : 0
      if (wait > 0) {
        await delay(wait)
        continue
      }

      if (!this.#connected) return
      if (this.#desired !== value) continue

      try {
        await this.#request("SET_ACTIVITY", { pid: this.#pid, activity: value })
        this.#lastSentAt = this.#now()
        this.#lastSentKey = key
        if (this.#desired === value) this.#desired = undefined
      } catch (error) {
        if (this.#desired === value) this.#desired = undefined
        throw error
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingSocket(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}
