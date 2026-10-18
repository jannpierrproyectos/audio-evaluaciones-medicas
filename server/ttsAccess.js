import { createHash, timingSafeEqual } from 'node:crypto'
import { isTtsSessionActive } from './ttsSession.js'

export const MAX_TTS_BODY_BYTES = 64 * 1024
export const ttsAccessError = (status, code) => Object.assign(new Error('TTS bloqueado: revisa el acceso institucional, la configuración y los límites del backend.'), { status, code })
export function externalTtsUrl() {
  return String(process.env.TTS_SERVICE_URL || process.env.VITE_TTS_SERVICE_URL || '').trim().replace(/\/+$/g, '')
}
// Read-only provider metadata is not a paid synthesis request. The backend
// still requires its own service token and a safe URL before accessing TTS.
export function authorizeTtsConfigurationRequest() {
  if (!externalTtsUrl()) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw ttsAccessError(503, 'TTS_NOT_CONFIGURED')
    return // Local synthetic metadata only.
  }
  ttsServiceHeaders() // Fail closed for missing token or an unsafe service URL.
}

export function authorizeTtsRequest(request) {
  if (!externalTtsUrl()) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw ttsAccessError(503, 'TTS_NOT_CONFIGURED')
    return // Local synthetic WAV only; never a provider call.
  }
  if (String(process.env.TTS_SERVICE_ACCESS_TOKEN || '').length < 32) throw ttsAccessError(503, 'TTS_ACCESS_NOT_CONFIGURED')
  if (isTtsSessionActive(request)) return
  if (String(process.env.INSTITUTIONAL_PROXY_TOKEN || '').length >= 32) return requireInstitutionalAccess(request)
  throw ttsAccessError(401, 'TTS_OPERATOR_SESSION_REQUIRED')
}
export function requireInstitutionalAccess(request) {
  const expected = process.env.INSTITUTIONAL_PROXY_TOKEN || ''
  if (expected.length < 32) throw ttsAccessError(503, 'INSTITUTIONAL_ACCESS_NOT_CONFIGURED')
  const supplied = typeof request.headers?.get === 'function' ? request.headers.get('authorization') : request.headers?.authorization
  const digest = value => createHash('sha256').update(String(value || '')).digest()
  if (!timingSafeEqual(digest(supplied), digest(`Bearer ${expected}`))) throw ttsAccessError(401, 'TTS_UNAUTHORIZED')
}
export function ttsServiceHeaders() {
  const token = process.env.TTS_SERVICE_ACCESS_TOKEN || ''
  if (token.length < 32) throw ttsAccessError(503, 'TTS_ACCESS_NOT_CONFIGURED')
  const url = new URL(externalTtsUrl())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw ttsAccessError(503, 'TTS_UNSAFE_URL')
  return { Authorization: `Bearer ${token}` }
}
export function validateTtsText(text) {
  const limit = Number(process.env.TTS_MAX_CHARACTERS || 5000)
  if (!Number.isInteger(limit) || limit < 1 || limit > 20000) throw ttsAccessError(503, 'TTS_LIMIT_INVALID')
  if (typeof text !== 'string' || !text.trim()) throw ttsAccessError(400, 'TTS_TEXT_INVALID')
  if (text.length > limit) throw ttsAccessError(413, 'TTS_TEXT_TOO_LARGE')
}
