import test from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  formatModelName,
  pickSessionRow,
  snapshotFromRow,
  type SessionRow,
} from "../src/db-presence.ts"
import { readLocalRows } from "../src/opencode-db.ts"

const NOW = 1_700_000_000_000
const MODEL = JSON.stringify({
  id: "deepseek-v4.1-flash",
  providerID: "opencode-go",
  variant: "max",
})

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    session_id: "ses_1",
    directory: "/work/my-app",
    title: "Fix the login bug",
    model: MODEL,
    agent: "build",
    cost: 0.0421,
    tokens_input: 11_800,
    tokens_output: 460,
    time_updated: NOW - 1_000,
    message: JSON.stringify({
      time: { created: NOW - 5_000, streamed: NOW - 1_000 },
      agent: "build",
      model: { id: "deepseek-v4.1-flash" },
    }),
    ...overrides,
  }
}

test("formats common model ids into display names", () => {
  assert.equal(formatModelName("deepseek-v4.1-flash"), "DeepSeek V4.1 Flash")
  assert.equal(formatModelName("gpt-6-astra"), "GPT 6 Astra")
  assert.equal(formatModelName("glm-5.3"), "GLM 5.3")
  assert.equal(formatModelName("claude-sonnet-4-5"), "Claude Sonnet 4 5")
  assert.equal(formatModelName(undefined), undefined)
})

test("a streaming assistant message is busy", () => {
  const snapshot = snapshotFromRow(row(), NOW)

  assert.equal(snapshot.status, "busy")
  assert.equal(snapshot.project, "my-app")
  assert.equal(snapshot.model, "DeepSeek V4.1 Flash")
  assert.equal(snapshot.agent, "build")
  assert.equal(snapshot.cost, 0.0421)
  assert.deepEqual(snapshot.tokens, { input: 11_800, output: 460 })
  assert.equal(snapshot.startedAt, NOW - 5_000)
})

test("a step waiting on tools stays busy", () => {
  const snapshot = snapshotFromRow(
    row({
      message: JSON.stringify({
        time: { created: NOW - 5_000, completed: NOW - 1_000 },
        finish: "tool-calls",
      }),
    }),
    NOW,
  )

  assert.equal(snapshot.status, "busy")
})

test("a finished step is idle", () => {
  const snapshot = snapshotFromRow(
    row({
      message: JSON.stringify({
        time: { created: NOW - 5_000, completed: NOW - 1_000 },
        finish: "stop",
      }),
    }),
    NOW,
  )

  assert.equal(snapshot.status, "idle")
  assert.equal(snapshot.project, "my-app")
})

test("a session with no recent writes is idle even mid-step", () => {
  const snapshot = snapshotFromRow(
    row({ time_updated: NOW - 3_600_000 }),
    NOW,
    900_000,
  )

  assert.equal(snapshot.status, "idle")
})

test("no session produces a plain idle card", () => {
  assert.deepEqual(snapshotFromRow(undefined, NOW), { status: "idle" })
})

test("a busy session beats a newer idle one", () => {
  const busy = row({ session_id: "busy", time_updated: NOW - 10_000 })
  const idle = row({
    session_id: "idle",
    time_updated: NOW - 1_000,
    message: JSON.stringify({
      time: { created: NOW - 5_000, completed: NOW - 1_000 },
      finish: "stop",
    }),
  })

  assert.equal(pickSessionRow([idle, busy], NOW)?.session_id, "busy")
})

test("the most recently written busy session wins", () => {
  const older = row({ session_id: "older", time_updated: NOW - 10_000 })
  const newer = row({ session_id: "newer", time_updated: NOW - 1_000 })

  assert.equal(pickSessionRow([older, newer], NOW)?.session_id, "newer")
})

test("a small recency gap keeps the session already on the card", () => {
  const incumbent = row({ session_id: "incumbent", time_updated: NOW - 2_000 })
  const challenger = row({ session_id: "challenger", time_updated: NOW - 1_000 })

  assert.equal(
    pickSessionRow([incumbent, challenger], NOW, undefined, { incumbent: "incumbent" })
      ?.session_id,
    "incumbent",
  )
})

test("a clearly newer busy session takes over", () => {
  const incumbent = row({ session_id: "incumbent", time_updated: NOW - 30_000 })
  const challenger = row({ session_id: "challenger", time_updated: NOW - 1_000 })

  assert.equal(
    pickSessionRow([incumbent, challenger], NOW, undefined, { incumbent: "incumbent" })
      ?.session_id,
    "challenger",
  )
})

test("a busy session takes over from an idle incumbent", () => {
  const incumbent = row({
    session_id: "incumbent",
    time_updated: NOW - 1_000,
    message: JSON.stringify({
      time: { created: NOW - 5_000, completed: NOW - 1_000 },
      finish: "stop",
    }),
  })
  const challenger = row({ session_id: "challenger", time_updated: NOW - 2_000 })

  assert.equal(
    pickSessionRow([incumbent, challenger], NOW, undefined, { incumbent: "incumbent" })
      ?.session_id,
    "challenger",
  )
})

test("reads a busy session from a real SQLite database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-db-"))
  const path = join(directory, "opencode.db")

  try {
    const database = new DatabaseSync(path)
    database.exec(`
      create table session_v2 (
        id text primary key,
        directory text,
        title text,
        model text,
        agent text,
        cost real,
        tokens_input integer,
        tokens_output integer,
        time_updated integer,
        time_archived integer
      );
      create table session_message (
        id text primary key,
        session_id text,
        type text,
        seq integer,
        data text
      );
    `)
    database
      .prepare(
        "insert into session_v2 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "ses_1",
        "/work/my-app",
        "Fix the login bug",
        MODEL,
        "build",
        0.0421,
        11_800,
        460,
        NOW - 1_000,
        null,
      )
    database
      .prepare("insert into session_message values (?, ?, ?, ?, ?)")
      .run(
        "msg_1",
        "ses_1",
        "assistant",
        1,
        JSON.stringify({
          time: { created: NOW - 5_000, streamed: NOW - 1_000 },
          agent: "build",
          model: { id: "deepseek-v4.1-flash" },
        }),
      )
    database.close()

    const snapshot = snapshotFromRow(readLocalRows(path)[0], NOW)

    assert.equal(snapshot.status, "busy")
    assert.equal(snapshot.project, "my-app")
    assert.equal(snapshot.model, "DeepSeek V4.1 Flash")
    assert.deepEqual(snapshot.tokens, { input: 11_800, output: 460 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
