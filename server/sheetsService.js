import { createSign } from 'node:crypto'
import {
  SHEET_TAB_NAME,
  hasRowContent,
  normalizeHeader,
  normalizeWorkerRecord,
  sanitizeCellValue,
} from '../src/lib/workerRecords.js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const REQUIRED_ENV_VARS = [
  'GOOGLE_SHEET_ID',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_PROJECT_ID',
]

function getMissingEnvVars() {
  return REQUIRED_ENV_VARS.filter((envVar) => {
    const value = process.env[envVar]
    return typeof value !== 'string' || value.trim() === ''
  })
}

function base64UrlEncode(value) {
  const rawValue =
    typeof value === 'string' ? value : JSON.stringify(value)

  return Buffer.from(rawValue)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function getGoogleCredentials() {
  const missingEnvVars = getMissingEnvVars()

  if (missingEnvVars.length > 0) {
    throw new Error(
      [
        'Faltan variables de entorno para Google Sheets.',
        `Variables faltantes: ${missingEnvVars.join(', ')}.`,
        'En local, revisa .env.local y reinicia npm run dev.',
        'En Vercel, revisa Project Settings > Environment Variables.',
      ].join(' '),
    )
  }

  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY.trim()

  return {
    sheetId: process.env.GOOGLE_SHEET_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    projectId: process.env.GOOGLE_PROJECT_ID,
    privateKey: rawPrivateKey
      .replace(/^"+|"+$/g, '')
      .replace(/\\n/g, '\n'),
  }
}

function createServiceAccountJwt(clientEmail, privateKey) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }
  const payload = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: expiresAt,
    iat: issuedAt,
  }
  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`
  const signer = createSign('RSA-SHA256')

  signer.update(unsignedToken)
  signer.end()

  const signature = signer
    .sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

  return `${unsignedToken}.${signature}`
}

async function fetchGoogleAccessToken(credentials) {
  const assertion = createServiceAccountJwt(
    credentials.clientEmail,
    credentials.privateKey,
  )
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Google OAuth rechazo la autenticacion (${response.status}): ${errorText}`,
    )
  }

  const payload = await response.json()

  return payload.access_token
}

async function fetchSheetRows(sheetId, accessToken) {
  const range = encodeURIComponent(`${SHEET_TAB_NAME}!A:ZZ`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Google Sheets no pudo leer la pestaña ${SHEET_TAB_NAME} (${response.status}): ${errorText}`,
    )
  }

  const payload = await response.json()

  return Array.isArray(payload.values) ? payload.values : []
}

function mapRowsToRecords(rows) {
  if (rows.length === 0) {
    return []
  }

  const headers = rows[0].map((value) => normalizeHeader(value))

  return rows.slice(1).flatMap((row, index) => {
    if (!hasRowContent(row)) {
      return []
    }

    const rawRecord = {}

    headers.forEach((header, cellIndex) => {
      if (!header) {
        return
      }

      rawRecord[header] = sanitizeCellValue(row[cellIndex])
    })

    return [normalizeWorkerRecord(rawRecord, index + 2)]
  })
}

export async function readWorkersFromGoogleSheets() {
  const credentials = getGoogleCredentials()
  const accessToken = await fetchGoogleAccessToken(credentials)
  const rows = await fetchSheetRows(credentials.sheetId, accessToken)
  const records = mapRowsToRecords(rows)

  return {
    sheetName: SHEET_TAB_NAME,
    projectId: credentials.projectId,
    count: records.length,
    records,
  }
}
