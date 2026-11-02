import { join } from "node:path"

/**
 * Discord exposes a local IPC socket per running desktop client. Several
 * clients can coexist, so Discord increments the index. Sandboxed builds
 * (Flatpak, Snap, Vesktop) keep the socket under their own runtime directory.
 */
export function socketCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (env.DISCORD_IPC_PATH) return [env.DISCORD_IPC_PATH]

  if (platform === "win32") {
    return Array.from({ length: 10 }, (_, index) => String.raw`\\?\pipe\discord-ipc-${index}`)
  }

  const bases = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, "/tmp"].filter(
    (value): value is string => Boolean(value),
  )

  const sandboxes = env.XDG_RUNTIME_DIR
    ? [
        "app/com.discordapp.Discord",
        "app/com.discordapp.DiscordCanary",
        "app/dev.vencord.Vesktop",
        "snap.discord",
        "snap.discord-canary",
      ].map((name) => join(env.XDG_RUNTIME_DIR!, name))
    : []

  const paths: string[] = []
  const seen = new Set<string>()

  for (const directory of [...bases, ...sandboxes]) {
    for (let index = 0; index < 10; index += 1) {
      const path = join(directory, `discord-ipc-${index}`)
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }
  }

  return paths
}
