import { createSignal, onCleanup } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import { SettingsIpc, type Config, type Snapshot } from "./contract"

export type SettingsState = {
  snapshot: () => Snapshot | undefined
  loading: () => boolean
  saving: () => boolean
  error: () => string | undefined
  refresh: () => Promise<void>
  update: (patch: Partial<Config>) => Promise<void>
}

const POLL_INTERVAL_MS = 3_000

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Loads config/status from the OpenCode main process and saves changes. */
export function createSettingsState(ctx: Context): SettingsState {
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()

  let generation = 0
  const failure = (cause: unknown): string =>
    ctx.desktop === undefined ? "This page needs OpenCode Desktop." : messageOf(cause)

  const refresh = async (): Promise<void> => {
    if (saving()) return
    const id = ++generation
    try {
      const next = await ctx.main(SettingsIpc).get()
      if (id !== generation) return
      setSnapshot(next)
      setError(undefined)
    } catch (cause) {
      if (id !== generation) return
      setError(failure(cause))
    } finally {
      if (id === generation) setLoading(false)
    }
  }

  const update = async (patch: Partial<Config>): Promise<void> => {
    const current = snapshot()
    if (!current) return

    const id = ++generation
    const config = { ...current.config, ...patch } as Config
    setSnapshot({ ...current, config })
    setSaving(true)
    setError(undefined)

    try {
      const next = await ctx.main(SettingsIpc).update(config)
      if (id !== generation) return
      setSnapshot(next)
    } catch (cause) {
      if (id !== generation) return
      setSnapshot(current)
      setError(failure(cause))
    } finally {
      if (id === generation) setSaving(false)
    }
  }

  void refresh()
  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
  onCleanup(() => clearInterval(timer))

  return { snapshot, loading, saving, error, refresh, update }
}
