import {
  DEFAULT_DRAFT_TEXT_STYLE,
  generateDraftNarrative,
} from './draftNarrative.js'
import { processWorkerClinicalNarrative } from '../clinical/index.js'

export const SHEET_TAB_NAME = 'trabajadores'

export const STANDARD_RECORD_BLOCKS = {
  identificacion: [
    'source_type',
    'empresa',
    'sede_proyecto',
    'area',
    'puesto_trabajo',
    'n_ficha',
    'fecha_evaluacion',
    'fecha_emision',
    'nombres',
    'apellidos',
    'dni',
    'edad',
    'sexo',
    'tipo_examen',
  ],
  datos_generales_narrables: [
    'grupo_sanguineo',
    'peso_kg',
    'talla_cm',
    'pab_cm',
    'imc',
    'pa_sistolica',
    'pa_diastolica',
    'fc',
    'fr',
  ],
  laboratorio_numerico: [
    'hemoglobina_valor',
    'hemoglobina_unidad',
    'hemoglobina_rango_masculino_min',
    'hemoglobina_rango_masculino_max',
    'hemoglobina_rango_femenino_min',
    'hemoglobina_rango_femenino_max',
    'hemoglobina_rango_masculino_fuente',
    'hemoglobina_rango_femenino_fuente',
    'hemoglobina_rango_ambiguo',
    'glucosa_valor',
    'glucosa_valor_fuente',
    'glucosa_unidad',
    'glucosa_fuente',
    'glucosa_referencia',
    'trigliceridos_valor',
    'trigliceridos_valor_fuente',
    'trigliceridos_unidad',
    'trigliceridos_fuente',
    'trigliceridos_referencia',
    'colesterol_valor',
    'colesterol_valor_fuente',
    'colesterol_unidad',
    'colesterol_fuente',
    'colesterol_referencia',
    'globulos_rojos_valor',
    'hematocrito_valor',
    'leucocitos_valor',
    'plaquetas_valor',
  ],
  evaluaciones_cualitativas: [
    'examen_orina_resultado',
    'informe_psicologico_resultado',
    'dosaje_cocaina_resultado',
    'dosaje_marihuana_resultado',
    'valoracion_imc_resultado',
    'musculoesqueletico_resultado',
    'ecg_resultado',
    'audiometria_resultado',
    'oftalmologia_resultado',
    'espirometria_resultado',
    'radiografia_torax_resultado',
    'odontograma_resultado',
    'otros_hallazgos_resultado',
  ],
  aptitud_y_recomendaciones: [
    'aptitud_final',
    'restricciones_texto',
    'recomendaciones_generales_texto',
    'recomendacion_imc',
    'recomendacion_oftalmologia',
    'recomendacion_audiometria',
    'recomendacion_espirometria',
    'recomendacion_metabolica',
    'recomendacion_musculoesqueletica',
    'recomendacion_otros',
  ],
}

export const APP_LOCAL_FIELDS = [
  'draft_style',
  'texto_borrador',
  'texto_final',
  'texto_tts',
  'audio_status',
  'audio_filename',
  'audio_mime_type',
  'audio_url',
  'needs_review',
  'last_edited_at',
  'last_generated_at',
]

export const DERIVED_STATE_FIELDS = [
  'hemoglobina_estado',
  'glucosa_estado',
  'trigliceridos_estado',
  'colesterol_estado',
  'globulos_rojos_estado',
  'hematocrito_estado',
  'leucocitos_estado',
  'plaquetas_estado',
  'examen_orina_estado',
  'informe_psicologico_estado',
  'valoracion_imc_estado',
  'musculoesqueletico_estado',
  'ecg_estado',
  'audiometria_estado',
  'oftalmologia_estado',
  'espirometria_estado',
  'radiografia_torax_estado',
  'odontograma_estado',
  'otros_hallazgos_estado',
]

const DEFAULT_TEXT_STATUS = 'Pendiente'
const DEFAULT_AUDIO_STATUS = 'Pendiente'

function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeHeader(value) {
  if (!value) {
    return ''
  }

  return stripAccents(String(value).trim().toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function sanitizeCellValue(value) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function normalizeNullableValue(value) {
  const sanitizedValue = sanitizeCellValue(value)
  return sanitizedValue === '' ? null : sanitizedValue
}

export function getDisplayValue(value, fallback = 'No disponible') {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  return String(value)
}

export function hasRowContent(row = []) {
  return row.some((cell) => sanitizeCellValue(cell) !== '')
}

export function buildFullName(nombres, apellidos) {
  return [sanitizeCellValue(nombres), sanitizeCellValue(apellidos)]
    .filter(Boolean)
    .join(' ')
}

function buildStructuredBlock(fieldNames, rawRecord) {
  return Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, normalizeNullableValue(rawRecord[fieldName])]),
  )
}

