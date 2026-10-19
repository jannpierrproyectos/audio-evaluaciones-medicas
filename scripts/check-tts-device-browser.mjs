// Actual public handlers + Edge cookies, using an isolated fake TTS HTTP service.
// No deployed endpoint, clinical catalogue or paid provider is called.
import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { chromium } from '../mediweb-downloader/node_modules/playwright-core/index.mjs'
import { createTtsDeviceLink } from '../server/ttsSession.js'
import { GET as deviceGet, POST as devicePost } from '../api/tts/device.js'
import { GET as sessionGet } from '../api/tts/session.js'
import { GET as configurationGet } from '../api/tts/configuration.js'
import { POST as synthesizePost } from '../api/tts/synthesize.js'

const env = { ...process.env }
let syntheses = 0, external = 0
const service = createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer fictitious-device-test-service-token')
  if (req.url === '/configuration') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ provider: 'fixture', model: 'fictitious-model', voice_ref: 'fixture', format: 'mp3' })) }
  assert.equal(req.url, '/synthesize'); syntheses++
  res.setHeader('Content-Type', 'audio/mpeg'); res.end('ID3-FICTITIOUS-LOCAL-TEST')
})
const app = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
    const request = new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
    const path = new URL(request.url).pathname
    const handler = { '/api/tts/device': incoming.method === 'POST' ? devicePost : deviceGet, '/api/tts/session': sessionGet, '/api/tts/configuration': configurationGet, '/api/tts/synthesize': synthesizePost }[path]
    const result = handler ? await handler(request) : new Response('<title>AudioEvaluaciones · equipo de prueba</title><p>Equipo vinculado. Prueba aislada, sin datos clínicos.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    outgoing.writeHead(result.status, Object.fromEntries(result.headers)); outgoing.end(Buffer.from(await result.arrayBuffer()))
  } catch { outgoing.writeHead(500); outgoing.end('TEST_HANDLER_ERROR') }
})
let browser
try {
  service.listen(0, '127.0.0.1'); await once(service, 'listening')
  Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1', TTS_OPERATOR_PASSPHRASE: 'fictitious-browser-device-administration-secret', TTS_SERVICE_URL: `http://127.0.0.1:${service.address().port}`, TTS_SERVICE_ACCESS_TOKEN: 'fictitious-device-test-service-token', TTS_LEGACY_MODE: '', INSTITUTIONAL_PROXY_TOKEN: '' })
  app.listen(0, '127.0.0.1'); await once(app, 'listening')
  const origin = `http://127.0.0.1:${app.address().port}`
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external++; return route.abort() })
  const page = await context.newPage(); const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(createTtsDeviceLink(origin)); await page.waitForURL(origin + '/')
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/tts/session')).json()).authenticated), true)
  assert.ok(!await page.evaluate(() => document.cookie).then(value => value.includes('ae_tts_session')))
  const storage = await context.storageState()
  assert.equal(storage.cookies.find(cookie => cookie.name === 'ae_tts_session')?.httpOnly, true)
  const restarted = await browser.newContext({ storageState: storage })
  const resumed = await restarted.newPage(); await resumed.goto(origin)
  const result = await resumed.evaluate(async () => {
    const metadata = await fetch('/api/tts/configuration')
    const response = await fetch('/api/tts/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Evaluación ficticia para comprobar el acceso del equipo.' }) })
    return { configuration: metadata.status, audio: response.status, mime: response.headers.get('content-type') }
  })
  assert.deepEqual(result, { configuration: 200, audio: 200, mime: 'audio/mpeg' })
  const anonymous = await browser.newContext()
  const denied = await anonymous.request.post(origin + '/api/tts/synthesize', { data: { text: 'Ficticio' } })
  assert.equal(denied.status(), 401)
  assert.equal(syntheses, 1); assert.equal(external, 0); assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, browser: 'Edge', productionHandlers: true, browserRestart: true, anonymousRejected: true, localFakeSyntheses: syntheses, paidProviderRequests: 0, pageErrors: errors }))
} finally {
  await browser?.close(); app.closeAllConnections(); service.closeAllConnections()
  await Promise.all([new Promise(resolve => app.close(resolve)), new Promise(resolve => service.close(resolve))])
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
  Object.assign(process.env, env)
}
