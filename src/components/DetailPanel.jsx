import { getDisplayValue } from '../lib/workerRecords.js'

function isPresent(value) {
  return value !== null && value !== undefined && value !== ''
}

function createRow(label, value, fallback = null) {
  if (!isPresent(value) && fallback === null) {
    return null
  }

  return [label, getDisplayValue(value, fallback ?? 'No disponible')]
}

function compactRows(rows) {
  return rows.filter(Boolean)
}

function getPrimarySummaryRows(record) {
  if (!record) {
    return [
      ['Nombre', 'Sin seleccionar'],
      ['Empresa', 'Pendiente'],
      ['Ficha', 'Pendiente'],
      ['Aptitud', 'Pendiente'],
      ['Tipo examen', 'Pendiente'],
      ['Fecha evaluacion', 'Pendiente'],
    ]
  }

  const { identificacion, aptitud_y_recomendaciones } = record

  return compactRows([
    createRow('Nombre', identificacion.nombre_completo, 'Sin nombre'),
    createRow('Empresa', identificacion.empresa),
    createRow('Ficha', identificacion.n_ficha),
    createRow('Aptitud', aptitud_y_recomendaciones.aptitud_final, 'Pendiente'),
    createRow('Tipo examen', identificacion.tipo_examen),
    createRow('Fecha evaluacion', identificacion.fecha_evaluacion),
  ])
}

function getClinicalSummaryRows(record) {
  if (!record) {
    return [
      ['Grupo sanguineo', 'Pendiente'],
      ['Peso', 'Pendiente'],
      ['Talla', 'Pendiente'],
      ['IMC', 'Pendiente'],
    ]
  }

  const { datos_generales_narrables } = record

  return compactRows([
    createRow('Grupo sanguineo', datos_generales_narrables.grupo_sanguineo),
    createRow('Peso', datos_generales_narrables.peso_kg),
    createRow('Talla', datos_generales_narrables.talla_cm),
    createRow('IMC', datos_generales_narrables.imc),
  ])
}

function getRecommendationRows(record) {
  if (!record) {
    return []
  }

  const { aptitud_y_recomendaciones } = record

  return compactRows([
    createRow('Restricciones', aptitud_y_recomendaciones.restricciones_texto),
    createRow(
      'Recomendaciones generales',
      aptitud_y_recomendaciones.recomendaciones_generales_texto,
    ),
    createRow('Recomendacion IMC', aptitud_y_recomendaciones.recomendacion_imc),
    createRow(
      'Recomendacion oftalmologia',
      aptitud_y_recomendaciones.recomendacion_oftalmologia,
    ),
    createRow(
      'Recomendacion audiometria',
      aptitud_y_recomendaciones.recomendacion_audiometria,
    ),
    createRow(
      'Recomendacion espirometria',
      aptitud_y_recomendaciones.recomendacion_espirometria,
    ),
    createRow(
      'Recomendacion metabolica',
      aptitud_y_recomendaciones.recomendacion_metabolica,
    ),
    createRow(
      'Recomendacion musculoesqueletica',
      aptitud_y_recomendaciones.recomendacion_musculoesqueletica,
    ),
    createRow('Recomendacion otros', aptitud_y_recomendaciones.recomendacion_otros),
  ])
}

