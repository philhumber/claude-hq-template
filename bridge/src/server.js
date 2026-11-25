#!/usr/bin/env node
// slack-hq: Claude Code channel server for an HQ session.
//
// Claude Code spawns this over stdio (registered in the HQ folder's local MCP scope; see README). It:
//   - declares the `claude/channel` capability so Slack events are pushed into the session
//   - connects to Slack in Socket Mode (outbound websocket only, no public URL)
//   - forwards `message` and `reaction_added` events ONLY from SLACK_ALLOWED_USER in
//     SLACK_ALLOWED_CHANNELS; everything else is dropped and logged locally
//   - exposes reply / post / react tools, limited to the allowlisted channels
//
// Protocol: https://code.claude.com/docs/en/channels-reference.md

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createLogger, boltLogger } from './log.js'
import { parseList, isChannelId, resolveAllowlist, checkMessage, checkReaction } from './filter.js'
import { formatMessage, formatReaction } from './format.js'
import { parseDue, formatDue, dueLine, DUE_LINE_RE } from './due.js'
import { z } from 'zod'
import {
  PendingPermissions,
  parseVerdictText,
  behaviorFromReaction,
  formatPermissionPrompt,
  formatPermissionOutcome,
  PERMISSION_REPLY_RE,
} from './permission.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// stdout belongs to MCP. Route any stray console output from dependencies to stderr.
console.log = console.info = console.debug = (...a) => process.stderr.write(`${a.join(' ')}\n`)

loadEnv(process.env.SLACK_HQ_ENV_FILE || path.join(ROOT, '.env'))
const log = createLogger(process.env.SLACK_HQ_LOG_DIR || path.join(ROOT, 'logs'))

const config = {
  botToken: process.env.SLACK_BOT_TOKEN || '',
  appToken: process.env.SLACK_APP_TOKEN || '',
  allowedUser: (process.env.SLACK_ALLOWED_USER || '').trim(),
  channelEntries: parseList(process.env.SLACK_ALLOWED_CHANNELS),
  permissionRelay: /^(1|true|yes|on)$/i.test(process.env.SLACK_PERMISSION_RELAY || ''),
  permissionChannel: (process.env.SLACK_PERMISSION_CHANNEL || 'approvals').replace(/^#/, ''),
}
const pending = new PendingPermissions()
// The owner's to-dos are posts in this channel (Slack To-dos can't be read on mobile or set by API).
// It must also be listed in SLACK_ALLOWED_CHANNELS.
const TODO_CHANNEL = (process.env.SLACK_TODO_CHANNEL || 'todo').replace(/^#/, '')

// slack-hq is registered for the whole HQ folder (channels only look at normal MCP config,
// not --mcp-config), so every Claude session there starts a copy. Only the HQ session,
// launched by start-hq.ps1 with SLACK_HQ_ROLE=hq, may open the Slack socket; every other
// copy stays dormant with no tools, so it can't steal events or post.
const IS_HQ = (process.env.SLACK_HQ_ROLE || '').toLowerCase() === 'hq'

const MAX_SLACK_TEXT = 39000

const INSTRUCTIONS = `You are connected to the owner's private Slack HQ workspace through the slack-hq channel. The owner is the one human who instructs and approves.

Events arrive as <channel source="slack-hq" event="..." channel="..." channel_id="..." user="..." ts="..." thread_ts="...">.
- event="message": the owner wrote in a Slack channel. The body is their message text.
- event="reaction": the owner reacted to a message. The "reaction" attribute is the emoji name (e.g. white_check_mark, x). The body quotes the message they reacted to; "ts" is that message, "thread_ts" is its thread.
- channel is the channel name without "#"; channel_id is the Slack ID. in_thread="true" means the message is a reply inside an existing thread.

Only messages from the owner, in allowlisted HQ channels, ever reach you. Everything else is filtered out before it gets here.

To answer, call the reply tool with channel = the channel_id attribute and thread_ts = the thread_ts attribute, so the answer lands in the right thread. Use post to start a new top-level message in a channel (it returns the new message's ts, which you can use as thread_ts later). Use react to acknowledge (e.g. emoji "eyes" when you start work, "white_check_mark" when done). For Slack channel IDs, user IDs or the workspace name, call list_channels: never search files for them.
Your replies are not shown in the terminal, only the tool call, so put the full answer in the Slack message. Slack uses mrkdwn: *bold*, _italic_, \`code\`, bullet lines with "•" or "-".` +
  (config.permissionRelay
    ? `

Permission prompts in this session are also relayed to Slack #${config.permissionChannel}, where only the owner can answer them with a reaction or "yes/no <id>". You never answer, react to, or post verdicts for those prompts yourself (the bridge refuses it). Before an action that will need approval, tell the owner in the relevant thread what you are about to do and why, so the prompt in Slack makes sense.`
    : '')

// ---------------------------------------------------------------- Slack state
let slack = null // Bolt App, once connected
let workspace = {} // { team, team_id, bot_user } from auth.test
let allowedChannelIds = new Set()
const channelNames = new Map() // id -> name
let lastRefresh = 0

async function refreshChannels() {
  lastRefresh = Date.now()
  const channels = []
  let cursor
  do {
    const res = await slack.client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000,
      cursor,
    })
    channels.push(...(res.channels || []))
    cursor = res.response_metadata?.next_cursor || undefined
  } while (cursor)
  channelNames.clear()
  for (const c of channels) channelNames.set(c.id, c.name)
  const { ids, unresolved } = resolveAllowlist(config.channelEntries, channels)
  allowedChannelIds = ids
  log.info('channel allowlist resolved', {
    allowed: [...ids].map(id => `${channelNames.get(id) || '?'}(${id})`),
    unresolved,
  })
  if (unresolved.length) {
    log.warn('some allowlisted channels were not found; invite the bot to private channels with /invite @<bot>', { unresolved })
  }
}

