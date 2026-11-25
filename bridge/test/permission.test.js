import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseVerdictText,
  behaviorFromReaction,
  slackSafe,
  formatPermissionPrompt,
  formatPermissionOutcome,
  PendingPermissions,
} from '../src/permission.js'

const req = over => ({
  request_id: 'abcde',
  tool_name: 'mcp__gmail__send_message',
  description: 'Send approved reply SUP-3 to customer',
  input_preview: '{"to": "customer@example.com", "subject": "Re: sync issue"}',
  ...over,
})

test('typed verdicts: yes/y/no/n + five-letter id, case-insensitive', () => {
  assert.deepEqual(parseVerdictText('yes abcde'), { request_id: 'abcde', behavior: 'allow' })
  assert.deepEqual(parseVerdictText('  Y   ABCDE '), { request_id: 'abcde', behavior: 'allow' })
  assert.deepEqual(parseVerdictText('no abcde'), { request_id: 'abcde', behavior: 'deny' })
  assert.deepEqual(parseVerdictText('N qwert'), { request_id: 'qwert', behavior: 'deny' })
})

test('non-verdicts are not parsed (fall through as normal chat)', () => {
  assert.equal(parseVerdictText('yes please send it'), null)
  assert.equal(parseVerdictText('yes abcd'), null) // 4 letters
  assert.equal(parseVerdictText('yes abcdef'), null) // 6 letters
  assert.equal(parseVerdictText('yes abcle'), null) // 'l' is not in Claude Code's ID alphabet
  assert.equal(parseVerdictText('ok abcde'), null)
  assert.equal(parseVerdictText('yes abcde and also this'), null)
  assert.equal(parseVerdictText(undefined), null)
})

test('reactions map to allow/deny; anything else is no verdict', () => {
  for (const r of ['white_check_mark', 'heavy_check_mark', '+1', 'thumbsup', '+1::skin-tone-3']) {
    assert.equal(behaviorFromReaction(r), 'allow', r)
  }
  for (const r of ['x', 'no_entry', 'no_entry_sign', '-1', 'thumbsdown::skin-tone-2']) {
    assert.equal(behaviorFromReaction(r), 'deny', r)
  }
  for (const r of ['eyes', 'heart', '', undefined]) assert.equal(behaviorFromReaction(r), null)
})

test('untrusted prompt text cannot ping, link or escape the code block', () => {
  const nasty = req({
    description: 'hi <!channel> see <https://evil.example|docs> & more',
    input_preview: '```\n*click* <!here>```',
  })
  const text = formatPermissionPrompt(nasty)
  assert.equal(text.includes('<!channel>'), false)
  assert.equal(text.includes('<!here>'), false)
  assert.equal(text.includes('<https://'), false)
  assert.match(text, /&lt;!channel&gt;/)
  // exactly the two fences we add
  assert.equal(text.split('```').length - 1, 2)
  assert.equal(slackSafe('a & b'), 'a &amp; b')
})

test('prompt shows id, tool, description, preview and how to answer', () => {
  const text = formatPermissionPrompt(req())
  assert.match(text, /Permission request `abcde`/)
  assert.match(text, /mcp__gmail__send_message/)
  assert.match(text, /Send approved reply SUP-3/)
  assert.match(text, /customer@example\.com/)
  assert.match(text, /yes abcde/)
  assert.match(text, /no abcde/)
})

test('long previews are truncated', () => {
  const text = formatPermissionPrompt(req({ input_preview: 'x'.repeat(5000) }))
  assert.ok(text.length < 4000)
  assert.match(text, /more chars/)
})

test('outcome text reflects the verdict', () => {
  assert.match(formatPermissionOutcome(req(), 'allow', 'reaction'), /Allowed.*abcde/)
  assert.match(formatPermissionOutcome(req(), 'deny', 'typed reply'), /Denied.*abcde/)
})

test('pending store: lookup by id and by message, take() is one-shot', () => {
  const p = new PendingPermissions()
  p.add(req(), { channel: 'C0APPR0001', ts: '1.1' })
  assert.equal(p.getById('abcde').ts, '1.1')
  assert.equal(p.getByMessage('C0APPR0001', '1.1').params.request_id, 'abcde')
  assert.equal(p.getByMessage('C0OTHER001', '1.1'), null)
  assert.ok(p.take('abcde'))
  assert.equal(p.take('abcde'), null) // a second ✅ does nothing
  assert.equal(p.getByMessage('C0APPR0001', '1.1'), null)
  assert.equal(p.size, 0)
  // still recognised as a prompt, so late reactions are swallowed, not forwarded
  assert.equal(p.isPromptMessage('C0APPR0001', '1.1'), true)
  assert.equal(p.isPromptMessage('C0APPR0001', '9.9'), false)
})

test('pending store: entries expire and the store is capped', () => {
  let now = 0
  const p = new PendingPermissions({ ttlMs: 1000, max: 2, now: () => now })
  p.add(req({ request_id: 'aaaaa' }), { channel: 'C1', ts: '1' })
  now = 500
  p.add(req({ request_id: 'bbbbb' }), { channel: 'C1', ts: '2' })
  now = 900
  p.add(req({ request_id: 'ccccc' }), { channel: 'C1', ts: '3' })
  assert.equal(p.getById('aaaaa'), null) // evicted by cap
  assert.equal(p.size, 2)
  now = 1600
  assert.equal(p.getById('bbbbb'), null) // expired
  assert.ok(p.getById('ccccc'))
})
