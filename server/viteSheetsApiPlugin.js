import { readWorkersFromGoogleSheets } from './sheetsService.js'
import { requireInstitutionalAccess } from './ttsAccess.js'

function writeJsonResponse(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

export function viteSheetsApiPlugin() {
  return {
    name: 'vite-sheets-api',
    configureServer(server) {
      server.middlewares.use('/api/sheets/trabajadores', async (request, response) => {
        if (request.method !== 'GET') {
          writeJsonResponse(response, 405, {
            error: 'Metodo no permitido. Usa GET para consultar trabajadores.',
          })
          return
        }

        try {
          requireInstitutionalAccess(request)
          const payload = await readWorkersFromGoogleSheets()
          writeJsonResponse(response, 200, payload)
        } catch (error) {
          console.error('SHEETS_REQUEST_FAILED')
          writeJsonResponse(response, error.status || 500, {
            error: 'No se pudieron cargar los trabajadores. Revisa la configuración del servicio Sheets en backend.',
          })
        }
      })
    },
  }
}
