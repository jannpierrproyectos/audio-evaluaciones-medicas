import { getTtsConfiguration } from '../../server/ttsService.js'
import { authorizeTtsRequest } from '../../server/ttsAccess.js'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    authorizeTtsRequest(request)
    return Response.json(await getTtsConfiguration(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: 'No se pudo comprobar la configuración o el acceso institucional TTS.' }, { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
