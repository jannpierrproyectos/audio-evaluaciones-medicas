import { getTtsConfiguration } from '../../server/ttsService.js'
import { authorizeTtsConfigurationRequest } from '../../server/ttsAccess.js'
import { renewTtsSession } from '../../server/ttsSession.js'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    authorizeTtsConfigurationRequest()
    const cookie = renewTtsSession(request)
    return Response.json(await getTtsConfiguration(), { headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })
  } catch (error) {
    return Response.json({ error: 'No se pudo comprobar la configuración o el acceso institucional TTS.' }, { status: error.status || 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
