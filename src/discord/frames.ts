/**
 * Discord IPC framing.
 *
 * Every message is an 8-byte little-endian header followed by a JSON payload:
 *   uint32 opcode | uint32 payload length | UTF-8 JSON
 *
 * https://discord.com/developers/docs/topics/rpc#packet-format
 */
export const Op = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const

export type OpCode = (typeof Op)[keyof typeof Op]

export interface Frame {
  op: number
  data: unknown
}

const HEADER_BYTES = 8
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024

export interface FrameDecoderOptions {
  maxPayloadBytes?: number
}

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = JSON.stringify(payload)
  const body = json === undefined ? Buffer.alloc(0) : Buffer.from(json, "utf8")
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length)
  frame.writeUInt32LE(op, 0)
  frame.writeUInt32LE(body.length, 4)
  body.copy(frame, HEADER_BYTES)
  return frame
}

export class ProtocolError extends Error {
  override name = "ProtocolError"
}

export class FrameDecoder {
  readonly #maxPayloadBytes: number
  #buffer: Buffer = Buffer.alloc(0)

  constructor(options: FrameDecoderOptions = {}) {
    this.#maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  }

  push(chunk: Buffer): Frame[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    const frames: Frame[] = []

    while (this.#buffer.length >= HEADER_BYTES) {
      const op = this.#buffer.readUInt32LE(0)
      const length = this.#buffer.readUInt32LE(4)

      if (length > this.#maxPayloadBytes) {
        throw new ProtocolError(`Frame payload too large: ${length} bytes`)
      }

      if (this.#buffer.length < HEADER_BYTES + length) break

      const body = this.#buffer.subarray(HEADER_BYTES, HEADER_BYTES + length)
      this.#buffer = this.#buffer.subarray(HEADER_BYTES + length)

      let data: unknown
      try {
        data = length === 0 ? undefined : JSON.parse(body.toString("utf8"))
      } catch (error) {
        throw new ProtocolError(
          `Invalid frame payload: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      frames.push({ op, data })
    }

    return frames
  }
}
