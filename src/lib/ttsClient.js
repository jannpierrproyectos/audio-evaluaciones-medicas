function getFileExtensionFromMimeType(mimeType) {
  const normalizedMimeType = String(mimeType || '').toLowerCase()

  if (normalizedMimeType.includes('mpeg')) {
    return 'mp3'
  }

  if (normalizedMimeType.includes('wav')) {
    return 'wav'
  }

  return 'wav'
}

function createFilename(filenameHint, mimeType) {
  const safeFilename =
    String(filenameHint || 'audio-evaluacion')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'audio-evaluacion'

  return `${safeFilename}.${getFileExtensionFromMimeType(mimeType)}`
}

function getFilenameFromContentDisposition(contentDisposition) {
  const filenameMatch = String(contentDisposition || '').match(
    /filename\*?=(?:UTF-8''|")?([^";]+)/i,
  )

  if (!filenameMatch) {
    return ''
  }

  return decodeURIComponent(filenameMatch[1].replace(/^"|"$/g, ''))
}

async function readErrorMessage(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}))
    return (
      payload.error ||
      payload.detail ||
      `No se pudo generar el audio (${response.status}).`
    )
  }

  const responseText = await response.text().catch(() => '')
  return responseText || `No se pudo generar el audio (${response.status}).`
}

export async function synthesizeAudioFromText({ text, filenameHint }) {
  const response = await fetch('/api/tts/synthesize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg, audio/wav, audio/x-wav, application/json',
    },
    body: JSON.stringify({
      text,
      language: 'es',
      voice_id: '',
      format: 'mp3',
      filename_hint: filenameHint,
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'audio/wav'
  const blob = await response.blob()
  const audioBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })
  const audioFilename =
    getFilenameFromContentDisposition(response.headers.get('content-disposition')) ||
    createFilename(filenameHint, mimeType)

  return {
    audioUrl: window.URL.createObjectURL(audioBlob),
    audioFilename,
    mimeType,
    source: 'external',
    provider: 'tts-service',
  }
}
