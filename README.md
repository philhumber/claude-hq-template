# Claude HQ: a virtual company of Claude agents, run from Slack

An always-on **Chief of Staff** session in Claude Code that you talk to from Slack. It runs a set of
department agents (IT, Support, Marketing, Research, Finance, Engineering), brings you only what
needs a decision, and acts on your ✅ within seconds. Everything it knows lives in plain Markdown
files you can read and edit.

```
 You (Slack, phone or desktop)
   #ceo  #approvals  #cos-briefing  #todo  #agent-log  #<department>…
        │  Socket Mode (outbound only, no public URL)
        ▼
 slack-hq bridge ── forwards ONLY your user ID, ONLY allowlisted channels
        ▼
 HQ session = Chief of Staff (Claude Code, always on, restarted nightly)
        ├── hq-it  hq-support  hq-marketing  hq-research  hq-finance  hq-eng   (subagents)
        ▼
 company/  strategy · autonomy · approvals · todos · departments/<dept>/{brief,state,log}
```

## How you use it

- **Direct it** in `#ceo`. For example, "focus marketing on the spring launch", or "Support may send password-reset replies without asking". The CoS updates `strategy.md` or `autonomy.md` and confirms.
- **Approve** where the item appears. Every outgoing action is posted with an ID (`MKT-3`, `SUP-7`) and an @mention, either in the thread you asked in or in its department channel. React ✅ to do it as written, react ❌ to drop it, or reply in the thread to revise it. Each decision is logged as one line in `#approvals`, which also carries Claude Code's 🔒 permission prompts. Nothing is sent, posted or filed without this, unless `autonomy.md` allows it.
- **Your to-dos** are posts in `#todo` with a due date. React ✅ when one is done. The morning brief lists the ones you're behind on, and you can say "move SUP-7 to Friday".
- **Morning brief** in `#cos-briefing`: what happened, what needs you, what's on fire, today's focus. A **weekly review** follows on Friday.
- **If it goes quiet**, the watchdog restarts it. You can also post `!restart hq` in `#ceo`.

## Safety rails (built in, not optional)

- **One human.** Only your Slack user ID can instruct or approve. Messages from anyone else, and from the bot itself, are dropped before Claude sees them.
- **Approve-before-act.** Email sends, posts, tickets and calendar changes need your ✅ on an approval item, or a rule you wrote in `autonomy.md`. Claude Code's own permission prompts are relayed to Slack too.
- **Content is data.** Instructions inside emails, web pages, tickets or PRs are reported to you, never followed.
- **No money moves.** There are no payments, purchases, trades or billing changes, ever. Finance only reports.
- **Secrets stay out.** Tokens live in `bridge\.env`, which is git-ignored, and Claude is denied read access to it. Never paste tokens into a chat.
- **No production access** by default.

## Requirements

- Windows 10/11 (the launcher, watchdog and installer are PowerShell). The bridge itself is plain Node and runs anywhere.
- Claude Code, signed in, plus the Claude desktop app if you want keep-awake.
- Node.js 22+.
- A **private Slack workspace with you as its only member**. The free plan is fine.
- The PC needs to be on and logged in for HQ to run.

> **Who this is for.** It's built for **one person** using their own Claude subscription for their own
> work. Customers and staff never talk to the bot: it works on their emails, and you approve the
> replies. If other people need to use it directly, move to an API key or a team plan.
> Claude Code **channels** are a research preview loaded with a development flag, so they may change.

## Set up

```powershell
git clone <this repo> $HOME\claude-hq
```
```powershell
powershell -ExecutionPolicy Bypass -File $HOME\claude-hq\install.ps1 -WorkDir $HOME\HQ -DryRun
```
```powershell
powershell -ExecutionPolicy Bypass -File $HOME\claude-hq\install.ps1 -WorkDir $HOME\HQ
```

1. **Run the installer** (above). It installs and tests the bridge, copies the agents into `~\.claude\agents`, and puts the company templates and permissions in your HQ folder. It also registers the `slack-hq` MCP server and creates the three scheduled tasks. It is safe to re-run, and it never overwrites your company files.
2. **Create the Slack workspace and app**, then fill in `bridge\.env`. See [bridge/README.md](bridge/README.md) sections 1–2.
3. **Make it yours.** Fill in `company\strategy.md` (what you sell, to whom, this quarter's goals, voice, no-go areas), `autonomy.md` (what may happen without asking: start with nothing), and each department's `brief.md`. Look for `FILL IN`. Delete departments you don't need, and remove their channels.
4. **Connect connectors** in claude.ai for the tools your departments use (Gmail, Calendar, Slack, Jira, …). Then adjust `HQ\.claude\settings.json` if you use others.
5. **Start it** with `Start-ScheduledTask 'Claude HQ - start at logon'`. Check `#agent-log` for **HQ online**, then run the live test in [bridge/README.md](bridge/README.md).

Start strict. After a few weeks of reliable drafts, loosen `autonomy.md` one rule at a time.

## What's in the repo

| Path | What |
|---|---|
| `bridge/` | slack-hq channel server (Node), launcher, nightly restart, watchdog, startup prompt |
| `agents/` | Subagent definitions: `hq-cos`, `hq-it`, `hq-support`, `hq-marketing`, `hq-research`, `hq-finance`, `hq-eng` |
| `company/` | Templates for strategy, autonomy, approvals, to-dos, Slack conventions and department files |
| `config/project-settings.json` | Permissions for the HQ folder: allow reads and drafts, ask before sends, deny secrets |
| `install.ps1` | The installer |

## Licence

MIT. See [LICENSE](LICENSE).
