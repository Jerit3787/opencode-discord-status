# One command for your agent

Copy this, replace `<YOUR_APPLICATION_ID>` with the Discord Application ID from
<https://discord.com/developers/applications>, and run it:

```sh
opencode run "Set up Discord Rich Presence for OpenCode from https://github.com/Jerit3787/opencode-discord-status using Discord Application ID <YOUR_APPLICATION_ID>. Use the database watcher, not the plugin. Read SETUP.md first. Clone it to ~/.config/opencode/plugins/opencode-discord-status and run 'npm run watch -- --client-id <YOUR_APPLICATION_ID>' on the machine where Discord runs. If this workspace is on a remote SSH host, give me the exact command to run on my laptop with --ssh. Verify the card appears before saying it is done."
```

No Application ID yet? Drop the `using Discord Application ID ...` part and the
agent will walk you through creating one.

## If you prefer to paste a prompt

The same text works in any coding agent:

> Set up Discord Rich Presence for OpenCode from
> https://github.com/Jerit3787/opencode-discord-status using Discord Application
> ID `<YOUR_APPLICATION_ID>`. Use the database watcher, not the plugin. Read
> `SETUP.md` first. Clone it to
> `~/.config/opencode/plugins/opencode-discord-status` and run
> `npm run watch -- --client-id <YOUR_APPLICATION_ID>` on the machine where
> Discord runs. If this workspace is on a remote SSH host, give me the exact
> command to run on my laptop with `--ssh`. Verify the card appears before
> saying it is done.
