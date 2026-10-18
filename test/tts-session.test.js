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
  TTS_OPERATOR_PASSPHRASE: 'fictitious-operator-very-long-secret-passphrase',
  TTS_SERVICE_ACCESS_TOKEN: 'fictitious-service-long-connection-token',
  TTS_SERVICE_URL: 'https://example.invalid', INSTITUTIONAL_PROXY_TOKEN: '',
}
const req = { url: 'https://app.example.invalid/api/tts/session', headers: { get(k) { return k === 'cookie' ? this.cookie || '' : k === 'x-forwarded-proto' ? 'https' : '' } } }
test('signed operator session allows paid request without exposing a bearer', () => {
  withEnv(opts, () => {
    const cookie = createTtsSession(req, opts.TTS_OPERATOR_PASSPHRASE)
    assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/)
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
