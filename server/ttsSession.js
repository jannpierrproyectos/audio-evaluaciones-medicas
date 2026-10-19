import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'ae_tts_session'
// Bounded persistent operator session on a trusted workstation; never stored in JS.
const TTL_SECONDS = 30 * 24 * 60 * 60
const fail = (status, code) => Object.assign(new Error(code), { status, code })
const header = (request, name) => typeof request?.headers?.get === 'function' ? request.headers.get(name) : request?.headers?.[name]
function passphrase() {
  const value = process.env.TTS_OPERATOR_PASSPHRASE || ''
  if (value.length < 32) throw fail(503, 'TTS_OPERATOR_ACCESS_NOT_CONFIGURED')
  return value
}
function digest(value) { return createHash('sha256').update(String(value)).digest() }
function secret() { return createHmac('sha256', passphrase()).update('AudioEvaluaciones/TTS/session/v1').digest() }
function signature(payload) { return createHmac('sha256', secret()).update(payload).digest('hex') }
function verified(candidate) {
  const expected = passphrase()
  return typeof candidate === 'string' && candidate.length <= 512 && timingSafeEqual(digest(candidate), digest(expected))
}
function cookieValue(request) {
  const raw = header(request, 'cookie') || ''
  const match = raw.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE_NAME + '='))
  return match?.slice(COOKIE_NAME.length + 1) || ''
}
export function isTtsSessionActive(request) {
  if (!process.env.TTS_OPERATOR_PASSPHRASE || process.env.TTS_OPERATOR_PASSPHRASE.length < 32) return false
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(cookieValue(request))
  if (!match) return false
  const expires = Number(match[1]), now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + TTL_SECONDS) return false
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(signature(match[1] + '.' + match[2])))
}
function isHttps(request) {
  const forwarded = header(request, 'x-forwarded-proto')
  if (forwarded) return forwarded === 'https'
  try { return new URL(request.url).protocol === 'https:' } catch { return false }
}
function sessionCookie(request, value, maxAge) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(request) ? '; Secure' : ''}`
}
export function createTtsSession(request, candidate) {
  if (!verified(candidate)) throw fail(401, 'TTS_OPERATOR_INVALID')
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS
  const nonce = randomBytes(16).toString('hex')
  const payload = expires + '.' + nonce
  return sessionCookie(request, payload + '.' + signature(payload), TTL_SECONDS)
}
export function clearTtsSession(request) { return sessionCookie(request, '', 0) }
export function ttsSessionState(request) {
  return { configured: Boolean(process.env.TTS_OPERATOR_PASSPHRASE?.length >= 32), authenticated: isTtsSessionActive(request) }
}

export function renewTtsSession(request) {
  return isTtsSessionActive(request) ? createTtsSession(request, passphrase()) : null
}

// A short-lived administrator-issued capability, scoped to the exact website.
// The operator never receives the server passphrase or the ElevenLabs key.
function enrollmentSignature(payload) {
  return createHmac('sha256', secret()).update('device-enrollment/v1:' + payload).digest('hex')
}
export function createTtsDeviceLink(origin) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw fail(400, 'TTS_DEVICE_ORIGIN_INVALID')
  const payload = Buffer.from(JSON.stringify({ origin: url.origin, expires: Math.floor(Date.now() / 1000) + 600, nonce: randomBytes(16).toString('hex') })).toString('base64url')
  return `${url.origin}/api/tts/device#${payload}.${enrollmentSignature(payload)}`
}
export function enrollTtsDevice(request, token) {
  if (typeof token !== 'string' || token.length > 1024) throw fail(401, 'TTS_DEVICE_LINK_INVALID')
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token)
  if (!match || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(enrollmentSignature(match[1])))) throw fail(401, 'TTS_DEVICE_LINK_INVALID')
  let data
  try { data = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) } catch { throw fail(401, 'TTS_DEVICE_LINK_INVALID') }
  const now = Math.floor(Date.now() / 1000)
  const origin = new URL(request.url).origin
  if (data.origin !== origin || header(request, 'origin') !== origin || !Number.isSafeInteger(data.expires) || data.expires <= now || data.expires > now + 600) throw fail(401, 'TTS_DEVICE_LINK_INVALID')
  return createTtsSession(request, passphrase())
}
