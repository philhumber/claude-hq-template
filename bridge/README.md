# slack-hq: the Slack bridge for an always-on Claude Code HQ

`slack-hq` is a [Claude Code channel](https://code.claude.com/docs/en/channels-reference.md) server. It is a small MCP server that Claude Code starts over stdio. It connects to your private Slack workspace in **Socket Mode**: an outbound websocket only, so there is no public URL, no webhook and no open port.

- **Inbound.** It pushes `message` and `reaction_added` events into the running HQ session, but **only** when the sender is `SLACK_ALLOWED_USER` (you) **and** the channel is in `SLACK_ALLOWED_CHANNELS`. Everything else is dropped. For dropped events, only the IDs and the reason are logged to `logs/slack-hq.log`, never the text. Bot messages, edits, deletes and joins are dropped too.
- **Outbound.** It gives the session these tools, which work only in the allowlisted channels:
  - `reply(channel, thread_ts, text)` answers in a thread.
  - `post(channel, text)` starts a new message and returns its `ts`.
  - `react(channel, ts, emoji)` adds a reaction.
  - `list_channels()` returns the channel names and IDs, the workspace, the bot ID and your user ID (read-only).
  - `todo(title, details, due?, source_channel?, source_thread_ts?)` posts a to-do for you in `#todo` with a 📅 due line.
  - `todo_due(ts, due)` moves a to-do's due date and notes the change in its thread.

Claude sees each event like this:

```text
<channel source="slack-hq" event="message" channel="ceo" channel_id="C…" user="U…" ts="1731…" thread_ts="1731…" in_thread="false">
focus marketing on the spring launch
</channel>
```

## Permission relay: approve HQ's permission prompts from Slack

The HQ folder's `.claude/settings.json` has **ask** rules (email send, calendar writes, `ssh`, `git push`, …). Each one opens a permission dialog in the HQ terminal. With `SLACK_PERMISSION_RELAY=true`, slack-hq also posts the dialog to `#approvals`. These 🔒 prompts are separate from business approvals, which are covered in `company/approvals.md`:

```text
🔒 Permission request `abcde`: Claude wants to run mcp__…__send_message
React ✅ to allow or ❌ to deny (this one call only), or reply `yes abcde` / `no abcde`.
```

- A verdict covers **that one call only**. The terminal dialog stays open too, and whichever answer arrives first is the one used.
- **Only you can answer.** The sender gate runs first, so the bot can't approve its own prompts. The `react` tool also refuses to touch an open prompt, and `reply`/`post` refuse any text that looks like a verdict.
- Reactions on prompt messages are never passed on to Claude as ordinary reactions, so a ✅ on a prompt can't be mistaken for a business approval.
- Request text is escaped (no `@channel` pings, no disguised links) and truncated before it is posted.
- Prompts expire after 6 hours, and the bridge forgets them when it restarts.
- **Limits:**
  - It needs a recent Claude Code.
  - It covers tool-use approvals only. Project-trust and MCP-consent dialogs are not relayed.
  - HQ must **not** run in auto mode, because auto mode skips the dialogs. `start-hq.ps1` uses `--permission-mode manual`.
- Anyone who gets into your Slack account could approve tool use. **Keep 2FA on.** Set `SLACK_PERMISSION_RELAY=false` to turn the relay off.

## Files

| File | What it is |
|---|---|
| `src/server.js` | The channel server: Bolt Socket Mode and the tools |
| `src/filter.js`, `format.js`, `permission.js`, `due.js` | Allowlist, event formatting, permission relay and due dates (pure, unit-tested) |
| `src/log.js` | File logging (stdout is the MCP transport) |
| `start-hq.ps1` | Launches HQ in a persistent window and relaunches it if it exits |
| `confirm-dev-channels.ps1` | Answers the development-channels warning for unattended starts (`-AutoConfirm`) |
| `restart-hq.ps1` | Nightly restart: closes the HQ window and opens a fresh one |
| `watchdog-hq.ps1` | Restarts a silent HQ, and handles `!restart hq` |
| `startup-prompt.txt` | HQ's first prompt: read the company files, start the loops |
| `hq-settings.json` | Turns Remote Control off for HQ only |
| `env.example` | Template for `.env` (your tokens; git-ignored) |

**Why only HQ connects to Slack:**
- Claude Code finds `server:slack-hq` only in its normal MCP config, so slack-hq is registered in the HQ folder's **local** MCP scope.
- That means every Claude session opened in that folder starts its own copy.
- Slack spreads Socket Mode events across every open connection, so two live copies would split your messages between them.
- To prevent that, a copy connects **only** when `SLACK_HQ_ROLE=hq` is set, and only `start-hq.ps1` sets it. Other copies stay dormant.
- A lock file (`logs/slack-hq.lock`) blocks a second HQ copy as well.

---

## 1. Create the Slack workspace and app (about 15 minutes)

1. **Create a private workspace** just for HQ, with you as the only member, and create these channels:
   `#ceo #approvals #cos-briefing #agent-log #todo #it #support #marketing #research #finance #engineering`
   (`#todo` because Slack reserves `todos`). Drop the department channels you don't use, and keep `SLACK_ALLOWED_CHANNELS` in step with them.
2. Go to <https://api.slack.com/apps> and choose **Create New App → From scratch**. Name it (for example `HQ`) and pick the workspace.
3. **Turn on Socket Mode.** Open **Settings → Socket Mode** and switch on **Enable Socket Mode**. When it asks for an app-level token, name it `socket` and give it the scope `connections:write`. Copy the `xapp-…` token: this is `SLACK_APP_TOKEN`.
4. **Add the bot token scopes** under **OAuth & Permissions → Bot Token Scopes**: `chat:write`, `channels:history`, `groups:history`, `channels:read`, `groups:read`, `reactions:read`, `reactions:write`. No user token scopes are needed.
5. **Subscribe to events.** Open **Event Subscriptions → Enable Events**. No Request URL is needed. Add the bot events `message.channels`, `message.groups` and `reaction_added`, then save.
6. **Install the app** to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`): this is `SLACK_BOT_TOKEN`. If you add a scope later, reinstall the app.
7. **Invite the bot to every channel.** In each one, run `/invite @HQ`.
8. **Find your member ID** (it starts with `U`): click your avatar, then **Profile → ⋮ → Copy member ID**. This is `SLACK_ALLOWED_USER`.
9. **Find the IDs of `#agent-log` and `#ceo`** (they start with `C`): open the channel, then **View channel details**, and the ID is at the bottom. These are `HQ_LOG_CHANNEL_ID` and `HQ_CEO_CHANNEL_ID`, and the watchdog uses them.

## 2. Fill in `.env`

`install.ps1` creates `bridge\.env` from `env.example`. Open it in Notepad and fill in the values from step 1. **Never paste the tokens into a chat, including with Claude.** The project settings deny Claude read access to `.env` files.

If a channel name can't be resolved, `logs/slack-hq.log` warns about it at startup. The usual cause is a channel the bot hasn't been invited to.

## 3. Start HQ

```powershell
Start-ScheduledTask 'Claude HQ - start at logon'
```

Or run `start-hq.ps1` directly. It starts `claude` in your HQ folder with `--dangerously-load-development-channels server:slack-hq`. Custom channels aren't on Anthropic's approved list, so each launch shows a **WARNING: Loading development channels** screen. Choose **1. I am using this for local development**. With `-AutoConfirm`, a hidden helper presses Enter for you once the screen appears.

When the channel is live, the session shows `Channels (experimental) messages from server:slack-hq inject directly in this session`. HQ then posts **HQ online** in `#agent-log`.

## 4. Watchdog and recovery

`watchdog-hq.ps1` runs every 15 minutes from Task Scheduler. It reads `#agent-log` with the bot token and looks for HQ's own `HQ alive` / `HQ online` heartbeat lines.

- **Silent** means no heartbeat for 100 minutes by day (07:00–23:00) or 75 minutes at night, or no `HQ online` by 04:20 after the nightly restart. The watchdog then restarts HQ and posts a 🔴 line.
- **At most 2 restarts in 6 hours**, with 20 minutes' grace after each one. After the second, it alerts you once and stops.
- **`!restart hq`** posted by you in `#ceo` restarts HQ at the next check, past the limit. The watchdog reads it, not the bridge, so it works even when HQ is dead.
- HQ runs with **Remote Control off** (`hq-settings.json`), so restarts don't fill your Claude app with dead sessions. Your ways back in are `!restart hq`, or remote desktop as a last resort.
- `-DryRun` checks and logs, but restarts and posts nothing.

## Live test checklist

1. In `#ceo`, post `ping – reply in thread with "pong"`. The reply should land in that thread within seconds.
2. React ✅ to a message in `#approvals`. HQ should receive a `reaction` event.
3. Post from a second Slack account. Nothing should reach HQ, and the log shows `sender-not-allowed`.
4. Ask HQ to do something that hits an `ask` rule. A 🔒 prompt appears in `#approvals`. Check that ❌ denies it and ✅ allows it.
5. Run `Start-ScheduledTask 'Claude HQ - nightly restart'`. A new window should open, and ping/pong should still work.

## Troubleshooting

- **No events:** run `/mcp` in the HQ session, then check `logs/slack-hq.log` for `connected to Slack (Socket Mode)`.
- **`server:slack-hq · no MCP server configured with that name`:** slack-hq isn't registered for the HQ folder. Re-run `install.ps1`.
- **Log says `dormant` in HQ:** HQ was started with a bare `claude`. Use `start-hq.ps1`.
- **Debug:** set `SLACK_HQ_DEBUG=1` in `.env`.
