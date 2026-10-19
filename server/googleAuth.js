import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'

export const GOOGLE_ALLOWED_EMAIL = 'jannpierr.proyectos@gmail.com'
const SESSION = 'ae_google_session'
const TRANSACTION = 'ae_google_oauth'
const SESSION_TTL = 30 * 86400
const FLOW_TTL = 600
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const header = (request, name) => typeof request?.headers?.get === 'function' ? request.headers.get(name) : request?.headers?.[name]
const now = () => Math.floor(Date.now() / 1000)
const failure = code => Object.assign(new Error(code), { code })
export function googleAuthEnabled() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_REDIRECT_URI)
}
export function googleAuthConfigured() {
  try { configuration(); return true } catch { return false }
}
function configuration() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || ''
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || ''
  const secret = process.env.GOOGLE_AUTH_SESSION_SECRET || ''
  const url = new URL(redirectUri)
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && !process.env.VERCEL && process.env.NODE_ENV !== 'production'
  if (!clientId.endsWith('.apps.googleusercontent.com') || !clientSecret || secret.length < 32 ||
      (!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/api/auth/google-callback') throw failure('GOOGLE_NOT_CONFIGURED')
  return { clientId, clientSecret, redirectUri, secret, origin: url.origin }
}
function sign(payload, purpose) {
  return createHmac('sha256', configuration().secret).update(`AudioEvaluaciones/google/${purpose}/v1:${payload}`).digest('base64url')
}
function seal(data, purpose) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${payload}.${sign(payload, purpose)}`
}
function unseal(token, purpose, ttl) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null
    const parts = token.split('.')
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null
    const expected = sign(parts[0], purpose)
    if (!timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return null
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (!Number.isSafeInteger(value.expires) || value.expires <= now() || value.expires > now() + ttl) return null
    return value
  } catch { return null }
}
function readCookie(request, name) {
  return String(header(request, 'cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) || ''
}
function cookie(name, token, ttl, sameSite = 'Strict') {
  const secure = configuration().origin.startsWith('https:') ? '; Secure' : ''
  return `${name}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${ttl}${secure}`
}
export function googleSession(request) {
  if (!googleAuthConfigured()) return null
  const value = unseal(readCookie(request, SESSION), 'session', SESSION_TTL)
  return value?.email === GOOGLE_ALLOWED_EMAIL && typeof value.sub === 'string' && value.sub && value.origin === configuration().origin ? value : null
}
function issueSession(identity) {
  return cookie(SESSION, seal({ email: GOOGLE_ALLOWED_EMAIL, sub: identity.sub, origin: configuration().origin, expires: now() + SESSION_TTL, nonce: randomBytes(16).toString('hex') }, 'session'), SESSION_TTL)
}
export function renewGoogleSession(request) {
  const identity = googleSession(request)
  return identity ? issueSession(identity) : null
}
export function clearGoogleSession() { return cookie(SESSION, '', 0) }
function client(config) {
  return new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, transporterOptions: { timeout: 15000 } })
}
function redirect(location, cookies = []) {
  const resultHeaders = new Headers({ ...headers, Location: location })
  for (const value of cookies) resultHeaders.append('Set-Cookie', value)
  return new Response(null, { status: 303, headers: resultHeaders })
}

// Google performs cryptographic JWT verification in its maintained library.
// A factory seam allows isolated signed-token tests without contacting Google.
export function createGoogleAuthHandlers(createClient = client) {
  return {
    async start(request) {
      try {
        const config = configuration()
        if (new URL(request.url).origin !== config.origin) throw failure('GOOGLE_ORIGIN_INVALID')
        const oauth = createClient(config)
        const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync()
        const transaction = { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier: codeVerifier, expires: now() + FLOW_TTL }
        const location = oauth.generateAuthUrl({ response_type: 'code', access_type: 'online', scope: ['openid', 'email'], state: transaction.state, nonce: transaction.nonce,
          code_challenge: codeChallenge, code_challenge_method: 'S256', prompt: 'select_account', login_hint: GOOGLE_ALLOWED_EMAIL })
        return redirect(location, [cookie(TRANSACTION, seal(transaction, 'transaction'), FLOW_TTL, 'Lax')])
      } catch { return redirect('/?auth_error=configuration') }
    },
    async callback(request) {
      let config
      try {
        config = configuration()
        const url = new URL(request.url)
        if (url.origin !== config.origin || url.pathname !== '/api/auth/google-callback') throw failure('GOOGLE_ORIGIN_INVALID')
        const transaction = unseal(readCookie(request, TRANSACTION), 'transaction', FLOW_TTL)
        const state = url.searchParams.get('state') || ''
        if (!transaction || !state || state.length > 128 || state !== transaction.state || url.searchParams.get('error')) throw failure('GOOGLE_FLOW_INVALID')
        const code = url.searchParams.get('code') || ''
        if (!code || code.length > 4096) throw failure('GOOGLE_FLOW_INVALID')
        const oauth = createClient(config)
        const { tokens } = await oauth.getToken({ code, codeVerifier: transaction.verifier })
        if (!tokens.id_token) throw failure('GOOGLE_TOKEN_INVALID')
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId })
        const payload = ticket.getPayload()
        if (!payload || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) || payload.aud !== config.clientId ||
            (payload.azp && payload.azp !== config.clientId) || payload.nonce !== transaction.nonce || payload.email_verified !== true ||
            typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || payload.email?.toLowerCase() !== GOOGLE_ALLOWED_EMAIL) throw failure('GOOGLE_ACCOUNT_DENIED')
        // No access/refresh/ID token is stored or exposed to React.
        return redirect('/', [cookie(TRANSACTION, '', 0, 'Lax'), issueSession(payload)])
      } catch (error) {
        const reason = error.code === 'GOOGLE_ACCOUNT_DENIED' ? 'account' : 'signin'
        return redirect(`/?auth_error=${reason}`, config ? [cookie(TRANSACTION, '', 0, 'Lax')] : [])
      }
    },
  }
}
