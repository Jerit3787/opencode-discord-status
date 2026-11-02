import test from "node:test"
import assert from "node:assert/strict"

import { FrameDecoder, Op, encodeFrame } from "../src/discord/frames.ts"

test("encodeFrame writes a little-endian header and JSON payload", () => {
  const payload = { cmd: "PING", nonce: "abc" }
  const frame = encodeFrame(Op.FRAME, payload)

  assert.equal(frame.readUInt32LE(0), Op.FRAME)
  assert.equal(frame.readUInt32LE(4), Buffer.byteLength(JSON.stringify(payload)))
  assert.deepEqual(JSON.parse(frame.subarray(8).toString("utf8")), payload)
})

test("decodes a frame split across many chunks", () => {
  const decoder = new FrameDecoder()
  const frame = encodeFrame(Op.FRAME, { evt: "READY" })
  const decoded = []

  for (const byte of frame) {
    decoded.push(...decoder.push(Buffer.from([byte])))
  }

  assert.deepEqual(decoded, [{ op: Op.FRAME, data: { evt: "READY" } }])
})

test("decodes multiple frames delivered in one chunk", () => {
  const decoder = new FrameDecoder()
  const chunk = Buffer.concat([
    encodeFrame(Op.PING, { at: 1 }),
    encodeFrame(Op.FRAME, { cmd: "DISPATCH" }),
  ])

  assert.deepEqual(decoder.push(chunk), [
    { op: Op.PING, data: { at: 1 } },
    { op: Op.FRAME, data: { cmd: "DISPATCH" } },
  ])
})

test("decodes an empty payload", () => {
  const decoder = new FrameDecoder()
  const frame = encodeFrame(Op.PONG, undefined)

  assert.deepEqual(decoder.push(frame), [{ op: Op.PONG, data: undefined }])
})

test("rejects malformed JSON with a useful error", () => {
  const decoder = new FrameDecoder()
  const payload = Buffer.from("{not json", "utf8")
  const header = Buffer.alloc(8)
  header.writeUInt32LE(Op.FRAME, 0)
  header.writeUInt32LE(payload.length, 4)

  assert.throws(() => decoder.push(Buffer.concat([header, payload])), /invalid frame payload/i)
})

test("rejects absurd frame lengths instead of buffering forever", () => {
  const decoder = new FrameDecoder({ maxPayloadBytes: 16 })
  const header = Buffer.alloc(8)
  header.writeUInt32LE(Op.FRAME, 0)
  header.writeUInt32LE(17, 4)

  assert.throws(() => decoder.push(header), /too large/i)
})
