import { synthesizeSpeech, getTtsConfiguration } from './ttsService.js'
import { authorizeTtsRequest, authorizeTtsConfigurationRequest, MAX_TTS_BODY_BYTES, ttsAccessError } from './ttsAccess.js'
import { createTtsSession, clearTtsSession, ttsSessionState } from './ttsSession.js'

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
  response.setHeader('X-TTS-Configuration', payload.configuration || '')
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="${payload.filename}"`,
  )
  response.end(payload.audioBuffer)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = ''
    let size = 0

    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_TTS_BODY_BYTES) { reject(ttsAccessError(413, 'TTS_BODY_TOO_LARGE')); return }
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
      server.middlewares.use('/api/tts/session', async (request, response) => {
        response.setHeader('Cache-Control', 'no-store')
        if (request.method === 'GET') return writeJsonResponse(response, 200, ttsSessionState(request))
        if (request.method === 'DELETE') {
          response.setHeader('Set-Cookie', clearTtsSession(request))
          return writeJsonResponse(response, 200, { authenticated: false })
        }
        if (request.method !== 'POST') return writeJsonResponse(response, 405, { error: 'Método no permitido.' })
        try {
          if (String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw ttsAccessError(415, 'TTS_JSON_REQUIRED')
          const body = await readJsonBody(request)
          response.setHeader('Set-Cookie', createTtsSession(request, body.passphrase))
          return writeJsonResponse(response, 200, { authenticated: true })
        } catch { return writeJsonResponse(response, 401, { error: 'No se pudo iniciar sesión TTS.' }) }
      })
      server.middlewares.use('/api/tts/configuration', async (request, response) => {
        if (request.method !== 'GET') return writeJsonResponse(response, 405, { error: 'Usa GET.' })
        try { authorizeTtsConfigurationRequest(); writeJsonResponse(response, 200, await getTtsConfiguration()) }
        catch (error) { writeJsonResponse(response, error.status || 503, { error: 'Configuración o acceso institucional TTS no disponible.' }) }
      })
      server.middlewares.use('/api/tts/synthesize', async (request, response) => {
        if (request.method !== 'POST') {
          writeJsonResponse(response, 405, {
            error: 'Metodo no permitido. Usa POST para sintetizar audio.',
          })
          return
        }

        try {
          authorizeTtsRequest(request)
          if (String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw ttsAccessError(415, 'TTS_JSON_REQUIRED')
          const body = await readJsonBody(request)
          const payload = await synthesizeSpeech({
            text: body.text,
            filenameHint: body.filename_hint,
          })

          writeAudioResponse(response, payload)
        } catch (error) {
          console.error('TTS_REQUEST_FAILED')
          writeJsonResponse(response, error.status || 500, {
            error: 'No se pudo completar TTS. Si la solicitud comenzó, su resultado puede ser incierto; revisa el estado antes de reintentar.',
          })
        }
      })
    },
  }
}