// When an event comes from a channel we don't know (e.g. created after start), refresh at most once a minute.
async function maybeRefreshFor(channelId) {
  if (channelNames.has(channelId) || Date.now() - lastRefresh < 60_000) return
  try {
    await refreshChannels()
  } catch (err) {
    log.warn('channel refresh failed', err)
  }
}

function policy() {
  return { allowedUser: config.allowedUser, allowedChannelIds }
}

function resolveTargetChannel(channel) {
  const c = String(channel || '').trim().replace(/^#/, '')
  let id = c
  if (!isChannelId(c)) {
    id = [...channelNames].find(([, name]) => name.toLowerCase() === c.toLowerCase())?.[0]
  }
  if (!id || !allowedChannelIds.has(id)) {
    throw new Error(`channel "${channel}" is not an allowlisted HQ channel`)
  }
  return id
}

async function fetchMessage(channel, ts) {
  try {
    const hist = await slack.client.conversations.history({ channel, latest: ts, inclusive: true, limit: 1 })
    const m = hist.messages?.find(x => x.ts === ts)
    if (m) return m
    // Not top-level: it's a thread reply. conversations.replies accepts a reply ts and returns its thread.
    const rep = await slack.client.conversations.replies({ channel, ts, limit: 200 })
    return rep.messages?.find(x => x.ts === ts) || null
  } catch (err) {
    log.warn('could not fetch reacted message', { channel, ts, error: err?.data?.error || err?.message })
    return null
  }
}

// ---------------------------------------------------------------- MCP server
const mcp = new Server(
  { name: 'slack-hq', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        // Opt in to permission relay only when enabled. Omitting the key = not declared.
        ...(config.permissionRelay ? { 'claude/channel/permission': {} } : {}),
      },
      tools: {},
    },
    instructions: INSTRUCTIONS,
  },
)

