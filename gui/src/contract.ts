import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

export const ConfigSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  autostart: Schema.Boolean,
  showProject: Schema.Boolean,
  showModel: Schema.Boolean,
  showTokens: Schema.Boolean,
  showCost: Schema.Boolean,
  showElapsed: Schema.Boolean,
  privateMode: Schema.Boolean,
})

export type Config = typeof ConfigSchema.Type

export const StatusSchema = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Number,
  daemonVersion: Schema.String,
  enabled: Schema.Boolean,
  discordConnected: Schema.Boolean,
  source: Schema.String,
  project: Schema.String,
  model: Schema.String,
  tokens: Schema.Number,
  costUSD: Schema.Number,
  startedAt: Schema.optional(Schema.String),
  busy: Schema.Boolean,
  updatedAt: Schema.String,
})

export type Status = typeof StatusSchema.Type

export const SnapshotSchema = Schema.Struct({
  config: ConfigSchema,
  status: Schema.optional(StatusSchema),
  configPath: Schema.String,
  configError: Schema.optional(Schema.String),
})

export type Snapshot = typeof SnapshotSchema.Type

export const SettingsIpc = Ipc.define({
  // The host derives the plugin id from the OpenCode package name and an Ipc
  // id must live under it.
  id: "opencode-discord-status-gui.settings",
  methods: {
    get: { output: SnapshotSchema },
    update: { input: ConfigSchema, output: SnapshotSchema },
  },
})
