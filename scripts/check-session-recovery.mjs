/**
 * Focused session-refresh integration check. It exercises the real Electron
 * main process with a configured Web UI whose API can disappear independently
 * of its already-painted document.
 */

import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { sanitizedElectronEnv } from './lib/electron-env.mjs'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const checkHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-session-recovery-'))
const desktopHome = join(checkHome, 'desktop')
mkdirSync(desktopHome, { recursive: true })

let apiReachable = true
const fixture = createServer((req, res) => {
  if (req.url === '/api/host.describe' && req.method === 'POST') {
    if (!apiReachable) {
      res.writeHead(503)
      res.end('unavailable')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ result: { ok: true, value: { version: 'fixture', cwd: '/' } } }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><title>Session Recovery Fixture</title><script>'
    + 'sessionStorage.loads=String(Number(sessionStorage.loads||0)+1)</script><body>official web ui</body>')
})
await new Promise((resolve, reject) => {
  fixture.once('error', reject)
  fixture.listen(0, '127.0.0.1', resolve)
})
const address = fixture.address()
if (typeof address !== 'object' || address === null) throw new Error('fixture did not bind')
const origin = 'http://127.0.0.1:' + String(address.port)
writeFileSync(join(desktopHome, 'settings.json'), JSON.stringify({ serverUrl: origin, connectionMode: 'connect' }) + '\n')

const electronEnv = sanitizedElectronEnv()
electronEnv.DSH_HOME = join(checkHome, 'dsh')
electronEnv.DSH_DESKTOP_HOME = desktopHome

async function loadCount(window) {
  return await window.evaluate(() => Number(sessionStorage.loads || 0))
}

async function emitResume(app) {
  await app.evaluate(({ powerMonitor }) => { powerMonitor.emit('resume') })
}

async function emitHealthFocus(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.emit('focus')
  })
}

async function waitForLoadCount(window, expected, timeoutMs = 10_000) {
  await window.waitForFunction((count) => Number(sessionStorage.loads || 0) === count, expected, { timeout: timeoutMs })
}

let app
async function launchFixtureApp() {
  app = await electron.launch({
    args: [join(APP_DIR, '.build', 'main.mjs'), '--user-data-dir=' + join(checkHome, 'chromium')],
    env: electronEnv,
  })
  const window = await app.firstWindow()
  await window.waitForFunction(() => document.title === 'Session Recovery Fixture', null, { timeout: 10_000 })
  return window
}

try {
  let window = await launchFixtureApp()
  const initial = await loadCount(window)

  // Healthy periodic/focus checks do not reload a continuously healthy page.
  await emitHealthFocus(app)
  await new Promise(resolve => setTimeout(resolve, 1_300))
  if (await loadCount(window) !== initial) throw new Error('healthy configured Web UI reloaded unexpectedly')

  // An outage is recorded even though the old official page remains visible.
  apiReachable = false
  await emitHealthFocus(app)
  await new Promise(resolve => setTimeout(resolve, 1_300))
  if (await loadCount(window) !== initial) throw new Error('unreachable Web UI reloaded before it recovered')
  apiReachable = true
  await emitHealthFocus(app)
  await waitForLoadCount(window, initial + 1)

  // A fresh shell gives resume its own cooldown window, separate from the
  // reconnect transition above.
  await app.close()
  app = undefined
  window = await launchFixtureApp()
  const resumedInitial = await loadCount(window)
  apiReachable = false
  await emitResume(app)
  await new Promise(resolve => setTimeout(resolve, 3_300))
  if (await loadCount(window) !== resumedInitial) throw new Error('resume reloaded before the Web UI recovered')
  apiReachable = true
  await emitResume(app)
  await waitForLoadCount(window, resumedInitial + 1)

  // A flap during the shared cooldown neither loops nor consumes another reload.
  apiReachable = false
  await emitHealthFocus(app)
  await new Promise(resolve => setTimeout(resolve, 1_300))
  apiReachable = true
  await emitResume(app)
  await new Promise(resolve => setTimeout(resolve, 3_300))
  if (await loadCount(window) !== resumedInitial + 1) throw new Error('cooldown did not suppress reconnect reload loop')

  console.log('✓ continuously healthy configured Web UI does not reload')
  console.log('✓ unreachable → reachable configured Web UI reloads once')
  console.log('✓ resume waits for reachability before session re-bootstrap')
  console.log('✓ cooldown prevents reconnect flap reload loops')
} finally {
  await app?.close().catch(() => {})
  await new Promise(resolve => fixture.close(resolve))
  rmSync(checkHome, { recursive: true, force: true })
}