const TOOLS = [
  {
    name: 'reply',
    description: 'Reply in a Slack thread. Use the channel_id and thread_ts attributes from the <channel> tag.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel ID (preferred, from channel_id) or channel name' },
        thread_ts: { type: 'string', description: 'The thread to reply in (thread_ts attribute)' },
        text: { type: 'string', description: 'Message text (Slack mrkdwn)' },
      },
      required: ['channel', 'thread_ts', 'text'],
    },
  },
  {
    name: 'post',
    description: 'Post a new top-level message in an HQ Slack channel. Returns the new message ts.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (e.g. "approvals") or channel ID' },
        text: { type: 'string', description: 'Message text (Slack mrkdwn)' },
      },
      required: ['channel', 'text'],
    },
  },
  {
    name: 'react',
    description: 'Add an emoji reaction to a Slack message.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel ID or name' },
        ts: { type: 'string', description: 'The ts of the message to react to' },
        emoji: { type: 'string', description: 'Emoji name without colons, e.g. "eyes" or "white_check_mark"' },
      },
      required: ['channel', 'ts', 'emoji'],
    },
  },
  {
    name: 'todo',
    description:
      `Post a to-do for the owner in #${TODO_CHANNEL} (one message per action; always for the owner). Use after the owner approves an item that leaves him something to do. The owner reacts ✅ on the post when it's done. Returns the post's ts and link: record them in company/todos.md.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short action line: verb + ID + what, e.g. "Run cloudflared update (IT-1)"' },
        details: {
          type: 'string',
          description: 'Why, the steps, and every copy-paste text or command (in code blocks). Slack mrkdwn.',
        },
        due: {
          type: 'string',
          description:
            'When it is due, in the owner\'s local time: "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" (09:00 assumed). Optional; defaults to tomorrow 09:00.',
        },
        source_channel: { type: 'string', description: "Optional: the approved item's channel ID, to link back to its thread" },
        source_thread_ts: { type: 'string', description: "Optional: the approved item's thread ts" },
      },
      required: ['title', 'details'],
    },
  },
  {
    name: 'todo_due',
    description: `Change the due date on an existing to-do post in #${TODO_CHANNEL} (e.g. when the owner asks for more time). Edits the post's 📅 line and notes the change in its thread.`,
    inputSchema: {
      type: 'object',
      properties: {
        ts: { type: 'string', description: `The to-do post's ts in #${TODO_CHANNEL}` },
        due: { type: 'string', description: 'New due date: "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" (09:00 assumed)' },
      },
      required: ['ts', 'due'],
    },
  },
  {
    name: 'list_channels',
    description:
      'List the HQ Slack channels this bridge can use (name and channel ID), plus the workspace, the bot user ID and the owner\'s user ID. Read-only. Use this instead of searching files for Slack IDs.',
    inputSchema: { type: 'object', properties: {} },
  },
]

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: IS_HQ ? TOOLS : [] }))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const name = req.params.name
  const args = req.params.arguments || {}
  try {
    if (!IS_HQ || !TOOLS.some(t => t.name === name)) throw new Error(`unknown tool: ${name}`)
    if (!slack) throw new Error('Slack is not connected (check .env and logs/slack-hq.log)')

    if (name === 'list_channels') {
      const lines = [...allowedChannelIds]
        .map(id => ({ id, name: channelNames.get(id) || '?' }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `#${c.name}  ${c.id}`)
      return ok(
        [
          `workspace: ${workspace.team || '?'} (${workspace.team_id || '?'})`,
          `bot user: ${workspace.bot_user || '?'}`,
          `Owner (allowed user): ${config.allowedUser}`,
          `permission prompts go to: #${config.permissionRelay ? config.permissionChannel : '(relay off)'}`,
          'channels:',
          ...lines,
        ].join('\n'),
      )
    }

    if (name === 'todo') {
      const channel = resolveTargetChannel(TODO_CHANNEL)
      const title = requireString(args.title, 'title').replace(/\s+/g, ' ').trim()
      const details = requireString(args.details, 'details').trim()
      const time = parseDue(args.due)
      let source = ''
      if (args.source_channel && args.source_thread_ts) {
        try {
          const res = await slack.client.chat.getPermalink({
            channel: resolveTargetChannel(args.source_channel),
            message_ts: String(args.source_thread_ts),
          })
          source = res.permalink ? `\n\n<${res.permalink}|↩ Item thread>` : ''
        } catch (err) {
          log.warn('todo: no source permalink', { error: err?.data?.error || err?.message })
        }
      }
      const text = clampText(`📝 *${title}*\n${dueLine(time)}\n\n${details}${source}\n\n_React ✅ when done._`)
      if (PERMISSION_REPLY_RE.test(text)) throw new Error('refused: text looks like a permission verdict')
      const res = await slack.client.chat.postMessage({ channel, text, unfurl_links: false })
      let link = ''
      try {
        link = (await slack.client.chat.getPermalink({ channel, message_ts: res.ts })).permalink || ''
      } catch {}
      log.info('tool todo', { channel, ts: res.ts, time })
      return ok(`to-do posted in #${TODO_CHANNEL} (ts=${res.ts}, due ${formatDue(time)}${link ? `, link ${link}` : ''})`)
    }

    if (name === 'todo_due') {
      const channel = resolveTargetChannel(TODO_CHANNEL)
      const ts = requireString(args.ts, 'ts')
      const time = parseDue(requireString(args.due, 'due'))
      const msg = await fetchMessage(channel, ts)
      if (!msg || msg.user !== workspace.bot_user || !DUE_LINE_RE.test(msg.text || '')) {
        throw new Error(`no to-do post with ts=${ts} in #${TODO_CHANNEL}`)
      }
      await slack.client.chat.update({ channel, ts, text: msg.text.replace(DUE_LINE_RE, dueLine(time)) })
      await slack.client.chat.postMessage({ channel, thread_ts: ts, text: `📅 Moved to ${formatDue(time)}.` })
      log.info('tool todo_due', { channel, ts, time })
      return ok(`due date changed to ${formatDue(time)} (ts=${ts})`)
    }

    const channel = resolveTargetChannel(args.channel)

    if (name === 'reply' || name === 'post') {
      const text = clampText(requireString(args.text, 'text'))
      // Claude must never answer its own permission prompts. (Bot messages are dropped by
      // the sender gate anyway; this is a second lock.)
      if (PERMISSION_REPLY_RE.test(text)) throw new Error('refused: text looks like a permission verdict')
      const params = { channel, text, unfurl_links: false }
      if (name === 'reply') params.thread_ts = requireString(args.thread_ts, 'thread_ts')
      const res = await slack.client.chat.postMessage(params)
      log.info(`tool ${name}`, { channel, thread_ts: params.thread_ts, ts: res.ts })
      return ok(`sent (channel=${channel} ts=${res.ts}${params.thread_ts ? ` thread_ts=${params.thread_ts}` : ''})`)
    }

    // react
    const emoji = requireString(args.emoji, 'emoji').replace(/^:|:$/g, '')
    const ts = requireString(args.ts, 'ts')
    if (pending.getByMessage(channel, ts)) throw new Error('refused: cannot react to an open permission prompt')
    try {
      await slack.client.reactions.add({ channel, timestamp: ts, name: emoji })
    } catch (err) {
      if (err?.data?.error !== 'already_reacted') throw err
    }
    log.info('tool react', { channel, ts, emoji })
    return ok(`reacted :${emoji}:`)
  } catch (err) {
    const msg = err?.data?.error ? `Slack API error: ${err.data.error}` : err?.message || String(err)
    log.warn(`tool ${name} failed`, { error: msg })
    return { content: [{ type: 'text', text: msg }], isError: true }
  }
})

