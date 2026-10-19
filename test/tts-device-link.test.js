import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTtsDeviceLink, isTtsSessionActive, renewTtsSession } from '../server/ttsSession.js'
import { GET, POST } from '../api/tts/device.js'
import { authorizeTtsRequest } from '../server/ttsAccess.js'

test('public page: private link pairs the browser; authenticated use renews access without a password', async () => {
  const original = { ...process.env }; const originalNow = Date.now
  try {
    Object.assign(process.env, { TTS_OPERATOR_PASSPHRASE: 'fictitious-device-link-administration-secret', TTS_SERVICE_URL: 'https://tts.example.invalid', TTS_SERVICE_ACCESS_TOKEN: 'fictitious-service-credential-0123456789', TTS_LEGACY_MODE: '', INSTITUTIONAL_PROXY_TOKEN: '' })
    const origin = 'https://audio-evaluaciones-medicas.vercel.app'
    const link = createTtsDeviceLink(origin)
    const token = new URL(link).hash.slice(1)
    assert.equal(new URL(link).search, '')
    assert.ok(!link.includes(process.env.TTS_OPERATOR_PASSPHRASE))
    const request = (value = token, site = origin) => new Request(site + '/api/tts/device', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: site }, body: JSON.stringify({ token: value }) })
    const html = await GET()
    assert.match(html.headers.get('content-security-policy'), /default-src 'none'/)
    assert.equal(html.headers.get('referrer-policy'), 'no-referrer')
    const response = await POST(request())
    assert.equal(response.status, 200)
    const cookie = response.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/)
    const browser = { headers: { cookie: cookie.split(';')[0] } }
    assert.equal(isTtsSessionActive(browser), true)
    assert.doesNotThrow(() => authorizeTtsRequest(browser))
    assert.throws(() => authorizeTtsRequest({ headers: {} }), { status: 401 })
    assert.equal((await POST(request(token + 'a'))).status, 401)
    assert.equal((await POST(request(token, 'https://other.example.invalid'))).status, 401)
    assert.equal((await POST(new Request(origin + '/api/tts/device', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' }, body: JSON.stringify({ token }) }))).status, 401)
    const start = originalNow()
    Date.now = () => start + 601000
    assert.equal((await POST(request())).status, 401)
    Date.now = () => start + 29 * 86400000
    const renewed = renewTtsSession(browser)
    assert.ok(renewed)
    Date.now = () => start + 40 * 86400000
    assert.equal(isTtsSessionActive(browser), false)
    assert.equal(isTtsSessionActive({ headers: { cookie: renewed.split(';')[0] } }), true)
    assert.equal(renewTtsSession({ headers: {} }), null)
    process.env.TTS_OPERATOR_PASSPHRASE = 'fictitious-rotated-administration-secret'
    assert.equal(isTtsSessionActive({ headers: { cookie: renewed.split(';')[0] } }), false)
  } finally {
    Date.now = originalNow
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]
    Object.assign(process.env, original)
  }
})
