# Owner's setup checklist

Everything here needs you, because it involves accounts, sign-ins or tokens, which agents never handle. Tick items off as you go, and tell the CoS when a block is done.

## A. Slack
- [ ] **Create a workspace** (the free plan is fine) where you are the only human.
- [ ] **Create the channels** listed in `slack.md`: `#ceo` `#cos-briefing` `#approvals` `#todo` `#it` `#engineering` `#support` `#marketing` `#research` `#finance` `#agent-log`.
- [ ] **Create the Slack app** for the `slack-hq` bridge, install it and invite it to every channel. Follow `bridge/README.md`.
- [ ] **Put the tokens and your Slack user ID in the bridge's `.env`**, never in chat or in `company/`.
- [ ] **Fill in `slack.md`:** workspace, your user ID, the bot's user ID. Once the bridge runs, ask the CoS to fill the channel IDs with `list_channels`.
- [ ] **Notifications on your phone:** all messages for `#ceo`, `#cos-briefing` and `#todo`; mentions only for the department channels (items @mention you); all for `#approvals` if you want the 🔒 prompts; mute `#agent-log`.

## B. Agents
- [ ] **Copy `agents/hq-*.md` to `~/.claude/agents/`.**
- [ ] **Connect only what you need** in Claude (for example Gmail for Support, IT and Finance; GitHub and Jira or Linear for Engineering). Leave out anything a department doesn't use.
- [ ] **Permissions:** keep send, publish, delete and payment tools on "ask" or "deny". Don't allow-list anything you wouldn't want an agent to do unsupervised.

## C. Email (optional)
If departments read email, give each its own label and nothing more:
- [ ] Support's label (e.g. `Company/Support`), IT's (e.g. `Company/Ops`), Finance's (e.g. `Company/Billing`).
- [ ] Write each label's name in that department's `brief.md`.
- [ ] Keep your personal mail under a label no agent reads, and say so in the briefs.

## D. The machine HQ runs on
- [ ] Don't sleep while plugged in (at least during working hours), and keep the Claude app's "keep awake" setting on if you use it.
- [ ] Set up the start-at-logon task, the nightly restart and the watchdog from `bridge/README.md`.

## E. Production checks (optional, later)
Only if you want IT to run read-only checks itself:
- [ ] A separate read-only account and a wrapper with a fixed menu of checks (no shell, no writes).
- [ ] An allow rule that matches only that wrapper's exact command prefix.
- [ ] Test that it refuses anything off the menu, then document the command and menu in `departments/it/state.md` and mark it "installed".

## F. Your first week
- [ ] **Fill in `strategy.md`** (what you sell, who for, goals, priorities, voice, no-go areas) and each department's `brief.md` (the `FILL IN` prompts).
- [ ] **Read `autonomy.md`.** Everything starts at "draft only". Loosen rows only once you trust the drafts.
- [ ] **Each morning:** read `#cos-briefing` and the list in `#todo`, then answer the items that @mention you. Aim for under 10 minutes.
- [ ] **Friday:** read the weekly review and decide on any proposed autonomy changes.
