import { readWorkersFromGoogleSheets } from './sheetsService.js'

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
          const payload = await readWorkersFromGoogleSheets()
          writeJsonResponse(response, 200, payload)
        } catch (error) {
          console.error('Error leyendo trabajadores en Vite dev', error)
          writeJsonResponse(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'No se pudieron cargar los trabajadores desde Google Sheets.',
          })
        }
      })
    },
  }
}
