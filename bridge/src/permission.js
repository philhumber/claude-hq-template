// Permission relay (channels-reference.md, "Relay permission prompts").
//
// When the HQ session hits a permission dialog (e.g. an "ask" rule on Gmail send),
// Claude Code sends notifications/claude/channel/permission_request to this server.
// We post it to #approvals; the owner answers with a ✅/❌ reaction on that message, or by
// typing "yes <id>" / "no <id>". We send back notifications/claude/channel/permission.
// The terminal dialog stays open too; whichever answer arrives first wins.
//
// The sender gate in filter.js runs BEFORE any of this, so only the owner can answer.
// Pure logic only; no Slack or MCP imports.

// Claude Code's ID alphabet: five lowercase letters a-z without 'l'. /i tolerates autocorrect.
export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

const ALLOW_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check', '+1', 'thumbsup'])
const DENY_REACTIONS = new Set(['x', 'no_entry', 'no_entry_sign', 'heavy_multiplication_x', '-1', 'thumbsdown'])

const PREVIEW_LIMIT = 2500
const DESCRIPTION_LIMIT = 500

/** "yes abcde" -> { request_id: 'abcde', behavior: 'allow' }; anything else -> null */
export function parseVerdictText(text) {
  const m = PERMISSION_REPLY_RE.exec(String(text ?? ''))
  if (!m) return null
  return {
    request_id: m[2].toLowerCase(),
    behavior: m[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
  }
}

/** 'white_check_mark' -> 'allow', 'x' -> 'deny', '+1::skin-tone-3' -> 'allow', 'eyes' -> null */
export function behaviorFromReaction(reaction) {
  const name = String(reaction ?? '').replace(/::skin-tone-\d$/, '')
  if (ALLOW_REACTIONS.has(name)) return 'allow'
  if (DENY_REACTIONS.has(name)) return 'deny'
  return null
}

/**
 * Make untrusted text safe to show in Slack: escape &, <, > (so it can't produce
 * @channel pings or disguised links) and stop it breaking out of a code block.
 */
export function slackSafe(text, limit) {
  let t = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```/g, "'''")
  if (limit && t.length > limit) t = `${t.slice(0, limit)}… (${t.length - limit} more chars)`
  return t
}

/** Slack message text for a permission_request's params. */
export function formatPermissionPrompt(params) {
  const id = params.request_id
  return [
    `:lock: *Permission request \`${id}\`*: Claude wants to run *${slackSafe(params.tool_name, 100)}*`,
    `> ${slackSafe(params.description, DESCRIPTION_LIMIT).replace(/\n/g, ' ')}`,
    '```',
    slackSafe(params.input_preview, PREVIEW_LIMIT),
    '```',
    `React :white_check_mark: to *allow* or :x: to *deny* (this one call only), or reply \`yes ${id}\` / \`no ${id}\`.`,
  ].join('\n')
}

/** Slack text that replaces the prompt once answered. */
export function formatPermissionOutcome(params, behavior, via) {
  const verb = behavior === 'allow' ? ':white_check_mark: *Allowed*' : ':x: *Denied*'
  return `${verb} \`${params.request_id}\`: ${slackSafe(params.tool_name, 100)} (${via})\n> ${slackSafe(params.description, DESCRIPTION_LIMIT).replace(/\n/g, ' ')}`
}

/**
 * Open permission prompts, keyed by request_id and by the Slack message ts.
 * Entries expire (the terminal dialog may have been answered locally, and Claude
 * Code ignores verdicts for IDs it is no longer waiting on).
 */
export class PendingPermissions {
  constructor({ ttlMs = 6 * 60 * 60 * 1000, max = 100, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this.max = max
    this.now = now
    this.byId = new Map()
    this.idByTs = new Map()
    // Every prompt message ever posted (capped), so reactions on answered or expired
    // prompts are swallowed instead of reaching Claude as ordinary reactions.
    this.promptKeys = new Set()
  }

  add(params, { channel, ts }) {
    this.prune()
    const entry = { params, channel, ts, at: this.now() }
    this.byId.set(params.request_id, entry)
    if (ts) {
      this.idByTs.set(`${channel}:${ts}`, params.request_id)
      this.promptKeys.add(`${channel}:${ts}`)
      while (this.promptKeys.size > 1000) this.promptKeys.delete(this.promptKeys.values().next().value)
    }
    while (this.byId.size > this.max) this.take(this.byId.keys().next().value)
    return entry
  }

  getById(id) {
    this.prune()
    return this.byId.get(id) || null
  }

  getByMessage(channel, ts) {
    this.prune()
    const id = this.idByTs.get(`${channel}:${ts}`)
    return id ? this.byId.get(id) || null : null
  }

  /** True for any prompt message this server posted (open, answered or expired). */
  isPromptMessage(channel, ts) {
    return this.promptKeys.has(`${channel}:${ts}`)
  }

  /** Remove and return the entry (so a second ✅ does nothing). */
  take(id) {
    const entry = this.byId.get(id)
    if (!entry) return null
    this.byId.delete(id)
    if (entry.ts) this.idByTs.delete(`${entry.channel}:${entry.ts}`)
    return entry
  }

  prune() {
    const cutoff = this.now() - this.ttlMs
    for (const [id, entry] of this.byId) if (entry.at < cutoff) this.take(id)
  }

  get size() {
    return this.byId.size
  }
}