function ok(text) {
  return { content: [{ type: 'text', text }] }
}

function requireString(v, field) {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${field} is required`)
  return v
}

function clampText(text) {
  return text.length > MAX_SLACK_TEXT ? `${text.slice(0, MAX_SLACK_TEXT)}\n…(truncated)` : text
}

// ---------------------------------------------------------------- permission relay
// Claude Code (not Claude) sends this when a permission dialog opens in the session.
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

if (config.permissionRelay) {
  mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
    log.info('permission request', { request_id: params.request_id, tool: params.tool_name })
    if (!slack) return log.warn('permission request not relayed: Slack not connected (answer in the terminal)')
    try {
      const channel = resolveTargetChannel(config.permissionChannel)
      const res = await slack.client.chat.postMessage({
        channel,
        text: formatPermissionPrompt(params),
        unfurl_links: false,
        unfurl_media: false,
      })
      pending.add(params, { channel, ts: res.ts })
    } catch (err) {
      log.error('permission request could not be posted', { error: err?.data?.error || err?.message })
    }
  })
}

async function resolvePermission(entry, behavior, via) {
  await mcp.notification({
    method: 'notifications/claude/channel/permission',
    params: { request_id: entry.params.request_id, behavior },
  })
  log.info('permission verdict sent', { request_id: entry.params.request_id, behavior, via })
  try {
    await slack.client.chat.update({
      channel: entry.channel,
      ts: entry.ts,
      text: formatPermissionOutcome(entry.params, behavior, via),
    })
  } catch (err) {
    log.warn('could not update permission prompt message', { error: err?.data?.error || err?.message })
  }
}

/** Returns true if the (already sender-gated) message was a permission verdict. */
async function handleVerdictMessage(event) {
  if (!config.permissionRelay) return false
  const verdict = parseVerdictText(event.text)
  if (!verdict) return false
  const entry = pending.take(verdict.request_id)
  if (entry) {
    await resolvePermission(entry, verdict.behavior, 'typed reply')
  } else {
    log.info('verdict for unknown/expired permission request', { request_id: verdict.request_id })
    await slack.client.chat
      .postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: `No open permission request \`${verdict.request_id}\` (already answered, expired, or mistyped).`,
      })
      .catch(() => {})
  }
  return true
}

