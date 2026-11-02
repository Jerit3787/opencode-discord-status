import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type { DiscordActivity, Logger } from "./discord/client.ts"

export interface PresenceFrame {
  v: 1
  updatedAt: number
  pid: number
  activity: DiscordActivity | null
}

const silentLogger: Logger = { debug() {}, warn() {}, error() {} }

/**
 * Mirrors the winning activity to a small JSON file.
 *
 * On a remote SSH host there is no Discord socket, so the plugin writes what it
 * would have shown. A bridge on the machine with Discord tails this file and
 * publishes it locally.
 */
export class StateFile {
  readonly #path: string
  readonly #logger: Logger
  #queue: Promise<void> = Promise.resolve()
  #directoryReady: Promise<unknown> | undefined

  constructor(path: string, logger: Logger = silentLogger) {
    this.#path = expandHome(path)
    this.#logger = logger
    this.#directoryReady = mkdir(dirname(this.#path), { recursive: true })
  }

  get path(): string {
    return this.#path
  }

  /** Queue a write. Only the newest activity matters, so writes are serialized. */
  write(activity: DiscordActivity | null): void {
    const frame: PresenceFrame = {
      v: 1,
      updatedAt: Date.now(),
      pid: process.pid,
      activity,
    }
    const payload = `${JSON.stringify(frame)}\n`
    const temporary = `${this.#path}.${process.pid}.tmp`

    this.#queue = this.#queue
      .then(() => this.#directoryReady)
      // Write then rename, so a reader never sees a half-written frame.
      .then(() => writeFile(temporary, payload, { mode: 0o600 }))
      .then(() => rename(temporary, this.#path))
      .catch((error: unknown) => {
        this.#logger.debug(`Could not write presence state: ${describe(error)}`)
      })
  }

  /** Resolves once every queued write has hit the disk. */
  flush(): Promise<void> {
    return this.#queue
  }
}

export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
