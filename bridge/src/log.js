// Local file logger. stdout is the MCP stdio transport, so NOTHING may be written
// there except protocol messages. Logs go to logs/slack-hq.log (+ stderr, which
// Claude Code keeps in its MCP debug output).

import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024

export function createLogger(dir, { stderr = true } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'slack-hq.log')

  function write(level, msg, data) {
    const line =
      `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}` +
      (data === undefined ? '' : ` ${safeJson(data)}`) +
      '\n'
    try {
      rotateIfLarge(file)
      fs.appendFileSync(file, line)
    } catch {
      // never crash the bridge because the log is unwritable
    }
    if (stderr) process.stderr.write(line)
  }

  const log = {
    file,
    debug: (msg, data) => (process.env.SLACK_HQ_DEBUG ? write('debug', msg, data) : undefined),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
  }
  return log
}

/** Adapter for Bolt's Logger interface, so Bolt never logs to stdout. */
export function boltLogger(log) {
  let level = 'info'
  const join = args => args.map(a => (typeof a === 'string' ? a : safeJson(a))).join(' ')
  return {
    debug: (...a) => log.debug(`[bolt] ${join(a)}`),
    info: (...a) => log.info(`[bolt] ${join(a)}`),
    warn: (...a) => log.warn(`[bolt] ${join(a)}`),
    error: (...a) => log.error(`[bolt] ${join(a)}`),
    setLevel: l => {
      level = l
    },
    getLevel: () => level,
    setName: () => {},
  }
}

function rotateIfLarge(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`)
  } catch {
    // file does not exist yet
  }
}

function safeJson(v) {
  try {
    if (v instanceof Error) return JSON.stringify({ error: v.message })
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
