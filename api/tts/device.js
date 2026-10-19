import { randomBytes } from 'node:crypto'
import { enrollTtsDevice } from '../../server/ttsSession.js'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }

export async function GET() {
  const nonce = randomBytes(16).toString('hex')
  // URL fragments never reach HTTP logs. Clear it before exchanging the link;
  // the capability exists only transiently, never in JS-accessible storage.
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vincular equipo · AudioEvaluaciones</title><body><main><h1>Acceso al audio</h1><p id="status" role="status">Vinculando este navegador…</p></main><script nonce="${nonce}">
const token = location.hash.slice(1); history.replaceState(null, '', location.pathname);
if (!token) document.getElementById('status').textContent = 'Abre el enlace privado de vinculación proporcionado por el administrador.';
else fetch(location.pathname, {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(r => {if(!r.ok) throw Error(); location.replace('/');}).catch(() => {document.getElementById('status').textContent='El enlace venció o no es válido para esta página. Solicita un nuevo enlace al administrador.';});
</script></body></html>`
  return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } })
}
export async function POST(request) {
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return Response.json({ error: 'Contenido incorrecto.' }, { status: 415, headers })
    const reader = request.body?.getReader()
    const chunks = []; let size = 0
    if (reader) while (true) {
      const part = await reader.read(); if (part.done) break
      size += part.value.byteLength
      if (size > 2048) { await reader.cancel(); return Response.json({ error: 'Enlace inválido.' }, { status: 413, headers }) }
      chunks.push(Buffer.from(part.value))
    }
    const { token } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return Response.json({ authenticated: true }, { headers: { ...headers, 'Set-Cookie': enrollTtsDevice(request, token) } })
  } catch {
    return Response.json({ error: 'Enlace de vinculación vencido o inválido.' }, { status: 401, headers })
  }
}
