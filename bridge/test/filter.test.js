import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseList, isChannelId, resolveAllowlist, checkMessage, checkReaction } from '../src/filter.js'

const OWNER = 'U0OWNER001'
const CEO = 'C0CEO00001'
const APPROVALS = 'C0APPR0001'
const PRIVATE_IT = 'G0IT000001'
const RANDOM = 'C0RAND0001'
const policy = { allowedUser: OWNER, allowedChannelIds: new Set([CEO, APPROVALS, PRIVATE_IT]) }

const msg = over => ({ type: 'message', user: OWNER, channel: CEO, text: 'hello', ts: '1700000000.000100', ...over })
const reaction = over => ({
  type: 'reaction_added',
  user: OWNER,
  reaction: 'white_check_mark',
  item: { type: 'message', channel: APPROVALS, ts: '1700000000.000200' },
  ...over,
})

test('parseList splits on commas/whitespace and strips #', () => {
  assert.deepEqual(parseList('ceo, #approvals  C0CEO00001,,'), ['ceo', 'approvals', 'C0CEO00001'])
  assert.deepEqual(parseList(''), [])
  assert.deepEqual(parseList(undefined), [])
})

test('isChannelId recognises public (C) and private (G) IDs only', () => {
  assert.equal(isChannelId('C0CEO00001'), true)
  assert.equal(isChannelId('G0IT000001'), true)
  assert.equal(isChannelId('ceo'), false)
  assert.equal(isChannelId('U0OWNER001'), false)
  assert.equal(isChannelId('D0DM000001'), false)
})

test('resolveAllowlist maps names (case-insensitive) and IDs, reports unknown names', () => {
  const channels = [
    { id: CEO, name: 'ceo' },
    { id: APPROVALS, name: 'approvals' },
    { id: RANDOM, name: 'random' },
  ]
  const { ids, unresolved } = resolveAllowlist(['CEO', 'approvals', PRIVATE_IT, 'it'], channels)
  assert.deepEqual([...ids].sort(), [APPROVALS, CEO, PRIVATE_IT].sort())
  assert.deepEqual(unresolved, ['it'])
  assert.equal(ids.has(RANDOM), false)
})

test('message from the owner in an allowlisted channel is forwarded', () => {
  assert.deepEqual(checkMessage(msg(), policy), { forward: true })
  assert.deepEqual(checkMessage(msg({ channel: PRIVATE_IT }), policy), { forward: true })
  assert.deepEqual(checkMessage(msg({ thread_ts: '1699999999.000001' }), policy), { forward: true })
  assert.deepEqual(checkMessage(msg({ subtype: 'thread_broadcast' }), policy), { forward: true })
  assert.deepEqual(checkMessage(msg({ subtype: 'file_share', text: '', files: [{ name: 'a.png' }] }), policy), {
    forward: true,
  })
})

test('message from anyone else is dropped, even in an allowlisted channel', () => {
  assert.deepEqual(checkMessage(msg({ user: 'U0SOMEONE1' }), policy), { forward: false, reason: 'sender-not-allowed' })
  assert.deepEqual(checkMessage(msg({ user: undefined }), policy), { forward: false, reason: 'sender-not-allowed' })
})

test('message from the owner in a non-allowlisted channel or DM is dropped', () => {
  assert.equal(checkMessage(msg({ channel: RANDOM }), policy).reason, 'channel-not-allowed')
  assert.equal(checkMessage(msg({ channel: 'D0DM000001', channel_type: 'im' }), policy).reason, 'channel-not-allowed')
})

test('bot messages, edits, deletes, joins and hidden events are dropped', () => {
  assert.equal(checkMessage(msg({ bot_id: 'B01' }), policy).reason, 'bot')
  assert.equal(checkMessage(msg({ subtype: 'bot_message' }), policy).reason, 'subtype:bot_message')
  assert.equal(checkMessage(msg({ subtype: 'message_changed' }), policy).reason, 'subtype:message_changed')
  assert.equal(checkMessage(msg({ subtype: 'message_deleted' }), policy).reason, 'subtype:message_deleted')
  assert.equal(checkMessage(msg({ subtype: 'channel_join' }), policy).reason, 'subtype:channel_join')
  assert.equal(checkMessage(msg({ hidden: true }), policy).reason, 'hidden')
})

test('empty messages are dropped', () => {
  assert.equal(checkMessage(msg({ text: '   ' }), policy).reason, 'empty')
  assert.equal(checkMessage(null, policy).reason, 'malformed')
})

test('fails closed when the allowed user or channel list is not configured', () => {
  assert.equal(checkMessage(msg(), { allowedUser: '', allowedChannelIds: policy.allowedChannelIds }).reason, 'no-allowed-user-configured')
  assert.equal(checkMessage(msg(), { allowedUser: OWNER, allowedChannelIds: new Set() }).reason, 'no-channels-allowed')
  assert.equal(checkMessage(msg({ user: '' }), { allowedUser: '', allowedChannelIds: policy.allowedChannelIds }).reason, 'no-allowed-user-configured')
})

test('reaction from the owner on a message in an allowlisted channel is forwarded', () => {
  assert.deepEqual(checkReaction(reaction(), policy), { forward: true })
})

test('reactions from others, elsewhere, or on non-messages are dropped', () => {
  assert.equal(checkReaction(reaction({ user: 'U0SOMEONE1' }), policy).reason, 'sender-not-allowed')
  assert.equal(
    checkReaction(reaction({ item: { type: 'message', channel: RANDOM, ts: '1.2' } }), policy).reason,
    'channel-not-allowed',
  )
  assert.equal(checkReaction(reaction({ item: { type: 'file', file: 'F01' } }), policy).reason, 'item:file')
  assert.equal(checkReaction(reaction({ reaction: '' }), policy).reason, 'no-reaction')
})
