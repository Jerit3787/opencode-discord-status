import type { Plugin } from "@opencode/plugin/gui"
import { configPath, readConfigFile, readStatusFile, statusPath, writeConfigFile } from "./config"
import { SettingsIpc, type Snapshot } from "./contract"

export const main: Plugin.MainSetup = (ctx) => {
  let lastConfigError: string | undefined

  const snapshot = async (): Promise<Snapshot> => {
    const path = configPath()
    const { config, error } = await readConfigFile(path)

    if (error) {
      if (error !== lastConfigError) {
        ctx.log.write("warn", "opencode-discord-status config problem", { error })
        lastConfigError = error
      }
    } else {
      lastConfigError = undefined
    }

    const status = await readStatusFile(statusPath())
    return {
      config,
      status,
      configPath: path,
      ...(error ? { configError: error } : {}),
    }
  }

  ctx.provide(SettingsIpc, {
    get: snapshot,
    update: async (config) => {
      try {
        await writeConfigFile(configPath(), config)
      } catch (cause) {
        ctx.log.write("error", "opencode-discord-status config write failed", {
          error: String(cause),
        })
        throw cause
      }
      return snapshot()
    },
  })
}
