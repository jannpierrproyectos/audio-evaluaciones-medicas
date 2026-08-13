import { useEffect, useState } from 'react'
import { applyLocalAppFields, createDraftText } from '../lib/workerRecords.js'
import { DEFAULT_DRAFT_TEXT_STYLE } from '../lib/draftNarrative.js'
import { synthesizeAudioFromText } from '../lib/ttsClient.js'
import DetailPanel from './DetailPanel.jsx'
import RecordsTable from './RecordsTable.jsx'

const tableColumns = [
  'Nombre',
  'Empresa',
  'Ficha',
  'Aptitud',
  'Estado del texto',
  'Estado del audio',
]

const INITIAL_ERROR =
  'Hubo un problema al consultar Google Sheets. Revisa las credenciales, el acceso de la cuenta de servicio y la pestana trabajadores.'

async function fetchWorkerRecords() {
  const response = await fetch('/api/sheets/trabajadores', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error || INITIAL_ERROR)
  }

  return payload
}

async function loadWorkerRecords({
  setLoading,
  setError,
  setRecords,
  setSheetName,
  setSelectedRecordId,
  setHasLoadedOnce,
}) {
  setLoading(true)
  setError('')

  try {
    const payload = await fetchWorkerRecords()
    const nextRecords = Array.isArray(payload.records) ? payload.records : []

    setRecords(nextRecords)
    setSheetName(payload.sheetName || 'trabajadores')
    setSelectedRecordId((currentSelectedId) => {
      if (nextRecords.some((record) => record.id === currentSelectedId)) {
        return currentSelectedId
      }

      return nextRecords[0]?.id || ''
    })
    setHasLoadedOnce(true)
  } catch (loadError) {
    setRecords([])
    setSelectedRecordId('')
    setError(loadError instanceof Error ? loadError.message : INITIAL_ERROR)
    setHasLoadedOnce(true)
  } finally {
    setLoading(false)
  }
}

