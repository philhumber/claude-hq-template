// Pure formatting of Slack events into channel notifications:
//   { content: string, meta: Record<string, string> }
// Claude sees these as <channel source="slack-hq" event="message" channel="ceo" ...>content</channel>.
//
// Meta keys must be identifiers (letters, digits, underscore). Claude Code silently
// drops any other key, so cleanMeta() enforces this and stringifies every value.

const META_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const EXCERPT_LIMIT = 500

export function cleanMeta(meta) {
  const out = {}
  for (const [key, value] of Object.entries(meta)) {
    if (!META_KEY_RE.test(key)) throw new Error(`invalid meta key: ${key}`)
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

/** Slack escapes &, < and > in message text. Undo that, leaving <@U..>/<#C..> links as they are. */
export function decodeSlackText(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function excerpt(text, limit = EXCERPT_LIMIT) {
  const t = decodeSlackText(text).trim()
  return t.length > limit ? `${t.slice(0, limit)}…` : t
}

/**
 * @param {object} event Slack `message` event (already passed checkMessage)
 * @param {string} channelName e.g. "ceo" (may be undefined if it could not be resolved)
 */
export function formatMessage(event, channelName) {
  let content = decodeSlackText(event.text).trim()
  const files = Array.isArray(event.files) ? event.files : []
  if (files.length) {
    const names = files.map(f => f.name || f.title || f.id).join(', ')
    content += `${content ? '\n' : ''}[attachments: ${names}]`
  }
  const inThread = Boolean(event.thread_ts && event.thread_ts !== event.ts)
  return {
    content,
    meta: cleanMeta({
      event: 'message',
      channel: channelName,
      channel_id: event.channel,
      user: event.user,
      ts: event.ts,
      // Where a reply should go: the existing thread, or a new thread under this message.
      thread_ts: event.thread_ts || event.ts,
      in_thread: inThread ? 'true' : 'false',
    }),
  }
}

/**
 * @param {object} event Slack `reaction_added` event (already passed checkReaction)
 * @param {string} channelName
 * @param {{ text?: string, thread_ts?: string, user?: string } | null} target
 *        The message that was reacted to, if the server could fetch it.
 */
export function formatReaction(event, channelName, target = null) {
  const ts = event.item.ts
  const lines = [`Reaction :${event.reaction}: added to message ${ts}.`]
  if (target?.text) lines.push(`Message: "${excerpt(target.text)}"`)
  else lines.push('(The reacted message could not be fetched.)')
  return {
    content: lines.join('\n'),
    meta: cleanMeta({
      event: 'reaction',
      channel: channelName,
      channel_id: event.item.channel,
      user: event.user,
      reaction: event.reaction,
      ts,
      thread_ts: target?.thread_ts || ts,
      message_user: target?.user || event.item_user,
    }),
  }
}