function buildRecordId(identificacion, sourceRowNumber) {
  const fullName = buildFullName(
    identificacion.nombres,
    identificacion.apellidos,
  )
  const identityParts = [
    identificacion.dni,
    identificacion.n_ficha,
    fullName,
    identificacion.empresa,
    sourceRowNumber,
  ]

  return identityParts
    .map((part) => sanitizeCellValue(part).toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .filter(Boolean)
    .join('--')
}

function buildDerivedStates() {
  return Object.fromEntries(
    DERIVED_STATE_FIELDS.map((fieldName) => [fieldName, null]),
  )
}

function getTextStatusLabel(appFields) {
  if (appFields.last_generated_at) {
    return 'Generado'
  }

  if (appFields.last_edited_at) {
    return 'Editado local'
  }

  if (appFields.needs_review) {
    return 'En revision'
  }

  return DEFAULT_TEXT_STATUS
}

function buildUiModel(record) {
  const { identificacion, aptitud_y_recomendaciones, app_fields } = record
  const fullName = buildFullName(
    identificacion.nombres,
    identificacion.apellidos,
  )

  return {
    display_name:
      fullName ||
      identificacion.dni ||
      `Registro ${record.source_row_number}`,
    company_label: identificacion.empresa || 'Sin empresa',
    ficha_label: identificacion.n_ficha || 'Sin ficha',
    aptitude_label: aptitud_y_recomendaciones.aptitud_final || 'Pendiente',
    text_status_label: getTextStatusLabel(app_fields),
    audio_status_label: app_fields.audio_status || DEFAULT_AUDIO_STATUS,
  }
}

export function createDraftText(record, style = record.app_fields?.draft_style || DEFAULT_DRAFT_TEXT_STYLE) {
  if (style !== DEFAULT_DRAFT_TEXT_STYLE) {
    return generateDraftNarrative(record, { style })
  }

  const clinicalResult = processWorkerClinicalNarrative({
    ...record,
    derived_states: {
      ...(record.derived_states || {}),
      reviewed_by_user: true,
    },
    validation: record.validation || { warnings: [], has_errors: false },
  })

  return clinicalResult.displayText || generateDraftNarrative(record, { style })
}

function buildInitialAppFields(record) {
  const textoBorrador = createDraftText(record)

  return {
    draft_style: DEFAULT_DRAFT_TEXT_STYLE,
    texto_borrador: textoBorrador,
    texto_final: textoBorrador,
    texto_tts: null,
    audio_status: DEFAULT_AUDIO_STATUS,
    audio_filename: null,
    audio_mime_type: null,
    audio_url: null,
    needs_review: false,
    last_edited_at: null,
    last_generated_at: null,
  }
}

export function normalizeWorkerRecord(rawRecord, sourceRowNumber) {
  const identificacion = buildStructuredBlock(
    STANDARD_RECORD_BLOCKS.identificacion,
    rawRecord,
  )
  const datosGeneralesNarrables = buildStructuredBlock(
    STANDARD_RECORD_BLOCKS.datos_generales_narrables,
    rawRecord,
  )
  const laboratorioNumerico = buildStructuredBlock(
    STANDARD_RECORD_BLOCKS.laboratorio_numerico,
    rawRecord,
  )
  const evaluacionesCualitativas = buildStructuredBlock(
    STANDARD_RECORD_BLOCKS.evaluaciones_cualitativas,
    rawRecord,
  )
  const aptitudYRecomendaciones = buildStructuredBlock(
    STANDARD_RECORD_BLOCKS.aptitud_y_recomendaciones,
    rawRecord,
  )

  const record = {
    id: buildRecordId(identificacion, sourceRowNumber),
    source_row_number: sourceRowNumber,
    identificacion: {
      ...identificacion,
      source_type: identificacion.source_type || 'google_sheets',
      nombre_completo: buildFullName(
        identificacion.nombres,
        identificacion.apellidos,
      ) || null,
    },
    datos_generales_narrables: datosGeneralesNarrables,
    laboratorio_numerico: laboratorioNumerico,
    evaluaciones_cualitativas: evaluacionesCualitativas,
    aptitud_y_recomendaciones: aptitudYRecomendaciones,
    app_fields: {},
    derived_states: buildDerivedStates(),
  }

  const appFields = buildInitialAppFields(record)
  const completedRecord = {
    ...record,
    app_fields: appFields,
  }

  return {
    ...completedRecord,
    ui: buildUiModel(completedRecord),
  }
}

export function applyLocalAppFields(record, localAppFields = {}) {
  const mergedRecord = {
    ...record,
    app_fields: {
      ...record.app_fields,
      ...localAppFields,
    },
  }

  const nextDraftText = createDraftText(
    mergedRecord,
    mergedRecord.app_fields.draft_style || DEFAULT_DRAFT_TEXT_STYLE,
  )
  const nextRecord = {
    ...mergedRecord,
    app_fields: {
      ...mergedRecord.app_fields,
      texto_borrador: nextDraftText,
    },
  }

  return {
    ...nextRecord,
    ui: buildUiModel(nextRecord),
  }
}
