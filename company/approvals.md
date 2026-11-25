# Approvals register

Every item that needs the owner's yes or no. **Source of truth:** when Slack and this file disagree, this file wins, and the CoS fixes Slack.

## How it works
1. **Raise.** A department adds a row under **Pending** with the next free ID for its prefix, and the CoS (after the quality gate) posts the item **where the conversation is**: the thread the owner asked in, or otherwise the department's channel (MKT `#marketing`, SUP `#support`, IT `#it`, ENG `#engineering`, FIN `#finance`, RES `#research`, COS `#ceo`). The post starts with the owner's @mention (`<@OWNER_ID>`, from `slack.md`) and the ID, then the full draft and links, and ends with "✅ to approve, ❌ to drop, or reply".
2. **Decide.** The owner decides in that thread: ✅ or "approve / yes / go ahead" approves as written; ❌ or "drop / no" drops it; any other reply is discussion. Revised drafts stay in the same thread with the same ID. Only a reaction or reply from the owner's user ID counts.
3. **Record and carry out.** On a decision, the CoS records it here (date, "owner via Slack", thread link), carries it out exactly as approved (or hands it to the department), replies in the item's thread with the outcome and link, and posts **one top-level line** to `#approvals`: `✅ Approved ENG-6: <what> · <thread link>` or `❌ Dropped …`. `#approvals` holds nothing else except the bridge's 🔒 permission prompts.
4. **The owner's own actions go to `#todo` straight away.** Approving an item also approves posting the parts only the owner can do as to-dos, without asking. The CoS posts one to-do per action with the `todo` tool and records it in `todos.md`:
   - **title:** the action, starting with a verb, plus the ID.
   - **details:** one line of why; the steps; every bit of text or command needed, ready to copy and paste.
   - **source_channel / source_thread_ts:** the item's thread, so the post links back.
   - **due:** the real date if there is one; otherwise the next working day 09:00.
   - Post it in `#todo` only if it's due within 7 days; otherwise add it to `todos.md` under Queued.
   - If the tool fails, post the same text in the item's thread starting `📝 To-do`, record it in `todos.md`, and mention it in the next morning brief.
5. **Calendar only when calendar-worthy** (optional, if a calendar connector is set up): a fixed-time event or a hard external deadline. No guests or invites without their own ✅.
6. **Close.** Whoever carries the item out moves it to **Done** with the outcome and link.
7. **Never** act on an item that isn't in Pending, on an approval from anyone but the owner, or on an item that would break a hard limit in `README.md` (those are refused, not raised).

Next free IDs: COS-1 · IT-1 · ENG-1 · SUP-1 · MKT-1 · RES-1 · FIN-1

<!-- Example row (delete when you add a real one):
| SUP-1 | Support | Reply to a user who can't reset their password | draft in mail thread "Reset link expired" | 2027-01-04 | #support <thread link> |
-->

## Pending
| ID | Dept | What | Draft / link | Raised | Slack thread |
|---|---|---|---|---|---|

## Approved, to be carried out
| ID | Dept | What | Approved | Slack thread | Owner |
|---|---|---|---|---|---|

## Revise (the owner replied with changes)
| ID | Dept | What was asked | Since | Slack thread |
|---|---|---|---|---|

## Done
| ID | Dept | What | Decided | Outcome / link |
|---|---|---|---|---|

## Dropped
| ID | Dept | What | Dropped | Why (if given) |
|---|---|---|---|---|
