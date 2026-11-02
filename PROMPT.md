# One command for your agent

Copy this, replace `<YOUR_APPLICATION_ID>` with the Discord Application ID from
<https://discord.com/developers/applications>, and run it:

```sh
opencode run "Set up Discord Rich Presence for OpenCode from https://github.com/Jerit3787/opencode-discord-status using Discord Application ID <YOUR_APPLICATION_ID>. Read SETUP.md first. Clone it to ~/opencode-discord-status, build with 'go build -trimpath -o bin/opencode-discord-status .', then run './bin/opencode-discord-status --client-id <YOUR_APPLICATION_ID>' on the machine where Discord runs. Verify with '-once' and '--doctor'. On macOS, add --exit-when-closed and a launchd StartInterval job so it only runs while OpenCode is open."
```

No Application ID yet? Drop the `using Discord Application ID ...` part and the
agent will walk you through creating one.

## If you prefer to paste a prompt

The same text works in any coding agent:

> Set up Discord Rich Presence for OpenCode from
> https://github.com/Jerit3787/opencode-discord-status using Discord Application
> ID `<YOUR_APPLICATION_ID>`. Read `SETUP.md` first. Clone it to
> `~/opencode-discord-status`, build with
> `go build -trimpath -o bin/opencode-discord-status .`, then run
> `./bin/opencode-discord-status --client-id <YOUR_APPLICATION_ID>` on the
> machine where Discord runs. Verify with `-once` and `--doctor`. On macOS, add
> `--exit-when-closed` and a launchd `StartInterval` job so it only runs while
> OpenCode is open.
