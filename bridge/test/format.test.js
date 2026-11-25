import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanMeta, decodeSlackText, excerpt, formatMessage, formatReaction, EXCERPT_LIMIT } from '../src/format.js'

const META_KEY_RE = /^[A-Za-z0-9_]+$/

test('top-level message: thread_ts is the message ts so replies start a thread', () => {
  const { content, meta } = formatMessage(
    { user: 'U0OWNER001', channel: 'C0CEO00001', text: 'focus marketing on the journal launch', ts: '1700000000.000100' },
    'ceo',
  )
  assert.equal(content, 'focus marketing on the journal launch')
  assert.deepEqual(meta, {
    event: 'message',
    channel: 'ceo',
    channel_id: 'C0CEO00001',
    user: 'U0OWNER001',
    ts: '1700000000.000100',
    thread_ts: '1700000000.000100',
    in_thread: 'false',
  })
})

test('thread reply keeps the parent thread_ts', () => {
  const { meta } = formatMessage(
    { user: 'U1', channel: 'C1AAAAAAA', text: 'revise: shorter', ts: '1700000005.000200', thread_ts: '1700000000.000100' },
    'approvals',
  )
  assert.equal(meta.thread_ts, '1700000000.000100')
  assert.equal(meta.ts, '1700000005.000200')
  assert.equal(meta.in_thread, 'true')
})

test('Slack HTML escapes are decoded; mention links are kept', () => {
  const { content } = formatMessage(
    { user: 'U1', channel: 'C1AAAAAAA', text: 'R&amp;D &lt;3 &gt; ask <@U0OWNER001>', ts: '1.1' },
    'ceo',
  )
  assert.equal(content, 'R&D <3 > ask <@U0OWNER001>')
  assert.equal(decodeSlackText('&amp;lt;'), '&lt;') // single decode pass on &amp;
})

test('attachments are listed in the content', () => {
  const { content } = formatMessage(
    { user: 'U1', channel: 'C1AAAAAAA', text: 'see this', ts: '1.1', files: [{ name: 'error.png' }, { title: 'log.txt' }] },
    'it',
  )
  assert.equal(content, 'see this\n[attachments: error.png, log.txt]')
  const fileOnly = formatMessage({ user: 'U1', channel: 'C1AAAAAAA', text: '', ts: '1.1', files: [{ name: 'a.pdf' }] }, 'it')
  assert.equal(fileOnly.content, '[attachments: a.pdf]')
})

test('unknown channel name is omitted, not sent as "undefined"', () => {
  const { meta } = formatMessage({ user: 'U1', channel: 'C1AAAAAAA', text: 'x', ts: '1.1' }, undefined)
  assert.equal('channel' in meta, false)
  assert.equal(meta.channel_id, 'C1AAAAAAA')
})

test('reaction carries the emoji, the reacted message and its thread', () => {
  const event = {
    user: 'U0OWNER001',
    reaction: 'white_check_mark',
    item_user: 'U0BOT00001',
    item: { type: 'message', channel: 'C0APPR0001', ts: '1700000010.000300' },
  }
  const { content, meta } = formatReaction(event, 'approvals', {
    text: '*MKT-12* Social post draft: &quot;Spring launch&quot;',
    thread_ts: '1700000010.000300',
    user: 'U0BOT00001',
  })
  assert.match(content, /^Reaction :white_check_mark: added to message 1700000010\.000300\./)
  assert.match(content, /Message: "\*MKT-12\* Social post draft/)
  assert.deepEqual(meta, {
    event: 'reaction',
    channel: 'approvals',
    channel_id: 'C0APPR0001',
    user: 'U0OWNER001',
    reaction: 'white_check_mark',
    ts: '1700000010.000300',
    thread_ts: '1700000010.000300',
    message_user: 'U0BOT00001',
  })
})

test('reaction on a thread reply points thread_ts at the parent', () => {
  const event = { user: 'U1', reaction: 'x', item: { type: 'message', channel: 'C1AAAAAAA', ts: '5.5' } }
  const { meta } = formatReaction(event, 'approvals', { text: 'reply', thread_ts: '1.1' })
  assert.equal(meta.ts, '5.5')
  assert.equal(meta.thread_ts, '1.1')
})

test('reaction still formats when the message could not be fetched', () => {
  const event = { user: 'U1', reaction: 'x', item_user: 'U2', item: { type: 'message', channel: 'C1AAAAAAA', ts: '5.5' } }
  const { content, meta } = formatReaction(event, 'approvals', null)
  assert.match(content, /could not be fetched/)
  assert.equal(meta.thread_ts, '5.5')
  assert.equal(meta.message_user, 'U2')
})

test('long reacted messages are excerpted', () => {
  const long = 'a'.repeat(EXCERPT_LIMIT + 50)
  assert.equal(excerpt(long).length, EXCERPT_LIMIT + 1)
  assert.ok(excerpt(long).endsWith('…'))
})

test('all meta keys are identifiers and all values strings (Claude Code drops other keys)', () => {
  const samples = [
    formatMessage({ user: 'U1', channel: 'C1AAAAAAA', text: 'x', ts: '1.1', thread_ts: '1.0' }, 'ceo').meta,
    formatReaction({ user: 'U1', reaction: 'eyes', item: { type: 'message', channel: 'C1AAAAAAA', ts: '2.2' } }, 'it', null).meta,
  ]
  for (const meta of samples) {
    for (const [k, v] of Object.entries(meta)) {
      assert.match(k, META_KEY_RE)
      assert.equal(typeof v, 'string')
    }
  }
})

test('cleanMeta rejects non-identifier keys and drops empty values', () => {
  assert.throws(() => cleanMeta({ 'thread-ts': '1' }), /invalid meta key/)
  assert.deepEqual(cleanMeta({ a: undefined, b: null, c: '', d: 0, e: 'x' }), { d: '0', e: 'x' })
})
