import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDue, formatDue, dueLine, DUE_LINE_RE } from '../src/due.js'

const now = new Date(2026, 10, 9, 15, 0) // 2026-11-09 15:00 local
const ts = d => Math.floor(d.getTime() / 1000)

test('empty due defaults to tomorrow 09:00', () => {
  assert.equal(parseDue(undefined, now), ts(new Date(2026, 10, 10, 9, 0)))
  assert.equal(parseDue('  ', now), ts(new Date(2026, 10, 10, 9, 0)))
})

test('date only means 09:00, date+time is exact', () => {
  assert.equal(parseDue('2026-11-11', now), ts(new Date(2026, 10, 11, 9, 0)))
  assert.equal(parseDue('2026-11-11 18:30', now), ts(new Date(2026, 10, 11, 18, 30)))
  assert.equal(parseDue('2026-11-11T18:30', now), ts(new Date(2026, 10, 11, 18, 30)))
})

test('past dates are moved to one minute from now', () => {
  assert.equal(parseDue('2026-11-01', now), ts(now) + 60)
})

test('bad input is refused', () => {
  assert.throws(() => parseDue('tomorrow', now))
  assert.throws(() => parseDue('2026-02-31', now))
  assert.throws(() => parseDue('2026-11-11; rm -rf', now))
})

test('due line formats and can be found again', () => {
  const t = ts(new Date(2026, 10, 11, 10, 0))
  assert.equal(formatDue(t), 'Wed 11 Nov, 10:00')
  const post = `📝 *Run cloudflared update (IT-1)*\n${dueLine(t)}\n\nsteps`
  const moved = post.replace(DUE_LINE_RE, dueLine(ts(new Date(2026, 10, 13, 9, 0))))
  assert.match(moved, /^📅 Due Fri 13 Nov, 09:00$/m)
  assert.match(moved, /^📝 \*Run cloudflared update \(IT-1\)\*$/m)
})

test('due line is found in Slack-stored text (emoji as :date:)', () => {
  const stored = ':memo: *Run cloudflared update (IT-1)*\n:date: Due Tue 10 Nov, 09:00\n\nsteps'
  const moved = stored.replace(DUE_LINE_RE, dueLine(ts(new Date(2026, 10, 13, 9, 0))))
  assert.match(moved, /^📅 Due Fri 13 Nov, 09:00$/m)
})
