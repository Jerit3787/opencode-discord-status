# One command for your agent

Copy this, replace `<YOUR_APPLICATION_ID>` with the Discord Application ID from
<https://discord.com/developers/applications>, and run it:

```sh
opencode run "Set up Discord Rich Presence for OpenCode from https://github.com/Jerit3787/opencode-discord-status using Discord Application ID <YOUR_APPLICATION_ID>. Read SETUP.md and .opencode/skills/setup-opencode-discord-status/SKILL.md first. Clone it to ~/.config/opencode/plugins/opencode-discord-status and install it for this machine. If this workspace is on a remote SSH host, configure discord:false and stateFile here, then give me the exact npm run bridge command to run on the machine with Discord. Preserve existing config entries and verify with 'opencode plugin list' and 'npm run doctor' before saying it is done."
```

No Application ID yet? Drop the `using Discord Application ID ...` part and the
agent will walk you through creating one.

## If you prefer to paste a prompt

The same text works in any coding agent:

> Set up Discord Rich Presence for OpenCode from
> https://github.com/Jerit3787/opencode-discord-status using Discord Application
> ID `<YOUR_APPLICATION_ID>`. Read `SETUP.md` and
> `.opencode/skills/setup-opencode-discord-status/SKILL.md` first. Clone it to
> `~/.config/opencode/plugins/opencode-discord-status` and install it for this
> machine. If this workspace is on a remote SSH host, configure `discord:false`
> and `stateFile` here, then give me the exact `npm run bridge` command to run on
> the machine with Discord. Preserve existing config entries and verify with
> `opencode plugin list` and `npm run doctor` before saying it is done.
