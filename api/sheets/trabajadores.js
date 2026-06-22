import { readWorkersFromGoogleSheets } from '../../server/sheetsService.js'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const payload = await readWorkersFromGoogleSheets()

    return Response.json(payload, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Error leyendo trabajadores desde Google Sheets', error)

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los trabajadores desde Google Sheets.',
      },
      {
        status: 500,
      },
    )
  }
}
