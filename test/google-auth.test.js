import assert from 'node:assert/strict'
import { test } from 'node:test'
import { googleAuthFixture } from '../test-support/googleAuthFixture.js'
import { googleSession, googleAuthConfigured, renewGoogleSession } from '../server/googleAuth.js'
import { createTtsSession, isTtsSessionActive, ttsSessionState, renewTtsSession, clearTtsSession } from '../server/ttsSession.js'
import { authorizeTtsRequest } from '../server/ttsAccess.js'
import { grantLocalTtsAccess } from '../server/localTtsAccess.js'

test('Google: code + state + nonce + PKCE, real signed ID token, private persistent session and logout', async () => {
  const fixture = googleAuthFixture()
  const originalNow = Date.now
  try {
    const flow = await fixture.begin()
    assert.equal(flow.location.origin, 'https://accounts.google.com')
    assert.equal(flow.location.searchParams.get('scope'), 'openid email')
    assert.equal(flow.location.searchParams.get('code_challenge_method'), 'S256')
    assert.match(flow.response.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax; Max-Age=600; Secure/)
    assert.ok(!flow.location.href.includes('fictitious-client-secret'))
    const response = await fixture.callback(flow)
    assert.equal(response.headers.get('location'), '/')
    const cookies = response.headers.getSetCookie()
    assert.equal(cookies.length, 2)
    assert.match(cookies[0], /Max-Age=0/)
    assert.match(cookies[1], /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/)
    assert.ok(!cookies.join('').includes('never-retained'))
    const request = { headers: { cookie: cookies[1].split(';')[0] } }
    assert.equal(googleSession(request).sub, 'fictitious-stable-google-id')
    assert.equal(isTtsSessionActive(request), true)
    assert.equal(ttsSessionState(request).provider, 'google')
    assert.equal(ttsSessionState(request).email, 'jannpierr.proyectos@gmail.com')
    const start = originalNow()
    Date.now = () => start + 29 * 86400000
    const renewed = renewTtsSession(request)
    assert.ok(renewed)
    Date.now = () => start + 40 * 86400000
    assert.equal(isTtsSessionActive(request), false)
    const refreshed = { headers: { cookie: renewed.split(';')[0] } }
    assert.equal(isTtsSessionActive(refreshed), true)
    assert.equal(renewGoogleSession({ headers: {} }), null)
    assert.equal(isTtsSessionActive({ headers: { cookie: clearTtsSession(refreshed).split(';')[0] } }), false)
    process.env.GOOGLE_AUTH_SESSION_SECRET = 'another-fictitious-secret-for-test-rotation'
    assert.equal(isTtsSessionActive(refreshed), false)
  } finally { Date.now = originalNow; fixture.restore() }
})

for (const [name, claims, badSignature] of [
  ['different account', { email: 'other@gmail.com' }],
  ['unverified email', { email_verified: false }],
  ['wrong audience', { aud: 'other-client' }],
  ['wrong issuer', { iss: 'https://attacker.invalid' }],
  ['expired token', { exp: Math.floor(Date.now() / 1000) - 900 }],
  ['wrong nonce', { nonce: 'incorrect' }],
  ['missing stable identity', { sub: '' }],
  ['wrong authorized party', { azp: 'other-client' }],
  ['forged signature', {}, true],
]) test(`Google rejects ${name} without issuing a session`, async () => {
  const fixture = googleAuthFixture()
  try {
    const flow = await fixture.begin(); fixture.claims(claims)
    if (badSignature) fixture.badSignature()
    const response = await fixture.callback(flow)
    assert.match(response.headers.get('location'), /^\/\?auth_error=/)
    assert.equal(response.headers.getSetCookie().some(cookie => cookie.startsWith('ae_google_session=')), false)
  } finally { fixture.restore() }
})

test('Google rejects missing/mismatched/expired browser state before exchanging any code', async () => {
  const fixture = googleAuthFixture(); const originalNow = Date.now
  try {
    const flow = await fixture.begin()
    await fixture.callback(flow, {}, '')
    await fixture.callback(flow, { state: 'wrong' })
    await fixture.callback(flow, { error: 'access_denied' })
    Date.now = () => originalNow() + 601000
    await fixture.callback(flow)
    assert.equal(fixture.exchanges, 0)
  } finally { Date.now = originalNow; fixture.restore() }
})

test('Google mode disables legacy passwords, device links, institutional bearer and local shortcuts; partial configuration fails closed', async () => {
  const fixture = googleAuthFixture()
  try {
    Object.assign(process.env, { TTS_SERVICE_URL: 'https://service.invalid', TTS_SERVICE_ACCESS_TOKEN: 'fictitious-service-secret-0123456789', TTS_LEGACY_MODE: '', INSTITUTIONAL_PROXY_TOKEN: 'fictitious-institutional-secret-0123456789' })
    assert.throws(() => createTtsSession({}, 'old-password'), { code: 'TTS_GOOGLE_LOGIN_REQUIRED' })
    const local = { headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', authorization: `Bearer ${process.env.INSTITUTIONAL_PROXY_TOKEN}` }, socket: { localPort: 5173, localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' } }
    grantLocalTtsAccess(local)
    assert.throws(() => authorizeTtsRequest(local), { status: 401, code: 'TTS_GOOGLE_LOGIN_REQUIRED' })
    delete process.env.GOOGLE_AUTH_SESSION_SECRET
    assert.equal(googleAuthConfigured(), false)
    assert.equal(isTtsSessionActive(local), false)
    assert.equal((await fixture.handlers.start(new Request(fixture.origin + '/api/auth/google'))).headers.get('location'), '/?auth_error=configuration')
  } finally { fixture.restore() }
})
