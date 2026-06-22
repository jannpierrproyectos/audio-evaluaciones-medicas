export const DRAFT_TEXT_STYLES = {
  COMPLETE: 'completo',
  BRIEF: 'breve',
}

export const DEFAULT_DRAFT_TEXT_STYLE = DRAFT_TEXT_STYLES.COMPLETE

const CLINIC_NAME = 'la cl\u00ednica Innomedic'
const NORMAL_RESULT_TERMS = ['NORMAL', 'SIN ALTERACIONES', 'SIN HALLAZGOS']
const FINDING_INTROS = [
  'En sus resultados tambi\u00e9n se evidencia',
  'Tambi\u00e9n se evidencia',
  'De igual forma, se evidencia',
]
const OBSERVATION_INTROS = [
  'En sus resultados tambi\u00e9n se observan',
  'Tambi\u00e9n se observan',
  'Adem\u00e1s, se observan',
]
const ROMAN_NUMERAL_TERMS = new Set(['I', 'II', 'III', 'IV', 'V'])
const CLINICAL_PHRASE_DICTIONARY = new Map([
  ['AMETROPIA', 'ametrop\u00eda'],
  ['HIPERLIPIDEMIA MIXTA', 'hiperlipidemia mixta'],
  ['OBESIDAD TIPO I', 'obesidad tipo uno'],
  ['OBESIDAD TIPO II', 'obesidad tipo dos'],
  ['OBESIDAD TIPO III', 'obesidad tipo tres'],
  ['APTO', 'apto'],
  ['APTO CON RESTRICCIONES', 'apto con restricciones'],
  ['APTO CON OBSERVACIONES', 'apto con observaciones'],
  ['NO APTO', 'no apto'],
  [
    'NO REALIZAR ACTIVIDADES SIN EL USO OBLIGATORIO DE CORRECTORES OCULARES',
    'no realizar actividades sin el uso obligatorio de correctores oculares',
  ],
  [
    'USO DE CORRECTORES OCULARES Y CONTROL POR OFTALMOLOG\u00cdA',
    'uso de correctores oculares y control por oftalmolog\u00eda',
  ],
  [
    'USO DE CORRECTORES OCULARES Y CONTROL POR OFTALMOLOGIA',
    'uso de correctores oculares y control por oftalmolog\u00eda',
  ],
  [
    'AUMENTAR LA ACTIVIDAD F\u00cdSICA, MANTENER DIETA BAJA EN GRASAS Y CALOR\u00cdAS, REALIZAR CONTROL MENSUAL DE PESO Y CONTROL POR ENDOCRINOLOG\u00cdA Y NUTRICI\u00d3N',
    'aumentar la actividad f\u00edsica, mantener una dieta baja en grasas y calor\u00edas, realizar control mensual de peso y acudir a control por endocrinolog\u00eda y nutrici\u00f3n',
  ],
  [
    'AUMENTAR LA ACTIVIDAD FISICA, MANTENER DIETA BAJA EN GRASAS Y CALORIAS, REALIZAR CONTROL MENSUAL DE PESO Y CONTROL POR ENDOCRINOLOGIA Y NUTRICION',
    'aumentar la actividad f\u00edsica, mantener una dieta baja en grasas y calor\u00edas, realizar control mensual de peso y acudir a control por endocrinolog\u00eda y nutrici\u00f3n',
  ],
  [
    'EN REGULAR ESTADO F\u00cdSICO MUSCULO ESQUELETICO CORRELACIONADO A IMC',
    'estado f\u00edsico musculoesquel\u00e9tico regular, correlacionado al \u00edndice de masa corporal',
  ],
  [
    'EN REGULAR ESTADO FISICO MUSCULO ESQUELETICO CORRELACIONADO A IMC',
    'estado f\u00edsico musculoesquel\u00e9tico regular, correlacionado al \u00edndice de masa corporal',
  ],
  ['CONTROL POR ENDOCRINOLOG\u00cdA', 'control por endocrinolog\u00eda'],
  ['CONTROL POR ENDOCRINOLOGIA', 'control por endocrinolog\u00eda'],
  ['A POSITIVO', 'A positivo'],
  ['B POSITIVO', 'B positivo'],
  ['O POSITIVO', 'O positivo'],
  ['AB POSITIVO', 'AB positivo'],
  ['A NEGATIVO', 'A negativo'],
  ['B NEGATIVO', 'B negativo'],
  ['O NEGATIVO', 'O negativo'],
  ['AB NEGATIVO', 'AB negativo'],
])

