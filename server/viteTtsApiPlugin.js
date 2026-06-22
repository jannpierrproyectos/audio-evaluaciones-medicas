import { synthesizeSpeech } from './ttsService.js'

function writeJsonResponse(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function writeAudioResponse(response, payload) {
  response.statusCode = 200
  response.setHeader('Content-Type', payload.mimeType)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${payload.filename}"`,
  )
  response.end(payload.audioBuffer)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = ''

    request.on('data', (chunk) => {
      rawBody += chunk
    })

    request.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {})
      } catch (error) {
        reject(error)
      }
    })

    request.on('error', reject)
  })
}

export function viteTtsApiPlugin() {
  return {
    name: 'vite-tts-api',
    configureServer(server) {
      server.middlewares.use('/api/tts/synthesize', async (request, response) => {
        if (request.method !== 'POST') {
          writeJsonResponse(response, 405, {
            error: 'Metodo no permitido. Usa POST para sintetizar audio.',
          })
          return
        }

        try {
          const body = await readJsonBody(request)
          const payload = await synthesizeSpeech({
            text: body.text,
            filenameHint: body.filename_hint,
          })

          writeAudioResponse(response, payload)
        } catch (error) {
          console.error('Error sintetizando audio TTS en Vite dev', error)
          writeJsonResponse(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'No se pudo generar el audio desde el servicio TTS.',
          })
        }
      })
    },
  }
}
