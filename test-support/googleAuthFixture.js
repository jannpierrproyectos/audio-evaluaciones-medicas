import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { createGoogleAuthHandlers, GOOGLE_ALLOWED_EMAIL } from '../server/googleAuth.js'

export function googleAuthFixture(origin = 'https://audio-evaluaciones-medicas.vercel.app') {
  const original = { ...process.env }
  Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: 'fictitious-client.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'fictitious-client-secret', GOOGLE_AUTH_SESSION_SECRET: 'fictitious-session-secret-for-google-tests-only', GOOGLE_OAUTH_REDIRECT_URI: origin + '/api/auth/google-callback' })
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const keys = { fixture: publicKey.export({ type: 'spki', format: 'pem' }) }
  const transactions = new Map()
  const usedCodes = new Set()
  let overrides = {}, tamperSignature = false, exchanges = 0
  const handlers = createGoogleAuthHandlers(config => {
    const client = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri })
    const generate = client.generateAuthUrl.bind(client)
    client.generateAuthUrl = options => {
      transactions.set(options.state, { nonce: options.nonce, challenge: options.code_challenge })
      return generate(options)
    }
    client.getToken = async ({ code, codeVerifier }) => {
      exchanges++
      assert.equal(usedCodes.has(code), false, 'Google authorization code is single-use')
      usedCodes.add(code)
      const transaction = transactions.get(code)
      assert.ok(transaction)
      assert.equal(createHash('sha256').update(codeVerifier).digest('base64url'), transaction.challenge)
      const now = Math.floor(Date.now() / 1000)
      const header = Buffer.from(JSON.stringify({ kid: 'fixture', alg: 'RS256' })).toString('base64url')
      const body = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: config.clientId, sub: 'fictitious-stable-google-id', email: GOOGLE_ALLOWED_EMAIL, email_verified: true, nonce: transaction.nonce, iat: now, exp: now + 3600, ...overrides })).toString('base64url')
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')
      return { tokens: { id_token: `${header}.${body}.${tamperSignature ? signature.slice(0, -4) + 'xxxx' : signature}`, access_token: 'never-retained' } }
    }
    // Only Google's network key discovery is replaced. The library's real
    // signature/issuer/audience/expiry verification executes against this key.
    client.getFederatedSignonCertsAsync = async () => ({ certs: keys })
    return client
  })
  return {
    handlers, transactions, origin,
    get exchanges() { return exchanges },
    claims(value) { overrides = value },
    badSignature() { tamperSignature = true },
    async begin() {
      const response = await handlers.start(new Request(origin + '/api/auth/google'))
      const location = new URL(response.headers.get('location'))
      const state = location.searchParams.get('state')
      return { response, location, state, cookie: response.headers.getSetCookie()[0].split(';')[0] }
    },
    callback(flow, params = {}, cookie = flow.cookie) {
      const url = new URL('/api/auth/google-callback', origin)
      for (const [key, value] of Object.entries({ code: flow.state, state: flow.state, ...params })) url.searchParams.set(key, value)
      return handlers.callback(new Request(url, { headers: { cookie } }))
    },
    restore() {
      for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]
      Object.assign(process.env, original)
    },
  }
}
