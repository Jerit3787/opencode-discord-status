import { Command, Plugin, SettingsPage, Style } from "@opencode/plugin/gui"
import { main } from "./main"
import { DiscordPresenceSettings } from "./settings"
import { createSettingsState } from "./state"
import { presenceStyles } from "./styles"

export default Plugin.define({
  setup(ctx) {
    const state = createSettingsState(ctx)

    ctx.add(Style, presenceStyles)
    ctx.add(SettingsPage, {
      id: "opencode-discord-status",
      icon: "discord",
      title: "Discord Presence",
      entries: [
        {
          id: "presence",
          title: "Discord Presence",
          description: "Choose what your OpenCode session shows on Discord",
          keywords: "discord rich presence status private elapsed opencode",
        },
      ],
      render: () => <DiscordPresenceSettings state={state} ctx={ctx} />,
    })

    ctx.add(Command, {
      id: "open-settings",
      title: "OpenCode Discord presence settings",
      description: "Control the Discord Rich Presence shown for OpenCode",
      group: "View",
      run: () => ctx.layout.settings("opencode-discord-status"),
    })
  },
  main,
})
