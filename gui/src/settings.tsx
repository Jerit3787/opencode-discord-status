import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { Context } from "@opencode/plugin/gui"
import { configPath, DEFAULT_CONFIG } from "./config"
import type { Config, Status } from "./contract"
import { buildPreview, formatCost, formatTokens, isStatusStale } from "./preview"
import type { SettingsState } from "./state"

function formatRelative(value: string | undefined, now: number): string {
  if (!value) return "—"
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "unknown"

  const delta = Math.max(0, now - timestamp)
  if (delta < 1_000) return "just now"
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s ago`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  return `${Math.floor(delta / 3_600_000)}h ago`
}

function ToggleRow(props: {
  ui: Context["ui"]
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div class="ods-row">
      <div class="ods-row-copy">
        <span class="ods-row-title">{props.title}</span>
        <span class="ods-row-desc">{props.description}</span>
      </div>
      <props.ui.Switch
        label={props.title}
        hideLabel
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </div>
  )
}

export function DiscordPresenceSettings(props: { state: SettingsState; ctx: Context }) {
  const ui = props.ctx.ui
  const [now, setNow] = createSignal(Date.now())
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })
  onCleanup(() => {
    if (copyTimer !== undefined) clearTimeout(copyTimer)
  })

  const snapshot = () => props.state.snapshot()
  const config = (): Config => snapshot()?.config ?? DEFAULT_CONFIG
  const status = (): Status | undefined => snapshot()?.status
  const stale = () => isStatusStale(status(), now())
  const running = () => status() !== undefined && !stale()
  const preview = createMemo(() => buildPreview(config(), status(), now()))
  const controlsDisabled = () => snapshot() === undefined || props.state.saving()
  const path = () => snapshot()?.configPath ?? configPath()

  const connected = () => running() && config().enabled && status()?.discordConnected === true
  const dotTone = () => {
    if (!running()) return ""
    return connected() ? "ods-dot--on" : "ods-dot--warn"
  }

  const headline = () => {
    if (!running()) return "Daemon not running"
    if (!config().enabled) return "Presence disabled"
    if (!status()?.discordConnected) return "Discord unavailable"
    return "Discord connected"
  }

  const statusDetail = () => {
    if (!running()) return "Settings stay editable; changes apply when the daemon starts."
    if (!config().enabled) return "The daemon is running and Discord activity has been cleared."
    if (!status()?.discordConnected) return "The daemon is retrying the Discord connection."
    return status()?.busy ? "Showing the busy session." : "Showing the idle card."
  }

  const projectValue = () => {
    const current = status()
    if (!current) return "—"
    if (config().privateMode || !config().showProject) return "Hidden"
    return current.project || "—"
  }

  const set = (patch: Partial<Config>) => {
    void props.state.update(patch)
  }

  const copyPath = async () => {
    try {
      await props.ctx.system.copy(path())
      setCopied(true)
      if (copyTimer !== undefined) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => setCopied(false), 1_500)
    } catch {
      // The path stays visible if the clipboard is unavailable.
    }
  }

  const revealPath = () => {
    void props.ctx.desktop?.reveal(path()).catch(() => undefined)
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">Discord Presence</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              Choose what your OpenCode session shows on Discord.
            </span>
          </div>
          <div class="settings-tab-header-actions">
            <Show when={props.state.saving()}>
              <span class="ods-muted">Saving…</span>
            </Show>
            <ui.Button
              variant="neutral"
              icon="refresh"
              busy={props.state.loading()}
              onClick={() => void props.state.refresh()}
            >
              Refresh
            </ui.Button>
          </div>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <div class="ods-stack">
          <Show when={props.state.error()}>
            {(message) => (
              <div class="ods-notice ods-notice--error">
                <span>{message()}</span>
                <Show when={props.ctx.desktop}>
                  <ui.Button
                    variant="ghost"
                    size="small"
                    onClick={() => void props.state.refresh()}
                  >
                    Retry
                  </ui.Button>
                </Show>
              </div>
            )}
          </Show>

          <Show when={snapshot()?.configError}>
            {(message) => (
              <div class="ods-notice">
                <span>
                  Config file needs attention: {message()}. Toggle any setting to rewrite it with
                  valid values.
                </span>
              </div>
            )}
          </Show>

          <Show when={snapshot() === undefined}>
            <div class="ods-notice">
              <span>
                {props.state.loading()
                  ? "Loading Discord presence settings…"
                  : "Settings are unavailable. This page needs OpenCode Desktop."}
              </span>
            </div>
          </Show>

          <div class="ods-card">
            <div class="ods-status">
              <span class={`ods-dot ${dotTone()}`} />
              <div style={{ flex: 1, "min-width": 0 }}>
                <div class="ods-card-title">{headline()}</div>
                <div class="ods-muted">{statusDetail()}</div>
                <Show when={running()}>
                  <div class="ods-grid">
                    <div>
                      <div class="ods-meta-label">Project</div>
                      <div class="ods-meta-value">{projectValue()}</div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Model</div>
                      <div class="ods-meta-value">{status()?.model || "—"}</div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Tokens</div>
                      <div class="ods-meta-value">{formatTokens(status()?.tokens ?? 0)}</div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Cost</div>
                      <div class="ods-meta-value">{formatCost(status()?.costUSD ?? 0)}</div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Source</div>
                      <div class="ods-meta-value">{status()?.source || "—"}</div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Last update</div>
                      <div class="ods-meta-value">
                        {formatRelative(status()?.updatedAt, now())}
                      </div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Daemon</div>
                      <div class="ods-meta-value">{status()?.daemonVersion || "—"}</div>
                    </div>
                    <div>
                      <div class="ods-meta-label">Session</div>
                      <div class="ods-meta-value">{status()?.busy ? "Working" : "Idle"}</div>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          <div class="ods-card">
            <ToggleRow
              ui={ui}
              title="Enable Discord presence"
              description="Turning this off clears Discord immediately without stopping the daemon."
              checked={config().enabled}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ enabled: checked })}
            />
          </div>

          <div class="ods-card">
            <div class="ods-card-head">
              <div>
                <div class="ods-card-title">Presence details</div>
                <div class="ods-muted">Choose which fields appear on Discord.</div>
              </div>
            </div>
            <ToggleRow
              ui={ui}
              title="Project name"
              description="Show the project on the details line."
              checked={config().showProject}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ showProject: checked })}
            />
            <ToggleRow
              ui={ui}
              title="Model"
              description="Show the model on the state line while working."
              checked={config().showModel}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ showModel: checked })}
            />
            <ToggleRow
              ui={ui}
              title="Token count"
              description="Show input plus output tokens."
              checked={config().showTokens}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ showTokens: checked })}
            />
            <ToggleRow
              ui={ui}
              title="Estimated cost"
              description="Show the session's estimated cost."
              checked={config().showCost}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ showCost: checked })}
            />
            <ToggleRow
              ui={ui}
              title="Elapsed time"
              description="Show the Discord elapsed timer while working."
              checked={config().showElapsed}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ showElapsed: checked })}
            />
            <ToggleRow
              ui={ui}
              title="Private mode"
              description="Replace the project with “a session” and hide it from the idle state line."
              checked={config().privateMode}
              disabled={controlsDisabled()}
              onChange={(checked) => set({ privateMode: checked })}
            />
          </div>

          <div class="ods-card">
            <div class="ods-card-head">
              <div>
                <div class="ods-card-title">Live preview</div>
                <div class="ods-muted">
                  {preview().sample
                    ? "Sample session. Start the daemon to see live activity."
                    : "Built from the daemon's latest status."}
                </div>
              </div>
              <Show when={!config().enabled}>
                <span class="ods-badge ods-badge--off">Presence is off</span>
              </Show>
            </div>
            <div class={`ods-preview ${config().enabled ? "" : "ods-preview--off"}`}>
              <div class="ods-preview-line">{preview().details}</div>
              <div class="ods-preview-line ods-preview-line--state">{preview().state}</div>
              <div
                class={`ods-preview-elapsed ${
                  config().showElapsed ? "" : "ods-preview-elapsed--off"
                }`}
              >
                {preview().elapsed ?? "00:00:00"}
              </div>
            </div>
          </div>

          <div class="ods-footer">
            <span class="ods-path">{path()}</span>
            <ui.Button variant="ghost" size="small" icon="copy" onClick={() => void copyPath()}>
              {copied() ? "Copied" : "Copy path"}
            </ui.Button>
            <Show when={props.ctx.desktop}>
              <ui.Button
                variant="ghost"
                size="small"
                icon="folder"
                disabled={snapshot() === undefined}
                onClick={revealPath}
              >
                Reveal
              </ui.Button>
            </Show>
          </div>

          <div class="ods-muted">Changes apply live to a running daemon. No restart needed.</div>
        </div>
      </div>
    </>
  )
}
