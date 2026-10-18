import { clearTtsSession, createTtsSession, ttsSessionState } from '../../server/ttsSession.js'
export const runtime = 'nodejs'
const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request) { return Response.json(ttsSessionState(request), { headers: noStore }) }
export async function POST(request) {
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return Response.json({ error: 'Contenido incorrecto.' }, { status: 415, headers: noStore })
    }
    const data = await request.text()
    if (data.length > 1024) return Response.json({ error: 'Solicitud demasiado grande.' }, { status: 413, headers: noStore })
    const password = JSON.parse(data).passphrase
    const cookie = createTtsSession(request, password)
    return Response.json({ authenticated: true }, { headers: { ...noStore, 'Set-Cookie': cookie } })
  } catch (error) {
    return Response.json({ error: 'No se pudo iniciar sesión TTS.' }, { status: error.status || 401, headers: noStore })
  }
}
export async function DELETE(request) {
  return Response.json({ authenticated: false }, { headers: { ...noStore, 'Set-Cookie': clearTtsSession(request) } })
}
