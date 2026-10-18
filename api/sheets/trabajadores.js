import { readWorkersFromGoogleSheets } from '../../server/sheetsService.js'
import { requireInstitutionalAccess } from '../../server/ttsAccess.js'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    requireInstitutionalAccess(request)
    const payload = await readWorkersFromGoogleSheets()

    return Response.json(payload, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('SHEETS_REQUEST_FAILED')

    return Response.json(
      {
        error: 'No se pudieron cargar los trabajadores. Revisa la configuración del servicio Sheets en backend.',
      },
      {
        status: error.status || 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
}