function getSecondarySections(record) {
  if (!record) {
    return []
  }

  const {
    identificacion,
    laboratorio_numerico,
    evaluaciones_cualitativas,
    app_fields,
    derived_states,
  } = record

  return [
    {
      title: 'Identificacion extendida y contexto',
      rows: compactRows([
        createRow('Source type', identificacion.source_type),
        createRow('Sede / proyecto', identificacion.sede_proyecto),
        createRow('Area', identificacion.area),
        createRow('Puesto', identificacion.puesto_trabajo),
        createRow('DNI', identificacion.dni),
        createRow('Edad', identificacion.edad),
        createRow('Sexo', identificacion.sexo),
        createRow('Fecha emision', identificacion.fecha_emision),
      ]),
    },
    {
      title: 'Laboratorio numerico',
      rows: compactRows([
        createRow('Hemoglobina', laboratorio_numerico.hemoglobina_valor),
        createRow('Glucosa', laboratorio_numerico.glucosa_valor),
        createRow('Trigliceridos', laboratorio_numerico.trigliceridos_valor),
        createRow('Colesterol', laboratorio_numerico.colesterol_valor),
        createRow('Globulos rojos', laboratorio_numerico.globulos_rojos_valor),
        createRow('Hematocrito', laboratorio_numerico.hematocrito_valor),
        createRow('Leucocitos', laboratorio_numerico.leucocitos_valor),
        createRow('Plaquetas', laboratorio_numerico.plaquetas_valor),
      ]),
    },
    {
      title: 'Evaluaciones cualitativas',
      rows: compactRows([
        createRow('Examen orina', evaluaciones_cualitativas.examen_orina_resultado),
        createRow(
          'Informe psicologico',
          evaluaciones_cualitativas.informe_psicologico_resultado,
        ),
        createRow(
          'Dosaje cocaina',
          evaluaciones_cualitativas.dosaje_cocaina_resultado,
        ),
        createRow(
          'Dosaje marihuana',
          evaluaciones_cualitativas.dosaje_marihuana_resultado,
        ),
        createRow(
          'Valoracion IMC',
          evaluaciones_cualitativas.valoracion_imc_resultado,
        ),
        createRow(
          'Musculoesqueletico',
          evaluaciones_cualitativas.musculoesqueletico_resultado,
        ),
        createRow('ECG', evaluaciones_cualitativas.ecg_resultado),
        createRow('Audiometria', evaluaciones_cualitativas.audiometria_resultado),
        createRow('Oftalmologia', evaluaciones_cualitativas.oftalmologia_resultado),
        createRow('Espirometria', evaluaciones_cualitativas.espirometria_resultado),
        createRow(
          'Radiografia torax',
          evaluaciones_cualitativas.radiografia_torax_resultado,
        ),
        createRow('Odontograma', evaluaciones_cualitativas.odontograma_resultado),
        createRow(
          'Otros hallazgos',
          evaluaciones_cualitativas.otros_hallazgos_resultado,
        ),
      ]),
    },
    {
      title: 'Estado local de la app',
      rows: [
        ['Audio', app_fields.audio_status],
        ['Needs review', app_fields.needs_review ? 'Si' : 'No'],
        ['Ultima edicion', getDisplayValue(app_fields.last_edited_at)],
        ['Ultima generacion', getDisplayValue(app_fields.last_generated_at)],
        ['Archivo audio', getDisplayValue(app_fields.audio_filename)],
      ],
    },
    {
      title: 'Estados clinicos derivados',
      rows: Object.entries(derived_states).map(([label, value]) => [
        label,
        getDisplayValue(value),
      ]),
      subtle: true,
    },
  ].filter((section) => section.rows.length > 0)
}

