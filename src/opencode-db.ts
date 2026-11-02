import { DatabaseSync } from "node:sqlite"

import { SESSION_QUERY, type SessionRow } from "./db-presence.ts"
import { expandHome } from "./state-file.ts"

/**
 * Read the newest session straight from OpenCode's SQLite database.
 *
 * Opens and closes per read: cheap at a two-second cadence, and it never holds
 * a handle across an OpenCode upgrade that replaces or migrates the file.
 */
export function readLocalRow(dbPath: string): SessionRow | undefined {
  const database = new DatabaseSync(expandHome(dbPath), { readOnly: true })
  try {
    return database.prepare(SESSION_QUERY).get() as SessionRow | undefined
  } finally {
    database.close()
  }
}