/** Returns true if the (already sender-gated) reaction was on a permission prompt. */
async function handleVerdictReaction(event) {
  if (!config.permissionRelay) return false
  const entry = pending.getByMessage(event.item.channel, event.item.ts)
  if (!entry) {
    if (!pending.isPromptMessage(event.item.channel, event.item.ts)) return false
    log.info('reaction on a closed permission prompt ignored', { reaction: event.reaction, ts: event.item.ts })
    return true
  }
  const behavior = behaviorFromReaction(event.reaction)
  if (!behavior) {
    log.info('ignored reaction on permission prompt', { reaction: event.reaction })
    return true // never forward reactions on prompts to Claude
  }
  pending.take(entry.params.request_id)
  await resolvePermission(entry, behavior, `:${event.reaction}: reaction`)
  return true
}

async function push({ content, meta }) {
  await mcp.notification({ method: 'notifications/claude/channel', params: { content, meta } })
  log.info('forwarded', meta)
}

// ---------------------------------------------------------------- Slack wiring
async function startSlack() {
  if (!IS_HQ) {
    log.info('dormant: not the HQ session (SLACK_HQ_ROLE is not "hq"), Slack not connected')
    return
  }
  const missing = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_ALLOWED_USER', 'SLACK_ALLOWED_CHANNELS'].filter(
    k => !process.env[k],
  )
  if (missing.length) {
    log.error(`Slack not started: missing ${missing.join(', ')} in .env. Tools will return errors until fixed.`)
    return
  }
  if (!acquireLock()) return

  const { default: bolt } = await import('@slack/bolt')
  const app = new bolt.App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logger: boltLogger(log),
  })

  app.event('message', async ({ event }) => {
    await maybeRefreshFor(event.channel)
    const verdict = checkMessage(event, policy())
    if (!verdict.forward) return logDrop('message', verdict.reason, event.user, event.channel, event.subtype)
    if (await handleVerdictMessage(event)) return // handled as a verdict; don't also forward as chat
    await push(formatMessage(event, channelNames.get(event.channel)))
  })

  app.event('reaction_added', async ({ event }) => {
    await maybeRefreshFor(event.item?.channel)
    const verdict = checkReaction(event, policy())
    if (!verdict.forward) return logDrop('reaction', verdict.reason, event.user, event.item?.channel)
    if (await handleVerdictReaction(event)) return
    const target = await fetchMessage(event.item.channel, event.item.ts)
    await push(formatReaction(event, channelNames.get(event.item.channel), target))
  })

  app.error(async err => log.error('bolt error', err))

  await app.start()
  slack = app
  const auth = await app.client.auth.test()
  workspace = { team: auth.team, team_id: auth.team_id, bot_user: auth.user_id }
  log.info('connected to Slack (Socket Mode)', { team: auth.team, bot_user: auth.user_id, allowed_user: config.allowedUser })
  await refreshChannels()
}

function logDrop(kind, reason, user, channel, subtype) {
  // Dropped silently: nothing reaches Claude. Text is never logged for drops.
  log.info(`dropped ${kind}`, { reason, user, channel, channel_name: channelNames.get(channel), subtype })
}

// ---------------------------------------------------------------- single instance
// Slack spreads Socket Mode events across every open connection for the app. A second
// copy of this server would silently steal events, so only one may hold the socket.
const LOCK = path.join(process.env.SLACK_HQ_LOG_DIR || path.join(ROOT, 'logs'), 'slack-hq.lock')
let haveLock = false

function acquireLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'))
    if (pid && pid !== process.pid && isAlive(pid)) {
      log.error(`another slack-hq (pid ${pid}) holds the Slack socket; this copy will not connect. Lock: ${LOCK}`)
      return false
    }
  } catch {
    // no lock file
  }
  fs.writeFileSync(LOCK, String(process.pid))
  haveLock = true
  return true
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

let stopping = false
async function shutdown(why) {
  if (stopping) return
  stopping = true
  log.info(`shutting down: ${why}`)
  try {
    await slack?.stop()
  } catch {}
  if (haveLock) {
    try {
      if (fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.unlinkSync(LOCK)
    } catch {}
  }
  process.exit(0)
}

function loadEnv(file) {
  try {
    process.loadEnvFile(file)
  } catch {
    // no .env yet; startSlack() logs what is missing
  }
}

// ---------------------------------------------------------------- main
// When Claude Code exits, stdin closes. Exit too, so no orphan keeps the Slack socket.
process.stdin.on('end', () => shutdown('stdin closed'))
process.stdin.on('close', () => shutdown('stdin closed'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', err => log.error('unhandled rejection', err))

const transport = new StdioServerTransport()
transport.onclose = () => shutdown('transport closed')
await mcp.connect(transport)
log.info('slack-hq MCP server connected over stdio', { pid: process.pid, log: log.file })

startSlack().catch(err => log.error('Slack start failed', { error: err?.data?.error || err?.message }))
