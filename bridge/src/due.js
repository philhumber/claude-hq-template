// Due dates for the slack-hq `todo` / `todo_due` tools (the owner's to-do posts in #todo).

/** "YYYY-MM-DD HH:MM" | "YYYY-MM-DD" (local time; date-only = 09:00) | empty (tomorrow 09:00) -> unix seconds, never in the past. */
export function parseDue(due, now = new Date()) {
  let d
  if (due === undefined || due === null || String(due).trim() === '') {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
  } else {
    const m = String(due).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/)
    if (!m) throw new Error('due must be "YYYY-MM-DD HH:MM" or "YYYY-MM-DD"')
    const [, y, mo, da, h = '09', mi = '00'] = m
    d = new Date(+y, +mo - 1, +da, +h, +mi)
    if (isNaN(d) || d.getMonth() !== +mo - 1) throw new Error('due is not a valid date')
  }
  const minTime = now.getTime() + 60_000
  return Math.floor(Math.max(d.getTime(), minTime) / 1000)
}

/** unix seconds -> "Wed 11 Nov, 10:00" (local time). */
export function formatDue(time) {
  const d = new Date(time * 1000)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '')
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${day}, ${hm}`
}

/** The due line in a to-do post; DUE_LINE_RE finds it again for todo_due. */
export function dueLine(time) {
  return `📅 Due ${formatDue(time)}`
}
// Slack stores the emoji as the shortcode ":date:", so match both forms.
export const DUE_LINE_RE = /^(?:📅|:date:) Due .*$/m
