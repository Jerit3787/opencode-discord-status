import { existsSync } from "node:fs"

import { parseConfig } from "../src/config.ts"
import { DiscordRpcClient, consoleLogger } from "../src/discord/client.ts"
import { socketCandidates } from "../src/discord/socket.ts"

const rawClientId = process.argv[2] ?? process.env.DISCORD_CLIENT_ID
const parsed = parseConfig(rawClientId === undefined ? {} : { clientId: rawClientId })

if (!parsed.ok) {
  console.error(`\n${parsed.error}\n`)
  console.error("Usage: npm run doctor -- <discord-application-id>")
  console.error("   or: DISCORD_CLIENT_ID=<discord-application-id> npm run doctor\n")
  reportSockets()
  process.exitCode = 1
} else {
  await run(parsed.config.clientId)
}

async function run(clientId: string): Promise<void> {
  const client = new DiscordRpcClient({
    clientId,
    reconnect: false,
    minUpdateIntervalMs: 0,
    logger: consoleLogger,
  })

  try {
    console.log("Looking for the Discord desktop client...")
    await client.start()
    console.log("Connected. Setting a test presence for 8 seconds...")

    await client.setActivity({
      details: "Testing opencode-discord-status",
      state: "If you can see this, the plugin will work",
      timestamps: { start: Date.now() },
    })

    await new Promise((resolve) => setTimeout(resolve, 8_000))
    await client.stop()
    console.log("Cleared the test presence. Everything looks good.")
  } catch (error) {
    console.error(`\nCould not reach Discord: ${error instanceof Error ? error.message : String(error)}`)
    console.error("Make sure the Discord desktop app is running and you are signed in.\n")
    reportSockets()
    await client.stop().catch(() => {})
    process.exitCode = 1
  }
}

function reportSockets(): void {
  const candidates = socketCandidates()
  const found = candidates.filter((path) => existsSync(path))

  if (found.length === 0) {
    console.error("No Discord IPC socket was found. Is the Discord desktop app running?")
    console.error(`Looked in ${candidates.length} locations, including ${candidates.slice(0, 3).join(", ")}.`)
    return
  }

  console.error(`Found ${found.length} Discord IPC socket(s):`)
  for (const path of found.slice(0, 5)) console.error(`  ${path}`)
}
