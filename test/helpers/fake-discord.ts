import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FrameDecoder, Op, encodeFrame, type Frame } from "../../src/discord/frames.ts"

export interface FakeDiscordOptions {
  /** Do not answer the handshake, to exercise client timeouts. */
  ignoreHandshake?: boolean
  /** Close the connection during the handshake instead of sending READY. */
  rejectHandshake?: { code: number; message: string }
  /** Reply to SET_ACTIVITY with an error frame. */
  errorOnSetActivity?: { code: number; message: string }
}

export class FakeDiscord {
  readonly path: string
  readonly handshakes: unknown[] = []
  readonly activities: unknown[] = []
  readonly pongs: unknown[] = []
  readyCount = 0

  readonly #directory: string
  readonly #server: Server
  readonly #options: FakeDiscordOptions
  readonly #sockets = new Set<Socket>()

  private constructor(directory: string, path: string, server: Server, options: FakeDiscordOptions) {
    this.#directory = directory
    this.path = path
    this.#server = server
    this.#options = options
  }

  static async start(options: FakeDiscordOptions = {}): Promise<FakeDiscord> {
    const directory = await mkdtemp(join(tmpdir(), "opencode-discord-"))
    const path = join(directory, "discord-ipc-0")
    const server = createServer()
    const fake = new FakeDiscord(directory, path, server, options)

    server.on("connection", (socket) => fake.#accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(path, () => {
        server.off("error", reject)
        resolve()
      })
    })

    return fake
  }

  #accept(socket: Socket): void {
    this.#sockets.add(socket)
    const decoder = new FrameDecoder()
    let ready = false

    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        this.#handle(socket, frame, () => ready, () => {
          ready = true
          this.readyCount += 1
        })
      }
    })
    socket.on("close", () => this.#sockets.delete(socket))
    socket.on("error", () => this.#sockets.delete(socket))
  }

  #handle(socket: Socket, frame: Frame, isReady: () => boolean, markReady: () => void): void {
    if (frame.op === Op.HANDSHAKE) {
      this.handshakes.push(frame.data)
      if (this.#options.ignoreHandshake) return
      if (this.#options.rejectHandshake) {
        socket.write(encodeFrame(Op.CLOSE, this.#options.rejectHandshake))
        socket.end()
        return
      }
      socket.write(
        encodeFrame(Op.FRAME, {
          cmd: "DISPATCH",
          evt: "READY",
          data: { v: 1, config: {}, user: { id: "1", username: "tester" } },
        }),
      )
      markReady()
      return
    }

    if (frame.op === Op.PING) {
      socket.write(encodeFrame(Op.PONG, frame.data))
      return
    }

    if (frame.op === Op.PONG) {
      this.pongs.push(frame.data)
      return
    }

    if (frame.op !== Op.FRAME || !isReady()) return

    const payload = frame.data as { cmd?: string; nonce?: string; args?: Record<string, unknown> }
    if (payload.cmd !== "SET_ACTIVITY") return

    this.activities.push(payload.args?.activity)

    if (this.#options.errorOnSetActivity) {
      socket.write(
        encodeFrame(Op.FRAME, {
          cmd: "SET_ACTIVITY",
          evt: "ERROR",
          nonce: payload.nonce,
          data: this.#options.errorOnSetActivity,
        }),
      )
      return
    }

    socket.write(
      encodeFrame(Op.FRAME, {
        cmd: "SET_ACTIVITY",
        evt: null,
        nonce: payload.nonce,
        data: payload.args?.activity,
      }),
    )
  }

  sendPing(payload: unknown): void {
    for (const socket of this.#sockets) socket.write(encodeFrame(Op.PING, payload))
  }

  dropConnections(): void {
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
  }

  async waitFor<T>(condition: () => T | undefined | false, label: string, timeoutMs = 2_000): Promise<T> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const value = condition()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`Timed out waiting for ${label}`)
  }

  async close(): Promise<void> {
    this.dropConnections()
    await new Promise<void>((resolve) => this.#server.close(() => resolve()))
    await rm(this.#directory, { recursive: true, force: true })
  }
}
