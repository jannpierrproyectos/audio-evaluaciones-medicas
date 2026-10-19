// An in-memory capability granted only by the locally started Vite backend.
// No service secret is returned to the browser or persisted in JavaScript storage.
const trustedRequests = new WeakSet()
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export function grantLocalTtsAccess(request) {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return false
  if (!loopback.has(request.socket?.remoteAddress) || !loopback.has(request.socket?.localAddress)) return false
  if (Object.keys(request.headers || {}).some(key => key.toLowerCase().startsWith('x-forwarded-'))) return false
  const host = request.headers?.host
  if (host !== `127.0.0.1:${request.socket.localPort}`) return false
  if (request.headers.origin !== `http://${host}`) return false
  const site = request.headers['sec-fetch-site']
  if (site && site !== 'same-origin') return false
  trustedRequests.add(request)
  return true
}
export function hasLocalTtsAccess(request) { return trustedRequests.has(request) }
