const DEFAULT_TTS_ROUTE = '/synthesize'
const DEFAULT_MIME_TYPE = 'audio/wav'

function normalizeServiceUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/g, '')
}

function getTtsServiceUrl() {
  return normalizeServiceUrl(
    process.env.TTS_SERVICE_URL || process.env.VITE_TTS_SERVICE_URL,
  )
}

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

function createFilename(filenameHint, mimeType = DEFAULT_MIME_TYPE) {
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

function createPcmSample(sampleIndex, sampleRate, durationSeconds) {
  const time = sampleIndex / sampleRate
  const fadeOutStart = durationSeconds * 0.8
  const fadeFactor =
    time > fadeOutStart
      ? Math.max(0, 1 - (time - fadeOutStart) / (durationSeconds - fadeOutStart))
      : 1

  return Math.sin(2 * Math.PI * 220 * time) * 0.18 * fadeFactor
}

function createMockWavBuffer(durationSeconds = 1.2, sampleRate = 22050) {
  const sampleCount = Math.floor(sampleRate * durationSeconds)
  const bytesPerSample = 2
  const dataSize = sampleCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28)
  buffer.writeUInt16LE(bytesPerSample, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const pcmValue = Math.max(
      -1,
      Math.min(1, createPcmSample(sampleIndex, sampleRate, durationSeconds)),
    )

    buffer.writeInt16LE(
      Math.round(pcmValue * 32767),
      44 + sampleIndex * bytesPerSample,
    )
  }

  return buffer
}

function createMockTtsPayload(filenameHint) {
  return {
    audioBuffer: createMockWavBuffer(),
    filename: createFilename(filenameHint, DEFAULT_MIME_TYPE),
    mimeType: DEFAULT_MIME_TYPE,
    source: 'mock',
    provider: 'mock-coqui-contract',
  }
}

async function readErrorMessage(response) {
  const responseText = await response.text().catch(() => '')

  if (!responseText) {
    return `El servicio TTS externo devolvio un error (${response.status}).`
  }

  try {
    const payload = JSON.parse(responseText)
    return (
      payload.detail ||
      payload.error ||
      `El servicio TTS externo devolvio un error (${response.status}).`
    )
  } catch {
    return responseText
  }
}

async function requestExternalTts({ text, filenameHint }) {
  const serviceUrl = getTtsServiceUrl()

  if (!serviceUrl) {
    return createMockTtsPayload(filenameHint)
  }

  const response = await fetch(`${serviceUrl}${DEFAULT_TTS_ROUTE}`, {
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
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const mimeType =
    response.headers.get('content-type')?.split(';')[0] || DEFAULT_MIME_TYPE
  const contentDisposition = response.headers.get('content-disposition')
  const generatedFilename = createFilename(filenameHint, mimeType)
  const filename =
    String(filenameHint || '').trim()
      ? generatedFilename
      : getFilenameFromContentDisposition(contentDisposition) || generatedFilename

  return {
    audioBuffer: Buffer.from(await response.arrayBuffer()),
    filename,
    mimeType,
    source: 'external',
    provider: 'external-tts-service',
  }
}

export async function synthesizeSpeech({ text, filenameHint }) {
  if (!String(text || '').trim()) {
    throw new Error('No se puede generar audio sin texto_final.')
  }

  return requestExternalTts({
    text: String(text).trim(),
    filenameHint,
  })
}
