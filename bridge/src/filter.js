// Pure allowlist logic for slack-hq. No Slack or MCP imports, so it is unit-testable.
//
// The rule (from the channels reference): gate on the SENDER, not the room.
// An event is forwarded only when the sender is the owner's user ID AND the channel
// is on the allowlist. Everything else is dropped with a reason for the local log.

const CHANNEL_ID_RE = /^[CG][A-Z0-9]{6,}$/

// Message subtypes that are still a human typing in a channel.
// Everything else (message_changed, message_deleted, channel_join, bot_message, ...) is dropped.
const FORWARDED_SUBTYPES = new Set([undefined, 'thread_broadcast', 'file_share'])

/** "ceo, #approvals,C0123ABCD" -> ['ceo', 'approvals', 'C0123ABCD'] */
export function parseList(value) {
  if (!value) return []
  return String(value)
    .split(/[\s,]+/)
    .map(s => s.trim().replace(/^#/, ''))
    .filter(Boolean)
}

export function isChannelId(s) {
  return CHANNEL_ID_RE.test(s)
}

/**
 * Turn allowlist entries (names or IDs) into a Set of channel IDs, using the
 * workspace's channel list ([{ id, name }]). Names are matched case-insensitively.
 * Returns { ids, unresolved } so the server can log names it could not find
 * (usually: a private channel the bot has not been invited to).
 */
export function resolveAllowlist(entries, channels) {
  const byName = new Map(channels.map(c => [String(c.name).toLowerCase(), c.id]))
  const ids = new Set()
  const unresolved = []
  for (const entry of entries) {
    if (isChannelId(entry)) {
      ids.add(entry)
      continue
    }
    const id = byName.get(entry.toLowerCase())
    if (id) ids.add(id)
    else unresolved.push(entry)
  }
  return { ids, unresolved }
}

/**
 * @param {object} event Slack `message` event
 * @param {{ allowedUser: string, allowedChannelIds: Set<string> }} policy
 * @returns {{ forward: true } | { forward: false, reason: string }}
 */
export function checkMessage(event, policy) {
  if (!event || typeof event !== 'object') return drop('malformed')
  if (!FORWARDED_SUBTYPES.has(event.subtype)) return drop(`subtype:${event.subtype}`)
  if (event.bot_id || event.bot_profile) return drop('bot')
  if (event.hidden) return drop('hidden')
  const userCheck = checkUser(event.user, policy)
  if (userCheck) return userCheck
  const channelCheck = checkChannel(event.channel, policy)
  if (channelCheck) return channelCheck
  const hasText = typeof event.text === 'string' && event.text.trim() !== ''
  const hasFiles = Array.isArray(event.files) && event.files.length > 0
  if (!hasText && !hasFiles) return drop('empty')
  return { forward: true }
}

/**
 * @param {object} event Slack `reaction_added` event
 */
export function checkReaction(event, policy) {
  if (!event || typeof event !== 'object') return drop('malformed')
  if (!event.item || event.item.type !== 'message') return drop(`item:${event.item?.type}`)
  if (!event.reaction) return drop('no-reaction')
  const userCheck = checkUser(event.user, policy)
  if (userCheck) return userCheck
  const channelCheck = checkChannel(event.item.channel, policy)
  if (channelCheck) return channelCheck
  return { forward: true }
}

function checkUser(user, policy) {
  // Fail closed: with no allowed user configured, nothing is forwarded.
  if (!policy?.allowedUser) return drop('no-allowed-user-configured')
  if (user !== policy.allowedUser) return drop('sender-not-allowed')
  return null
}

function checkChannel(channel, policy) {
  if (!policy?.allowedChannelIds || policy.allowedChannelIds.size === 0) {
    return drop('no-channels-allowed')
  }
  if (!policy.allowedChannelIds.has(channel)) return drop('channel-not-allowed')
  return null
}

function drop(reason) {
  return { forward: false, reason }
}
