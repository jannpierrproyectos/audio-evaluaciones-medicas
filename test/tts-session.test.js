import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTtsSession, clearTtsSession, isTtsSessionActive, ttsSessionState } from '../server/ttsSession.js'
import { authorizeTtsRequest } from '../server/ttsAccess.js'
function withEnv(settings, fn) {
  const original = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]]))
  try { Object.assign(process.env, settings); return fn() }
  finally { for (const [key, val] of Object.entries(original)) val === undefined ? delete process.env[key] : process.env[key] = val }
}
const opts = {
  // Keep compatibility fixtures independent of Google credentials in Vercel.
  GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', GOOGLE_OAUTH_REDIRECT_URI: '', GOOGLE_AUTH_SESSION_SECRET: '',
  TTS_LEGACY_MODE: '', // Explicitly isolate these token-mode tests from Preview env.
  TTS_OPERATOR_PASSPHRASE: 'fictitious-operator-very-long-secret-passphrase',
  TTS_SERVICE_ACCESS_TOKEN: 'fictitious-service-long-connection-token',
  TTS_SERVICE_URL: 'https://example.invalid', INSTITUTIONAL_PROXY_TOKEN: '',
}
const req = { url: 'https://app.example.invalid/api/tts/session', headers: { get(k) { return k === 'cookie' ? this.cookie || '' : k === 'x-forwarded-proto' ? 'https' : '' } } }
test('signed operator session allows paid request without exposing a bearer', () => {
  withEnv(opts, () => {
    const cookie = createTtsSession(req, opts.TTS_OPERATOR_PASSPHRASE)
    assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/)
    const sessionRequest = { headers: { cookie: cookie.split(';')[0] } }
    assert.equal(isTtsSessionActive(sessionRequest), true)
    assert.doesNotThrow(() => authorizeTtsRequest(sessionRequest))
    assert.equal(ttsSessionState(sessionRequest).authenticated, true)
    assert.equal(isTtsSessionActive({ headers: { cookie: clearTtsSession(req) } }), false)
  })
})
test('incorrect password and anonymous synthesis are rejected', () => {
  withEnv(opts, () => {
    assert.throws(() => createTtsSession(req, 'incorrect-password'), { status: 401 })
    assert.throws(() => authorizeTtsRequest({ headers: { cookie: '' } }), { status: 401, code: 'TTS_OPERATOR_SESSION_REQUIRED' })
  })
})
test('unconfigured operator access fails closed', () => {
  withEnv({ ...opts, TTS_OPERATOR_PASSPHRASE: '' }, () => {
    assert.equal(ttsSessionState(req).configured, false)
    assert.throws(() => createTtsSession(req, 'test'), { status: 503 })
  })
})

test('scenario 9: trusted browser remains authorized after a day, expires at 30 days and rejects tampering', () => {
  withEnv(opts, () => {
    const originalNow = Date.now
    const now = originalNow()
    try {
      Date.now = () => now
      const cookie = createTtsSession(req, opts.TTS_OPERATOR_PASSPHRASE).split(';')[0]
      Date.now = () => now + 24 * 60 * 60 * 1000
      assert.equal(isTtsSessionActive({ headers: { cookie } }), true)
      const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a')
      assert.equal(isTtsSessionActive({ headers: { cookie: tampered } }), false)
      assert.throws(() => authorizeTtsRequest({ headers: {} }), { status: 401 })
      Date.now = () => now + 30 * 24 * 60 * 60 * 1000
      assert.equal(isTtsSessionActive({ headers: { cookie } }), false)
    } finally { Date.now = originalNow }
  })
})