function SheetsWorkspace({ isActive }) {
  const [records, setRecords] = useState([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [localAppStateByRecordId, setLocalAppStateByRecordId] = useState({})
  const [audioErrorByRecordId, setAudioErrorByRecordId] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [sheetName, setSheetName] = useState('trabajadores')

  const mergedRecords = records.map((record) =>
    applyLocalAppFields(record, localAppStateByRecordId[record.id]),
  )

  const selectedRecord =
    mergedRecords.find((record) => record.id === selectedRecordId) || null

  useEffect(() => {
    if (!isActive || hasLoadedOnce || loading) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void loadWorkerRecords({
        setLoading,
        setError,
        setRecords,
        setSheetName,
        setSelectedRecordId,
        setHasLoadedOnce,
      })
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasLoadedOnce, isActive, loading])

  let statusCopy =
    'Conecta la fuente principal para consultar la pestana trabajadores.'

  if (loading) {
    statusCopy = 'Leyendo registros desde Google Sheets...'
  } else if (error) {
    statusCopy = error
  } else if (hasLoadedOnce && records.length === 0) {
    statusCopy = `No se encontraron registros en la pestana ${sheetName}.`
  } else if (hasLoadedOnce) {
    statusCopy = `Se cargaron ${records.length} registros desde la pestana ${sheetName}.`
  }

  return (
    <div className="tab-content">
      <section className="action-card">
        <div>
          <p className="section-label">Fuente principal</p>
          <h2>Sheets principal</h2>
          <p className="section-text">
            Aqui se trabaja en modo solo lectura con el Google Sheets principal
            de la empresa, usando la pestana trabajadores como fuente operativa.
          </p>
          <p className={`inline-feedback${error ? ' is-error' : ''}`}>
            {statusCopy}
          </p>
        </div>

        <div className="action-card__controls">
          <span className="meta-chip">
            {loading ? 'Cargando...' : `${records.length} registros`}
          </span>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              void loadWorkerRecords({
                setLoading,
                setError,
                setRecords,
                setSheetName,
                setSelectedRecordId,
                setHasLoadedOnce,
              })
            }}
            disabled={loading}
          >
            {loading ? 'Cargando datos...' : 'Conectar / Cargar datos'}
          </button>
        </div>
      </section>

      <div className="sheets-layout">
        <RecordsTable
          columns={tableColumns}
          records={mergedRecords}
          loading={loading}
          error={error}
          selectedRecordId={selectedRecordId}
          onSelectRecord={setSelectedRecordId}
        />

        <DetailPanel
          record={selectedRecord}
          audioErrorMessage={
            selectedRecord ? audioErrorByRecordId[selectedRecord.id] || '' : ''
          }
          onDraftStyleChange={(nextStyle) => {
            if (!selectedRecord) {
              return
            }

            const nextDraftText = createDraftText(selectedRecord, nextStyle)

            setLocalAppStateByRecordId((currentMap) => {
              const currentEntry = currentMap[selectedRecord.id] || {}
              const currentFinalText =
                currentEntry.texto_final ?? selectedRecord.app_fields.texto_final
              const currentDraftText = selectedRecord.app_fields.texto_borrador
              const shouldSyncFinalText =
                !currentFinalText || currentFinalText === currentDraftText

              return {
                ...currentMap,
                [selectedRecord.id]: {
                  ...currentEntry,
                  draft_style: nextStyle,
                  texto_final: shouldSyncFinalText
                    ? nextDraftText
                    : currentFinalText,
                  needs_review: shouldSyncFinalText
                    ? false
                    : currentFinalText !== nextDraftText,
                },
              }
            })
          }}
          onGenerateAudio={async () => {
            if (!selectedRecord?.app_fields.texto_final?.trim()) {
              return
            }

            setAudioErrorByRecordId((currentMap) => ({
              ...currentMap,
              [selectedRecord.id]: '',
            }))

            setLocalAppStateByRecordId((currentMap) => ({
              ...currentMap,
              [selectedRecord.id]: {
                ...currentMap[selectedRecord.id],
                audio_status: 'Generando',
              },
            }))

            try {
              const result = await synthesizeAudioFromText({
                text: selectedRecord.app_fields.texto_final,
                filenameHint: selectedRecord.ui.display_name,
              })

              setLocalAppStateByRecordId((currentMap) => {
                const currentEntry = currentMap[selectedRecord.id] || {}
                const previousAudioUrl = currentEntry.audio_url

                if (
                  typeof previousAudioUrl === 'string' &&
                  previousAudioUrl.startsWith('blob:')
                ) {
                  window.URL.revokeObjectURL(previousAudioUrl)
                }

                return {
                  ...currentMap,
                  [selectedRecord.id]: {
                    ...currentEntry,
                    audio_status: 'Generado',
                    audio_url: result.audioUrl,
                    audio_filename: result.audioFilename,
                    audio_mime_type: result.mimeType,
                    texto_tts: result.ttsText,
                    last_generated_at: new Date().toISOString(),
                  },
                }
              })
            } catch (generationError) {
              const message =
                generationError instanceof Error
                  ? generationError.message
                  : 'No se pudo generar el audio.'

              setAudioErrorByRecordId((currentMap) => ({
                ...currentMap,
                [selectedRecord.id]: message,
              }))

              setLocalAppStateByRecordId((currentMap) => ({
                ...currentMap,
                [selectedRecord.id]: {
                  ...currentMap[selectedRecord.id],
                  audio_status: 'Error',
                },
              }))
            }
          }}
          onFinalTextChange={(value) => {
            if (!selectedRecord) {
              return
            }

            setLocalAppStateByRecordId((currentMap) => ({
              ...currentMap,
              [selectedRecord.id]: {
                ...currentMap[selectedRecord.id],
                texto_final: value,
                needs_review: value !== selectedRecord.app_fields.texto_borrador,
                last_edited_at: new Date().toISOString(),
                draft_style:
                  currentMap[selectedRecord.id]?.draft_style ||
                  selectedRecord.app_fields.draft_style ||
                  DEFAULT_DRAFT_TEXT_STYLE,
              },
            }))
          }}
        />
      </div>
    </div>
  )
}

export default SheetsWorkspace
