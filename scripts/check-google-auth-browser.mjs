// Real React + Vite handlers + Edge. Only Google's external authorization UI
// and token/key delivery are replaced; the official JWT verifier still runs.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from '../mediweb-downloader/node_modules/playwright-core/index.mjs'
import { viteTtsApiPlugin } from '../server/viteTtsApiPlugin.js'
import { googleAuthFixture } from '../test-support/googleAuthFixture.js'

let fixture, browser, server, externalRequests = 0, fakeSyntheses = 0
const original = { ...process.env }
const service = createHttpServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer fictitious-browser-google-service-token')
  if (req.url === '/configuration') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ provider: 'fixture', model: 'test', voice_ref: 'test', format: 'mp3' })) }
  assert.equal(req.url, '/synthesize'); fakeSyntheses++; res.setHeader('Content-Type', 'audio/mpeg'); res.end('ID3-FICTITIOUS')
})
try {
  delete process.env.VERCEL
  process.env.NODE_ENV = 'development'
  service.listen(0, '127.0.0.1'); await once(service, 'listening')
  Object.assign(process.env, { TTS_SERVICE_URL: `http://127.0.0.1:${service.address().port}`, TTS_SERVICE_ACCESS_TOKEN: 'fictitious-browser-google-service-token', TTS_LEGACY_MODE: '' })
  server = await createServer({ configFile: false, envFile: false, plugins: [react(), viteTtsApiPlugin({ googleHandlers: { start: request => fixture.handlers.start(request), callback: request => fixture.handlers.callback(request) } })], server: { host: '127.0.0.1', port: 4192, strictPort: true, watch: { ignored: ['**/artifacts/**', '**/mediweb-downloader/build-windows/**', '**/mediweb-downloader/dist-windows/**'] } } })
  await server.listen()
  const origin = 'http://127.0.0.1:4192'
  fixture = googleAuthFixture(origin)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
    if (url.origin === 'https://accounts.google.com') {
      const state = url.searchParams.get('state')
      const callback = new URL('/api/auth/google-callback', origin)
      callback.searchParams.set('state', state); callback.searchParams.set('code', state)
      // This is explicitly an isolated provider fixture, never a Google login.
      return route.fulfill({ contentType: 'text/html', body: `<title>Google ficticio · prueba aislada</title><h1>Proveedor de identidad ficticio</h1><a href="${callback}">Continuar prueba de identidad</a>` })
    }
    // In particular, never touch the installed Connector on port 8765.
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests++
    return route.abort()
  })
  const page = await context.newPage(); page.setDefaultTimeout(30000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  const access = page.getByRole('region', { name: 'Cuenta de Google' })
  await access.getByRole('link', { name: 'Continuar con Google' }).waitFor()
  await mkdir('artifacts/google-auth', { recursive: true })
  await access.screenshot({ path: 'artifacts/google-auth/01-continuar-con-google.png' })
  await access.getByRole('link', { name: 'Continuar con Google' }).click()
  await page.getByRole('link', { name: 'Continuar prueba de identidad' }).click()
  await access.getByText('Cuenta conectada', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.cookie.includes('ae_google_session')), false)
  await access.screenshot({ path: 'artifacts/google-auth/02-cuenta-conectada.png' })
  const audio = await page.evaluate(async () => (await fetch('/api/tts/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Texto ficticio para prueba aislada de autenticación.' }) })).status)
  assert.equal(audio, 200); assert.equal(fakeSyntheses, 1)
  const saved = await context.storageState()
  await page.reload(); await access.getByText('Cuenta conectada', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await access.screenshot({ path: 'artifacts/google-auth/03-cuenta-movil.png' })
  const restarted = await browser.newContext({ storageState: saved })
  const status = await (await restarted.request.get(origin + '/api/tts/session')).json()
  assert.equal(status.authenticated, true)
  await access.getByRole('button', { name: 'Cerrar sesión' }).click()
  await access.getByRole('link', { name: 'Continuar con Google' }).waitFor()
  const denied = await context.request.post(origin + '/api/tts/synthesize', { data: { text: 'Ficticio' } })
  assert.equal(denied.status(), 401); assert.equal(fakeSyntheses, 1)
  fixture.claims({ email: 'other@gmail.com' })
  await access.getByRole('link', { name: 'Continuar con Google' }).click()
  await page.getByRole('link', { name: 'Continuar prueba de identidad' }).click()
  await access.getByRole('alert').waitFor()
  assert.match(await access.getByRole('alert').textContent(), /Esa cuenta no tiene acceso/)
  await access.screenshot({ path: 'artifacts/google-auth/04-cuenta-rechazada.png' })
  assert.deepEqual(errors, []); assert.equal(externalRequests, 0)
  const result = { passed: true, browser: 'Edge', officialJwtSignatureVerification: true, allowedAccountOnly: true, browserRestart: true, logout: true, anonymousRejected: true, otherAccountRejected: true, fakeSyntheses, paidProviderRequests: 0, actualExternalRequests: externalRequests, pageErrors: errors }
  await writeFile('artifacts/google-auth/results.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await browser?.close(); await server?.close(); service.closeAllConnections(); await new Promise(resolve => service.close(resolve))
  fixture?.restore()
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]
  Object.assign(process.env, original)
}
