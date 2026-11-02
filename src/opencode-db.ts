import { DatabaseSync } from "node:sqlite"

import { SESSION_QUERY, expandHome, type SessionRow } from "./db-presence.ts"

/**
 * Read the newest sessions straight from OpenCode's SQLite database.
 *
 * Opens and closes per read: cheap at a two-second cadence, and it never holds
 * a handle across an OpenCode upgrade that replaces or migrates the file.
 */
export function readLocalRows(dbPath: string): SessionRow[] {
  const database = new DatabaseSync(expandHome(dbPath), { readOnly: true })
  try {
    return database.prepare(SESSION_QUERY).all() as SessionRow[]
  } finally {
    database.close()
  }
}