function stripAccents(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeComparableText(value) {
  if (!value) {
    return ''
  }

  return stripAccents(String(value)).toUpperCase()
}

function normalizeDictionaryKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .toUpperCase()
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function buildFullName(identificacion) {
  return [identificacion.nombres, identificacion.apellidos]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
}

function isAllCapsPhrase(value) {
  const letters = String(value || '').match(/\p{L}/gu) || []

  return letters.length > 0 && letters.every((letter) => letter === letter.toUpperCase())
}

function restoreClinicalTerms(value) {
  return String(value || '')
    .replace(/\b(ametropia)\b/gi, 'ametrop\u00eda')
    .replace(/\b(hipertrigliceridemia)\b/gi, 'hipertrigliceridemia')
    .replace(/\b(hipercolesterolemia)\b/gi, 'hipercolesterolemia')
    .replace(/\b(hiperglicemia)\b/gi, 'hiperglicemia')
    .replace(/\b(hiperlipidemia mixta)\b/gi, 'hiperlipidemia mixta')
    .replace(/\b(fisica)\b/gi, 'f\u00edsica')
    .replace(/\b(calorias)\b/gi, 'calor\u00edas')
    .replace(/\b(oftalmologia)\b/gi, 'oftalmolog\u00eda')
    .replace(/\b(endocrinologia)\b/gi, 'endocrinolog\u00eda')
    .replace(/\b(nutricion)\b/gi, 'nutrici\u00f3n')
    .replace(/\b(indice)\b/gi, '\u00edndice')
    .replace(/\b(m[u\u00fa]sculo[\s-]+esquel[e\u00e9]tico|musculoesquel[e\u00e9]tico)\b/gi, 'musculoesquel\u00e9tico')
    .replace(/\bimc\b/gi, '\u00edndice de masa corporal')
    .replace(/\btipo\s+i\b/gi, 'tipo uno')
    .replace(/\btipo\s+ii\b/gi, 'tipo dos')
    .replace(/\btipo\s+iii\b/gi, 'tipo tres')
    .replace(/\btipo\s+iv\b/gi, 'tipo cuatro')
    .replace(/\btipo\s+v\b/gi, 'tipo cinco')
    .replace(/\b(a|b|o|ab)\s+(positivo|negativo)\b/gi, (_, group, rh) => {
      return `${group.toUpperCase()} ${rh.toLowerCase()}`
    })
}

export function normalizeClinicalPhrase(value) {
  const normalizedValue = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')

  if (!normalizedValue) {
    return ''
  }

  const dictionaryKey = normalizeDictionaryKey(normalizedValue)
  const dictionaryValue =
    CLINICAL_PHRASE_DICTIONARY.get(dictionaryKey) ||
    CLINICAL_PHRASE_DICTIONARY.get(stripAccents(dictionaryKey))

  if (dictionaryValue) {
    return dictionaryValue
  }

  const naturalValue = isAllCapsPhrase(normalizedValue)
    ? normalizedValue
        .toLowerCase()
        .split(' ')
        .map((word) => {
          const plainWord = word.replace(/[^\p{L}]/gu, '').toUpperCase()
          return ROMAN_NUMERAL_TERMS.has(plainWord) ? word.toUpperCase() : word
        })
        .join(' ')
    : normalizedValue

  return restoreClinicalTerms(naturalValue)
}

function parseNumericValue(value) {
  if (!hasValue(value)) {
    return null
  }

  const cleanedValue = String(value).trim().replace(',', '.')
  const parsedValue = Number(cleanedValue)

  return Number.isFinite(parsedValue) ? parsedValue : null
}

function getImcNarrativeType(value) {
  const comparableValue = normalizeComparableText(value)

  if (comparableValue.includes('SOBREPESO')) {
    return 'sobrepeso'
  }

  if (comparableValue.includes('OBESIDAD')) {
    return normalizeClinicalPhrase(value)
  }

  return ''
}

function isObesityImc(value) {
  return normalizeComparableText(value).includes('OBESIDAD')
}

function hasEndocrinologyRecommendation(value) {
  return normalizeComparableText(value).includes('ENDOCRINOLOGIA')
}

function looksNormalResult(value, extraTerms = []) {
  if (!hasValue(value)) {
    return true
  }

  const comparableValue = normalizeComparableText(value)
  const allTerms = [...NORMAL_RESULT_TERMS, ...extraTerms]

  return allTerms.some((term) => comparableValue.includes(term))
}

function createGreetingParagraph(record) {
  const workerName =
    record.identificacion.nombre_completo ||
    buildFullName(record.identificacion)

  if (workerName) {
    return `Buenos d\u00edas, ${workerName}. Le saludamos de parte de ${CLINIC_NAME}. A continuaci\u00f3n, le brindaremos el resumen de su evaluaci\u00f3n m\u00e9dica.`
  }

  return `Buenos d\u00edas. Le saludamos de parte de ${CLINIC_NAME}. A continuaci\u00f3n, le brindaremos el resumen de su evaluaci\u00f3n m\u00e9dica.`
}

function getBodySummaryParagraph(record) {
  const { datos_generales_narrables, evaluaciones_cualitativas } = record
  const fragments = []

  if (hasValue(datos_generales_narrables.grupo_sanguineo)) {
    fragments.push(
      `Su grupo sangu\u00edneo es ${normalizeClinicalPhrase(datos_generales_narrables.grupo_sanguineo)}.`,
    )
  }

  if (
    hasValue(datos_generales_narrables.peso_kg) &&
    hasValue(datos_generales_narrables.talla_cm)
  ) {
    fragments.push(
      `Su peso es ${datos_generales_narrables.peso_kg} kilogramos y su talla es ${datos_generales_narrables.talla_cm} cent\u00edmetros.`,
    )
  } else if (hasValue(datos_generales_narrables.peso_kg)) {
    fragments.push(
      `Su peso registrado es ${datos_generales_narrables.peso_kg} kilogramos.`,
    )
  } else if (hasValue(datos_generales_narrables.talla_cm)) {
    fragments.push(
      `Su talla registrada es ${datos_generales_narrables.talla_cm} cent\u00edmetros.`,
    )
  }

  const imcValue = datos_generales_narrables.imc
  const imcResult = evaluaciones_cualitativas.valoracion_imc_resultado
  const comparableImcResult = normalizeComparableText(imcResult)
  const hasRelevantImcFinding =
    comparableImcResult.includes('SOBREPESO') ||
    comparableImcResult.includes('OBESIDAD')

  if (hasValue(imcValue) && hasRelevantImcFinding) {
    let imcSentence = `Su \u00edndice de masa corporal es de ${imcValue}`
    const imcPhrase = getImcNarrativeType(imcResult)

    if (imcPhrase) {
      imcSentence += `, correspondiente a ${imcPhrase}`
    }

    fragments.push(`${imcSentence}.`)

    if (isObesityImc(imcResult)) {
      fragments.push(
        'Por este motivo, se recomienda aumentar la actividad f\u00edsica, mantener una dieta baja en grasas y calor\u00edas, realizar control mensual de peso y acudir a control por endocrinolog\u00eda y nutrici\u00f3n.',
      )
    } else if (imcPhrase === 'sobrepeso') {
      fragments.push(
        'Por este motivo, se recomienda aumentar la actividad f\u00edsica, mantener una dieta baja en grasas y calor\u00edas, y acudir a control por nutrici\u00f3n.',
      )
    }
  } else if (hasValue(imcValue)) {
    fragments.push(`Su \u00edndice de masa corporal es de ${imcValue}.`)
  }

  return fragments.length > 0 ? fragments.join(' ') : ''
}

function pickIntro(index, intros) {
  return intros[Math.min(index, intros.length - 1)]
}

function createRecommendationCollector() {
  const usedRecommendations = new Set()

  return (value) => {
    if (!hasValue(value)) {
      return ''
    }

    const normalizedValue = normalizeClinicalPhrase(value)
    const key = normalizeComparableText(normalizedValue)

    if (usedRecommendations.has(key)) {
      return ''
    }

    usedRecommendations.add(key)
    return normalizedValue
  }
}

function buildFindingSentence(intro, findingText, recommendationText) {
  let sentence = `${intro} ${findingText}`

  if (recommendationText) {
    sentence += `, por lo que se recomienda ${recommendationText}`
  }

  return `${sentence}.`
}

function buildObservationSentencePrefix(findingText) {
  const comparableText = normalizeComparableText(findingText)

  if (comparableText.startsWith('GLUCOSA')) {
    return `Adem\u00e1s, se observa ${findingText}.`
  }

  return `Adem\u00e1s, se observan ${findingText}.`
}

function buildOphthalmologySentence(findingText, recommendationText) {
  let sentence = `En la evaluaci\u00f3n oftalmol\u00f3gica se evidencia ${findingText}.`

  if (recommendationText) {
    const recommendationPrefix = recommendationText.startsWith('uso de ')
      ? `el ${recommendationText}`
      : recommendationText

    sentence += ` Por ello, se recomienda ${recommendationPrefix}.`
  }

  return sentence
}

function getTriglyceridesStatus(value, fallbackText = '') {
  const numericValue = parseNumericValue(value)
  const comparableFallback = normalizeComparableText(fallbackText)

  if (numericValue !== null) {
    if (numericValue >= 500) {
      return 'muy altos'
    }

    if (numericValue >= 200) {
      return 'altos'
    }

    if (numericValue >= 150) {
      return 'en l\u00edmite alto'
    }
  }

  if (comparableFallback.includes('MUY ALTO')) {
    return 'muy altos'
  }

  if (comparableFallback.includes('LIMITE ALTO')) {
    return 'en l\u00edmite alto'
  }

  if (
    comparableFallback.includes('ALTO') ||
    comparableFallback.includes('HIPERTRIGLICERIDEMIA')
  ) {
    return 'altos'
  }

  return ''
}

function hasTriglyceridesAlteration(record, otrosHallazgosText) {
  const numericValue = parseNumericValue(
    record.laboratorio_numerico.trigliceridos_valor,
  )

  return (
    (numericValue !== null && numericValue >= 150) ||
    normalizeComparableText(otrosHallazgosText).includes('TRIGLICER') ||
    normalizeComparableText(otrosHallazgosText).includes('HIPERTRIGLICERIDEMIA')
  )
}

function hasCholesterolAlteration(record, otrosHallazgosText) {
  const numericValue = parseNumericValue(
    record.laboratorio_numerico.colesterol_valor,
  )

  return (
    (numericValue !== null && numericValue >= 200) ||
    normalizeComparableText(otrosHallazgosText).includes('COLESTEROL') ||
    normalizeComparableText(otrosHallazgosText).includes('HIPERCOLESTEROLEMIA')
  )
}

function hasGlucoseAlteration(record, otrosHallazgosText) {
  const numericValue = parseNumericValue(record.laboratorio_numerico.glucosa_valor)

  return (
    (numericValue !== null && numericValue > 100) ||
    normalizeComparableText(otrosHallazgosText).includes('HIPERGLICEMIA')
  )
}

function buildMetabolicRecommendation(hasPriorEndocrinology, includeDiet = false) {
  if (hasPriorEndocrinology) {
    return 'Este hallazgo refuerza la recomendaci\u00f3n de acudir a control por endocrinolog\u00eda.'
  }

  if (includeDiet) {
    return 'Por ello, se recomienda control por endocrinolog\u00eda y mantener una alimentaci\u00f3n baja en grasas.'
  }

  return 'Por ello, se recomienda evaluaci\u00f3n por endocrinolog\u00eda.'
}

function buildMetabolicObservationSentence(findingText, recommendationText) {
  return `${buildObservationSentencePrefix(findingText)} ${recommendationText}`
}

function buildMetabolicObservations(record, hasPriorEndocrinology) {
  const observations = []
  const otrosHallazgosText =
    record.evaluaciones_cualitativas.otros_hallazgos_resultado
  const comparableOtrosHallazgos = normalizeComparableText(otrosHallazgosText)
  const triglyceridesAltered = hasTriglyceridesAlteration(
    record,
    otrosHallazgosText,
  )
  const cholesterolAltered = hasCholesterolAlteration(record, otrosHallazgosText)
  const glucoseAltered = hasGlucoseAlteration(record, otrosHallazgosText)
  const hasMixedHyperlipidemia = comparableOtrosHallazgos.includes(
    'HIPERLIPIDEMIA MIXTA',
  )
  const hasHyperglycemia = comparableOtrosHallazgos.includes('HIPERGLICEMIA')

  if (triglyceridesAltered && cholesterolAltered && hasMixedHyperlipidemia) {
    observations.push({
      sentence: buildMetabolicObservationSentence(
        'triglic\u00e9ridos y colesterol elevados, compatible con hiperlipidemia mixta',
        buildMetabolicRecommendation(hasPriorEndocrinology, true),
      ),
    })
  } else if (triglyceridesAltered) {
    const status = getTriglyceridesStatus(
      record.laboratorio_numerico.trigliceridos_valor,
      otrosHallazgosText,
    )

    observations.push({
      sentence: buildMetabolicObservationSentence(
        `triglic\u00e9ridos ${status || 'altos'}, lo que corresponde a hipertrigliceridemia`,
        buildMetabolicRecommendation(hasPriorEndocrinology, true),
      ),
    })
  } else if (cholesterolAltered) {
    const hasHypercholesterolemia = comparableOtrosHallazgos.includes(
      'HIPERCOLESTEROLEMIA',
    )

    observations.push({
      sentence: buildMetabolicObservationSentence(
        hasHypercholesterolemia
        ? 'colesterol elevado, compatible con hipercolesterolemia'
        : 'colesterol elevado',
        buildMetabolicRecommendation(hasPriorEndocrinology, true),
      ),
    })
  }

  if (glucoseAltered) {
    observations.push({
      sentence: buildMetabolicObservationSentence(
        hasHyperglycemia
        ? 'glucosa elevada, compatible con hiperglicemia'
        : 'glucosa elevada',
        buildMetabolicRecommendation(hasPriorEndocrinology),
      ),
    })
  }

  return observations
}

function removeMetabolicTermsFromOtherFindings(value) {
  return String(value || '')
    .replace(/\bHIPERLIPIDEMIA\s+MIXTA\b/gi, '')
    .replace(/\bHIPERTRIGLICERIDEMIA\b/gi, '')
    .replace(/\bHIPERCOLESTEROLEMIA\b/gi, '')
    .replace(/\bHIPERGLICEMIA\b/gi, '')
    .replace(/\bGLUCOSA\s+(?:ELEVADA|ALTA|EN\s+L[\u00cdI]MITE\s+ALTO)\b/gi, '')
    .replace(/\bTRIGLIC[\u00c9E]RIDOS\s+(?:EN\s+L[\u00cdI]MITE\s+ALTO|ALTOS?|MUY\s+ALTOS?)\b/gi, '')
    .replace(/\bCOLESTEROL\s+(?:ELEVADO|ALTO|EN\s+L[\u00cdI]MITE\s+ALTO)\b/gi, '')
    .replace(/[;,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectRelevantFindings(record) {
  const findings = []
  const claimRecommendation = createRecommendationCollector()
  const { evaluaciones_cualitativas, aptitud_y_recomendaciones } = record
  const oftalmologiaResult = evaluaciones_cualitativas.oftalmologia_resultado
  const audiometriaResult = evaluaciones_cualitativas.audiometria_resultado
  const espirometriaResult = evaluaciones_cualitativas.espirometria_resultado
  const musculoesqueleticoResult =
    evaluaciones_cualitativas.musculoesqueletico_resultado
  const otrosHallazgosResult =
    evaluaciones_cualitativas.otros_hallazgos_resultado
  const hasPriorEndocrinology =
    isObesityImc(evaluaciones_cualitativas.valoracion_imc_resultado) ||
    hasEndocrinologyRecommendation(aptitud_y_recomendaciones.recomendacion_imc)

  if (
    hasValue(oftalmologiaResult) &&
    !looksNormalResult(oftalmologiaResult) &&
    normalizeComparableText(oftalmologiaResult).includes('AMETROPIA')
  ) {
    const ophthalmologyFinding = normalizeClinicalPhrase(oftalmologiaResult)
    const ophthalmologyRecommendation = claimRecommendation(
      aptitud_y_recomendaciones.recomendacion_oftalmologia,
    )

    findings.push({
      sentence: buildOphthalmologySentence(
        ophthalmologyFinding,
        ophthalmologyRecommendation,
      ),
    })
  } else if (
    hasValue(oftalmologiaResult) &&
    !looksNormalResult(oftalmologiaResult)
  ) {
    findings.push({
      type: 'finding',
      text: normalizeClinicalPhrase(oftalmologiaResult),
      recommendation: claimRecommendation(
        aptitud_y_recomendaciones.recomendacion_oftalmologia,
      ),
    })
  }

  if (
    hasValue(audiometriaResult) &&
    !looksNormalResult(audiometriaResult, ['NORMOACUSIA'])
  ) {
    findings.push({
      type: 'finding',
      text: normalizeClinicalPhrase(audiometriaResult),
      recommendation: claimRecommendation(
        aptitud_y_recomendaciones.recomendacion_audiometria,
      ),
    })
  }

  if (
    hasValue(espirometriaResult) &&
    !looksNormalResult(espirometriaResult)
  ) {
    findings.push({
      type: 'finding',
      text: normalizeClinicalPhrase(espirometriaResult),
      recommendation: claimRecommendation(
        aptitud_y_recomendaciones.recomendacion_espirometria,
      ),
    })
  }

  if (
    hasValue(musculoesqueleticoResult) &&
    !looksNormalResult(musculoesqueleticoResult)
  ) {
    findings.push({
      type: 'finding',
      text: normalizeClinicalPhrase(musculoesqueleticoResult),
      recommendation: claimRecommendation(
        aptitud_y_recomendaciones.recomendacion_musculoesqueletica,
      ),
    })
  }

  const metabolicObservations = buildMetabolicObservations(
    record,
    hasPriorEndocrinology,
  )

  findings.push(...metabolicObservations)

  const nonMetabolicOtherFindings =
    removeMetabolicTermsFromOtherFindings(otrosHallazgosResult)

  if (hasValue(nonMetabolicOtherFindings)) {
    findings.push({
      type: 'finding',
      text: normalizeClinicalPhrase(nonMetabolicOtherFindings),
      recommendation: claimRecommendation(
        aptitud_y_recomendaciones.recomendacion_otros,
      ),
    })
  }

  return findings
}

function getAdditionalFindingsParagraph(record) {
  const findings = collectRelevantFindings(record)

  if (findings.length === 0) {
    return ''
  }

  return findings
    .map((finding, index) => {
      if (finding.sentence) {
        return finding.sentence
      }

      const intro =
        finding.type === 'observation'
          ? pickIntro(index, OBSERVATION_INTROS)
          : pickIntro(index, FINDING_INTROS)

      return buildFindingSentence(intro, finding.text, finding.recommendation)
    })
    .join(' ')
}

function hasAnySecondaryClinicalData(record) {
  const valuesToInspect = [
    record.evaluaciones_cualitativas.examen_orina_resultado,
    record.evaluaciones_cualitativas.informe_psicologico_resultado,
    record.evaluaciones_cualitativas.audiometria_resultado,
    record.evaluaciones_cualitativas.espirometria_resultado,
    record.evaluaciones_cualitativas.oftalmologia_resultado,
    record.evaluaciones_cualitativas.otros_hallazgos_resultado,
    record.laboratorio_numerico.trigliceridos_valor,
    record.laboratorio_numerico.colesterol_valor,
    record.laboratorio_numerico.hemoglobina_valor,
    record.laboratorio_numerico.glucosa_valor,
  ]

  return valuesToInspect.some((value) => hasValue(value))
}

function getNormalityParagraph(record) {
  if (!hasAnySecondaryClinicalData(record)) {
    return ''
  }

  return 'Respecto de los dem\u00e1s ex\u00e1menes realizados, estos no presentan alteraciones.'
}

function getAptitudeParagraph(record) {
  const aptitude = record.aptitud_y_recomendaciones.aptitud_final

  if (!hasValue(aptitude)) {
    return ''
  }

  return `Por ello, su calificaci\u00f3n final es ${normalizeClinicalPhrase(aptitude)}.`
}

function getRestrictionsParagraph(record) {
  const restrictions = record.aptitud_y_recomendaciones.restricciones_texto

  if (!hasValue(restrictions)) {
    return ''
  }

  return `La restricci\u00f3n indicada es ${normalizeClinicalPhrase(restrictions)}.`
}

function getClosingParagraph() {
  return 'Eso ser\u00eda todo. De presentar alguna duda adicional, no dude en consultar con el m\u00e9dico de su empresa. Muchas gracias.'
}

function generateCompleteNarrative(record) {
  const paragraphs = [
    createGreetingParagraph(record),
    getBodySummaryParagraph(record),
    getAdditionalFindingsParagraph(record),
    getNormalityParagraph(record),
    getAptitudeParagraph(record),
    getRestrictionsParagraph(record),
    getClosingParagraph(),
  ].filter(Boolean)

  return paragraphs.join('\n\n')
}

function generateBriefNarrative(record) {
  const paragraphs = [
    createGreetingParagraph(record),
    getAdditionalFindingsParagraph(record) || getBodySummaryParagraph(record),
    getAptitudeParagraph(record),
    getRestrictionsParagraph(record),
    getClosingParagraph(),
  ].filter(Boolean)

  return paragraphs.join('\n\n')
}

export function generateDraftNarrative(
  record,
  options = { style: DEFAULT_DRAFT_TEXT_STYLE },
) {
  const style = options.style || DEFAULT_DRAFT_TEXT_STYLE

  if (style === DRAFT_TEXT_STYLES.BRIEF) {
    return generateBriefNarrative(record)
  }

  return generateCompleteNarrative(record)
}