function SummaryBlock({ title, rows, accent = false }) {
  return (
    <section className={`detail-block detail-block--summary${accent ? ' is-accent' : ''}`}>
      <h4>{title}</h4>
      <dl className="detail-list detail-list--summary">
        {rows.map(([label, value]) => (
          <div key={label} className="detail-list__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SecondarySection({ title, rows, subtle = false, defaultOpen = false }) {
  return (
    <details
      className={`detail-accordion${subtle ? ' is-subtle' : ''}`}
      open={defaultOpen}
    >
      <summary className="detail-accordion__summary">
        <span>{title}</span>
        <span className="detail-accordion__meta">{rows.length} campos</span>
      </summary>
      <div className="detail-accordion__content">
        <dl className="detail-list detail-list--accordion">
          {rows.map(([label, value]) => (
            <div key={label} className="detail-list__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  )
}

function DraftStyleSelector({ value, onChange, disabled }) {
  const options = [
    ['completo', 'Completo'],
    ['breve', 'Breve'],
  ]

  return (
    <div className="draft-style-switcher" role="tablist" aria-label="Estilo del borrador">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          role="tab"
          aria-selected={value === optionValue}
          className={`draft-style-switcher__button${value === optionValue ? ' is-active' : ''}`}
          onClick={() => onChange(optionValue)}
          disabled={disabled}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function AudioSection({ record, audioErrorMessage, onGenerateAudio }) {
  const hasAudio = Boolean(record?.app_fields.audio_url)
  const audioStatus = record?.app_fields.audio_status || 'Pendiente'

  return (
    <section className="detail-block detail-block--summary">
      <div className="detail-block__header">
        <h4>Audio</h4>
        <span className={`audio-status-badge is-${audioStatus.toLowerCase()}`}>
          {audioStatus}
        </span>
      </div>

      <div className="audio-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onGenerateAudio}
          disabled={
            !record ||
            !record.app_fields.texto_final?.trim() ||
            audioStatus === 'Generando'
          }
        >
          {audioStatus === 'Generando' ? 'Generando audio...' : 'Generar audio'}
        </button>

        {hasAudio && (
          <a
            className="download-button"
            href={record.app_fields.audio_url}
            download={record.app_fields.audio_filename || 'audio-evaluacion.mp3'}
          >
            Descargar
          </a>
        )}
      </div>

      {audioErrorMessage && (
        <p className="audio-error-message">{audioErrorMessage}</p>
      )}

      {hasAudio && (
        <div className="audio-player-shell">
          <audio controls src={record.app_fields.audio_url} className="audio-player">
            Tu navegador no soporta reproduccion de audio.
          </audio>
          <p className="audio-filename">
            Archivo: {record.app_fields.audio_filename || 'audio-evaluacion.mp3'}
          </p>
        </div>
      )}
    </section>
  )
}

function DetailPanel({
  record,
  audioErrorMessage,
  onDraftStyleChange,
  onGenerateAudio,
  onFinalTextChange,
}) {
  const primarySummaryRows = getPrimarySummaryRows(record)
  const clinicalSummaryRows = getClinicalSummaryRows(record)
  const recommendationRows = getRecommendationRows(record)
  const secondarySections = getSecondarySections(record)

  return (
    <aside className="panel detail-panel">
      <div className="panel__header">
        <div>
          <p className="section-label">Detalle</p>
          <h3>Panel de trabajo</h3>
        </div>
        <span className="ghost-chip">
          {record ? `Fila ${record.source_row_number}` : 'Sin registro activo'}
        </span>
      </div>

      <SummaryBlock
        title="Resumen principal del trabajador"
        rows={primarySummaryRows}
        accent
      />

      <SummaryBlock
        title="Resumen clinico breve"
        rows={clinicalSummaryRows}
      />

      {recommendationRows.length > 0 && (
        <section className="detail-block detail-block--summary">
          <h4>Recomendaciones y restricciones</h4>
          <div className="recommendation-stack">
            {recommendationRows.map(([label, value]) => (
              <div key={label} className="recommendation-item">
                <strong>{label}</strong>
                <p>{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="detail-block">
        <div className="detail-block__header">
          <h4>Texto borrador</h4>
          <DraftStyleSelector
            value={record?.app_fields.draft_style || 'completo'}
            onChange={onDraftStyleChange}
            disabled={!record}
          />
        </div>
        <div className="placeholder-box placeholder-box--narrative">
          {record
            ? record.app_fields.texto_borrador
            : 'El borrador generado automaticamente se mostrara aqui para su primera revision.'}
        </div>
      </section>

      <section className="detail-block">
        <h4>Texto final editable</h4>
        <textarea
          className="editor-area"
          value={record?.app_fields.texto_final || ''}
          onChange={(event) => onFinalTextChange(event.target.value)}
          placeholder="Aqui podras revisar, ajustar y dejar listo el texto final antes de generar el audio."
          aria-label="Texto final editable"
          disabled={!record}
        />
      </section>

      <AudioSection
        record={record}
        audioErrorMessage={audioErrorMessage}
        onGenerateAudio={onGenerateAudio}
      />

      <section className="detail-block detail-block--secondary">
        <h4>Informacion secundaria</h4>
        <div className="accordion-stack">
          {record ? (
            secondarySections.map((section, index) => (
              <SecondarySection
                key={section.title}
                title={section.title}
                rows={section.rows}
                subtle={section.subtle}
                defaultOpen={index === 0}
              />
            ))
          ) : (
            <div className="placeholder-box">
              Selecciona un registro para explorar el resto del detalle clinico y operativo.
            </div>
          )}
        </div>
      </section>
    </aside>
  )
}

export default DetailPanel
