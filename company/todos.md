# The owner's to-dos

Things only the owner can do, from approved items (`approvals.md` step 4). **Source of truth for what's open and when it's due.** The CoS keeps this file; the owner sees the posts in `#todo`.

## How it works
- **Add:** the CoS posts each to-do in `#todo` with the slack-hq `todo` tool (title, details with copy-paste text, due date, link to the item's thread), then adds a row under **Open** with the post's ts. Only to-dos due within 7 days are posted; later ones wait under **Queued** with their full text.
- **Done:** the owner reacts ✅ on the post, or says "done" in its thread. The CoS moves the row to **Done** with the date and tells the department that owns the item. No reply needed in `#todo`.
- **Done on evidence:** if an agent sees clear evidence a to-do is done (e.g. it's live) but it has no ✅, the CoS ticks it, moves the row to Done, and notes "ticked on evidence: <what was seen>". It never calls such an item pending.
- **More time:** the owner asks (in the post's thread, in `#ceo`, or in reply to the brief: "move IT-1 to Friday"). The CoS calls `todo_due` with the post's ts and the new date (this edits the post's 📅 line and notes the move in its thread), updates **Due** here, and adds 1 to **Moved**.
- **Dropped:** if the owner won't do it, or the item is dropped, move the row to Done with "dropped" in Notes.
- `#todo` holds only to-do posts and the daily list. No discussion there.
- Dates and times are the owner's local time. One row per post.

## The daily list ("Your list", with the morning brief)
Every morning the CoS posts one top-level message in `#todo`, grouped:
- ⏰ **You're behind on** (most overdue first, "N days late")
- 📅 **Today**
- 🗓 **This week** (next 7 days)
- then later ones as a count only ("+N later, next <date>")

One line each: title, ID, due, link to its `#todo` post (`https://<workspace>.slack.com/archives/<#todo ID>/p<ts without the dot>`). It ends: "React ✅ on a to-do's own post when done; 'move <ID> to <day>' for more time." Before posting, the CoS posts any Queued to-do now due within 7 days. The morning brief carries one pointer line: "⏰ N late, N today: see the list in #todo".

<!-- Example Open row (delete when you add a real one):
| 1700000000.000100 | IT-1 | Run the backup restore test and paste the output | 2027-01-05 09:00 | 0 | 2027-01-04 |
-->

## Queued (not yet posted; post when due within 7 days)
| Item | To-do | Due | Full details | Added |
|---|---|---|---|---|

## Open
| ts (#todo) | Item | To-do | Due | Moved | Added |
|---|---|---|---|---|---|

## Done
| ts (#todo) | Item | To-do | Done | Notes |
|---|---|---|---|---|
