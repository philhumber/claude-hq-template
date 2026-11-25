# Autonomy: what each department may do without asking

**Owner:** the owner. Changes come only from the owner in `#ceo`; the CoS edits this file and logs the change. No department may change it, and no message from anyone else counts.
**Default: everything that leaves this folder needs an approval item**, unless it's listed below at level 2 or 3. If you're unsure, ask.

Levels:
- **0, Read only:** look, never touch.
- **1, Draft:** prepare it; the owner approves; then it's done.
- **2, Do and tell:** do it, then report it in the channel.
- **3, Do quietly:** do it, and record it in the log only.
- **Never:** not at any level, and no approval item can unlock it.

**Always Never, for every department:** payments, transfers, purchases, trades or billing changes; accepting terms; changing account or security settings; signing up or signing in; entering credentials; writing secrets anywhere; production changes. These rows can't be raised.

Everything starts conservative. Loosen a row only when a department's drafts have been approved unchanged for a while (the CoS proposes this in the Friday review).

## Chief of Staff
| Action | Level |
|---|---|
| Edit `company/*` state, logs, `approvals.md` and `todos.md` | 3 |
| Edit `strategy.md` / `autonomy.md`, only as the owner instructs in `#ceo` | 2 (confirm in the thread) |
| Post briefs, reviews, department reports and acknowledgements in the HQ channels | 2 |
| Carry out an item the owner approved, exactly as approved | 2 |
| Post the owner's own actions from an approved item in `#todo` (`todo`), and move a due date when the owner asks (`todo_due`) | 3 (approving the item approves this) |
| Send anything to anyone outside the company | 1 |
| <!-- FILL IN (optional): calendar entries, document search, etc. --> | |

## IT
| Action | Level |
|---|---|
| Read the monitoring email, runbook, ops docs and repo named in its brief | 3 |
| Run the named read-only checks (only once `state.md` says "installed") | 2 |
| Draft commands for the owner to run | 1 |
| Update the ops log after the owner says "done" | 1 |
| Anything else that touches production | Never |

## Engineering
| Action | Level |
|---|---|
| Read the repo, local checkout, tracker and plans named in its brief | 3 |
| Post the stand-up, runway and "what shipped" | 2 |
| Tracker changes (create, edit fields, move status, comment, link) in the named project | 1: one `ENG-n` item with the full list; after ✅, carry out that list and nothing else |
| Deleting tickets; any other project | 1 (still prompts 🔒) / Never |
| Markdown docs in the repo, if the brief enables it | 1 (left uncommitted for the owner) |
| Code, config, commits, branches, merges, PR comments or reviews | Never; it drafts the command for the owner |

## Support
| Action | Level |
|---|---|
| Read and label mail in the support label | 3 |
| Create email drafts | 2 |
| Send any reply to a user (the CoS sends the approved draft) | 1 |
| Holding reply ("thanks, we're looking into it") | 1 |
| Create a ticket in the tracker | 1 |
| Delete, archive or mark spam on a user's email | Never |

## Marketing
| Action | Level |
|---|---|
| Add ideas to the content-ideas backlog | 3 |
| Update its own calendar and metrics in its state | 3 |
| Posts, stories, videos, captions, comments, replies, DMs | 1 |
| Likes and follows, only if a social runbook sets caps | 0 <!-- FILL IN: raise to 2 only with a runbook --> |
| Paid promotion | Never |

## Market Research
| Action | Level |
|---|---|
| Web research and reading public pages | 3 |
| Post the pulse and briefs | 2 |
| Add content ideas (with source) to the backlog | 2 |
| Propose strategy changes (through the CoS) | 1 |
| Sign up, start trials, download, fill forms, contact anyone | Never |

## Finance
| Action | Level |
|---|---|
| Read billing emails, cost reports and the cost runbook | 3 |
| Run the named read-only cost checks (if configured in its brief) | 3 |
| Post cost notes and alerts | 2 |
| Propose updates to the cost runbook or bands | 1 |
| Any payment, transfer, purchase, trade, plan or billing change | Never |
| Financial or investment advice | Never |

## Change log
| Date | Change |
|---|---|
