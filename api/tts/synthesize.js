import { synthesizeSpeech } from '../../server/ttsService.js'
import { authorizeTtsRequest, MAX_TTS_BODY_BYTES, ttsAccessError } from '../../server/ttsAccess.js'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    authorizeTtsRequest(request)
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw ttsAccessError(415, 'TTS_JSON_REQUIRED')
    const length = Number(request.headers.get('content-length'))
    if (length > MAX_TTS_BODY_BYTES) throw ttsAccessError(413, 'TTS_BODY_TOO_LARGE')
    const reader = request.body?.getReader(); const chunks = []; let size = 0
    if (reader) {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_TTS_BODY_BYTES) { await reader.cancel(); throw ttsAccessError(413, 'TTS_BODY_TOO_LARGE') }; chunks.push(Buffer.from(chunk.value)) }
    }
    let payload
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw ttsAccessError(400, 'TTS_JSON_INVALID') }
    const ttsPayload = await synthesizeSpeech({
      text: payload.text,
      filenameHint: payload.filename_hint,
    })

    return new Response(ttsPayload.audioBuffer, {
      headers: {
        'Content-Type': ttsPayload.mimeType,
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${ttsPayload.filename}"`,
        'X-TTS-Configuration': ttsPayload.configuration || '',
      },
    })
  } catch (error) {
    console.error('TTS_REQUEST_FAILED')
    const needsGoogle = error.status === 401 && error.code === 'TTS_GOOGLE_LOGIN_REQUIRED'
    const needsDevice = error.status === 401 && ['TTS_OPERATOR_SESSION_REQUIRED', 'TTS_UNAUTHORIZED'].includes(error.code)

    return Response.json(
      {
        error: needsGoogle ? 'Continúa con tu cuenta de Google para generar audio. No se ha solicitado ni cobrado ninguna síntesis.' : needsDevice ? 'Este navegador aún no está vinculado. Abre el enlace privado de vinculación del equipo; después podrás generar audios sin contraseña.' : 'No se pudo completar TTS. Si la solicitud comenzó, su resultado puede ser incierto; revisa el estado antes de reintentar.',
        ...(needsGoogle ? { code: 'TTS_GOOGLE_LOGIN_REQUIRED' } : needsDevice ? { code: 'TTS_DEVICE_NOT_LINKED' } : {}),
      },
      {
        status: error.status || 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
}
