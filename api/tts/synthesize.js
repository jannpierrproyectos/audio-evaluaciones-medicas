import { synthesizeSpeech } from '../../server/ttsService.js'

export const runtime = 'nodejs'

export async function POST(request) {
  try {
    const payload = await request.json()
    const ttsPayload = await synthesizeSpeech({
      text: payload.text,
      filenameHint: payload.filename_hint,
    })

    return new Response(ttsPayload.audioBuffer, {
      headers: {
        'Content-Type': ttsPayload.mimeType,
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${ttsPayload.filename}"`,
      },
    })
  } catch (error) {
    console.error('Error sintetizando audio TTS', error)

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo generar el audio desde el servicio TTS.',
      },
      {
        status: 500,
      },
    )
  }
}
