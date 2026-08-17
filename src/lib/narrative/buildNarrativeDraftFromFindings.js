import {
  normalizeClinicalRecommendationText,
  normalizeRecommendationsForArea,
  normalizeRestrictionItems,
} from "./clinicalRecommendationNormalizer.js";

const TERM_REPLACEMENTS = [
  [/\bAPTO CON RESTRICCIONES\b/gi, "apto con restricciones"],
  [/\bNO APTO\b/gi, "no apto"],
  [/\bAPTO\b/gi, "apto"],
  [/\bPENDIENTE\b/gi, "pendiente"],
  [/\bIMC\b/gi, "indice de masa corporal"],
  [/\bPTERIGION\b/gi, "pterigion"],
  [/\bPRESBICIA\b/gi, "presbicia"],
  [/\bAMETROPIA\b/gi, "ametropia"],
  [/\bHIPERTRIGLICERIDEMIA\b/gi, "hipertrigliceridemia"],
  [/\bHIPERGLICEMIA\b/gi, "hiperglicemia"],
  [/\bHIPERLIPIDEMIA MIXTA\b/gi, "hiperlipidemia mixta"],
  [/\bONICOMICOSIS\b/gi, "onicomicosis"],
  [/\bENDOCRINOLOGIA\b/gi, "endocrinologia"],
  [/\bOFTALMOLOGIA\b/gi, "oftalmologia"],
  [/\bOTORRINOLARINGOLOGIA\b/gi, "otorrinolaringologia"],
  [/\bDERMATOLOGIA\b/gi, "dermatologia"],
  [/\bNUTRICION\b/gi, "nutricion"],
  [/\bACTIVIDAD FISICA\b/gi, "actividad fisica"],
  [/\bCALORIAS\b/gi, "calorias"],
  [/\bFISICO\b/gi, "fisico"],
];

const LOWERCASE_NAME_WORDS = new Set(["de", "del", "la", "las", "los", "y"]);

const FINAL_TEXT_REPLACEMENTS = [
  [/\bBuenos dias\b/g, "Buenos días"],
  [/\bclinica\b/g, "clínica"],
  [/\bevaluacion\b/g, "evaluación"],
  [/\bmedica\b/g, "médica"],
  [/\bindice\b/g, "índice"],
  [/\bcentimetros\b/g, "centímetros"],
  [/\barea\b/g, "área"],
  [/\bmetabolica\b/g, "metabólica"],
  [/\blimite\b/g, "límite"],
  [/\btrigliceridos\b/g, "triglicéridos"],
  [/\bAdemas\b/g, "Además"],
  [/\bendocrinologia\b/g, "endocrinología"],
  [/\bcardiologia\b/g, "cardiología"],
  [/\boftalmologica\b/g, "oftalmológica"],
  [/\bpterigion\b/g, "pterigión"],
  [/\baudiometrica\b/g, "audiométrica"],
  [/\bdermatologia\b/g, "dermatología"],
  [/\bdemas\b/g, "demás"],
  [/\bexamenes\b/g, "exámenes"],
  [/\bcalificacion\b/g, "calificación"],
  [/\balteracion\b/g, "alteración"],
  [/\bdermatologicos\b/g, "dermatológicos"],
  [/\bperiodos\b/g, "períodos"],
  [/\batencion\b/g, "atención"],
  [/\belectricas\b/g, "eléctricas"],
  [/\bmedico\b/g, "médico"],
  [/\bA continuacion\b/g, "A continuación"],
  [/\ba continuacion\b/g, "a continuación"],
  [/\bsanguineo\b/g, "sanguíneo"],
  [/\boftalmologia\b/g, "oftalmología"],
  [/\baudiometria\b/g, "audiometría"],
  [/\bantropometricos\b/g, "antropométricos"],
  [/\bespirometrica\b/g, "espirométrica"],
  [/\bradiografia\b/g, "radiografía"],
  [/\brestriccion\b/g, "restricción"],
  [/\bseria\b/g, "sería"],
  [/\bseÃ±or\b/g, "señor"],
  [/\bseÃ±ora\b/g, "señora"],
  [/\bsanguÃ­neo\b/g, "sanguíneo"],
  [/\bfisica\b/g, "física"],
  [/\bfisico\b/g, "físico"],
  [/\bcalorias\b/g, "calorías"],
  [/\bnutricion\b/g, "nutrición"],
  [/\bmusculoesqueletica\b/g, "musculoesquelética"],
  [/\bmusculoesqueletico\b/g, "musculoesquelético"],
  [/\bametropia\b/g, "ametropía"],
  [/\bnutrici\?n\b/g, "nutrición"],
  [/\boftalmolog\?a\b/g, "oftalmología"],
  [/\botorrinolaringologia\b/g, "otorrinolaringología"],
  [/\bproteccion\b/g, "protección"],
  [/\bexposicion\b/g, "exposición"],
  [/\bvision\b/g, "visión"],
  [/\bestereoscopica\b/g, "estereoscópica"],
  [/\bproximo\b/g, "próximo"],
  [/\brenovacion\b/g, "renovación"],
  [/\borientacion\b/g, "orientación"],
  [/\blimites\b/g, "límites"],
  [/\bmaximos\b/g, "máximos"],
  [/\brelacionado con índice\b/g, "relacionado con el índice"],
];

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function cleanupSpaces(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function cleanupSentence(value) {
  return cleanupSpaces(value)
    .replace(/(^|\s)\d+(?:\s*[,Y]\s*\d+)+\.?(?=\s+[A-Za-zÁÉÍÓÚÑ])/gi, "$1")
    .replace(/(^|\s)\[\d+(?:,\d+)*(?:y\d+)?\]\s*/gi, "$1")
    .replace(/(^|\s)\d+(?:,\d+)*(?:y\d+)?\.(?=\s+[A-Za-zÁÉÍÓÚÑ])/gi, "$1")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/,(\S)/g, ", $1")
    .replace(/\s+\./g, ".")
    .replace(/se recomienda\s+se recomienda/gi, "se recomienda")
    .replace(/Por ello, se recomienda\s+por ello, se recomienda/gi, "Por ello, se recomienda")
    .replace(/\.\s+y\b/gi, ", y")
    .replace(/\.\s+seguir\b/gi, ", seguir")
    .replace(/\.\s+pr[oó]ximo\b/gi, " y realizar próximo")
    .replace(/\.\s+control\s+mensual\s+de\s+peso\b/gi, ", realizar control mensual de peso")
    .replace(/\.\s+control\s+por\s+(nutricion|nutrición)\b/gi, ", y acudir a control por nutrición")
    .replace(/\.\s+control\s+por\s+endocrinologia\b/gi, ", y acudir a control por endocrinología")
    .replace(/\.\s+control\s+por\s+oftalmologia\b/gi, ", control por oftalmología")
    .replace(/\.\s+control\s+por\s+otorrinolaringologia\b/gi, " y control por otorrinolaringología")
    .replace(/\. y seguir/gi, " y seguir")
    .replace(/([.!?]\s+)(\p{Ll})/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("es-PE")}`)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupParagraph(value) {
  const text = cleanupSentence(value);
  return text ? text.replace(/([^.!?])$/g, "$1.") : "";
}

function toNaturalName(value) {
  return cleanupSpaces(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && LOWERCASE_NAME_WORDS.has(word)) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function normalizeClinicalText(value) {
  let text = cleanupSpaces(value);

  TERM_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  return text
    .replace(/\bii\s*(?:°|Â°|\?)/gi, "segundo grado")
    .replace(/\biii\s*(?:°|Â°|\?)/gi, "tercer grado")
    .replace(/\bi\s*(?:°|Â°|\?)/gi, "primer grado")
    .replace(/\bemetrope\b/gi, "")
    .replace(/\bde segundo grado\s+ojo izquierdo\b/gi, "de segundo grado en el ojo izquierdo")
    .replace(/\bde segundo grado\s+ojo derecho\b/gi, "de segundo grado en el ojo derecho")
    .replace(/\bde segundo grado\s+bilateral\b/gi, "de segundo grado bilateral")
    .replace(
      /\bpresbicia corregida\s+ametropia corregida\s+pterigion\b/gi,
      "presbicia corregida, ametropia corregida y pterigion",
    )
    .replace(
      /\bpresbicia parcialmente corregida\s+ametropia parcialmente corregida\b/gi,
      "presbicia parcialmente corregida y ametropia parcialmente corregida",
    )
    .replace(/\bametropia parcialmente corregida\s+pterigion\b/gi, "ametropia parcialmente corregida y pterigion")
    .replace(/\bpresbicia\s+pterigion\b/gi, "presbicia y pterigion")
    .replace(/\bleve ptosis palpebral\s+ojo derecho\b/gi, "leve ptosis palpebral en el ojo derecho")
    .replace(/\bleve ptosis palpebral\s+ojo izquierdo\b/gi, "leve ptosis palpebral en el ojo izquierdo")
    .replace(/\bojo izquierdo\s+leve ptosis palpebral\b/gi, "ojo izquierdo y leve ptosis palpebral")
    .replace(/\bojo derecho\s+leve ptosis palpebral\b/gi, "ojo derecho y leve ptosis palpebral")
    .replace(/\botras alteraciones no debidas a ruido\b/gi, "alteraciones no debidas a ruido")
    .replace(
      /\bno realizar actividades expuesto a ruido\b/gi,
      "no realizar actividades con exposicion a ruido",
    )
    .replace(
      /\bexpuesto a ruido por encima de los limites maximos permitidos sin proteccion auditiva\b/gi,
      "con exposicion a ruido por encima de los limites maximos permitidos sin proteccion auditiva",
    )
    .replace(/\bojo izquierdo\b/gi, "el ojo izquierdo")
    .replace(/\bojo derecho\b/gi, "el ojo derecho")
    .replace(/\bGlucosa:\s*([\d.,]+)\s*\(([^)]+)\)/gi, "glucosa elevada")
    .replace(/\bTrigliceridos:\s*([\d.,]+)\s*\(limite alto\)/gi, "trigliceridos en limite alto")
    .replace(/\bTrigliceridos:\s*([\d.,]+)\s*\(([^)]+)\)/gi, "trigliceridos elevados")
    .replace(/\bColesterol:\s*([\d.,]+)\s*\(limite alto\)/gi, "colesterol en limite alto")
    .replace(/\bColesterol:\s*([\d.,]+)\s*\((?:elevado|alto)\)/gi, "colesterol elevado")
    .replace(/\bLeucocitos:\s*([\d.,]+)\s*\(ligeramente elevados\)/gi, "leucocitos ligeramente elevados")
    .replace(/\bPlaquetas:\s*([\d.,]+)\s*\((disminuidas|elevadas)\)/gi, "plaquetas $2")
    .replace(/\bIMC\s*([\d.,]+):\s*/gi, "indice de masa corporal $1, ")
    .replace(/\bemetrope\b/gi, "")
    .replace(/\ben regular estado fisico musculo esqueletico\b/gi, "regular estado fisico musculoesqueletico")
    .replace(/\ben regular estado fisico musculoesqueletico\b/gi, "regular estado fisico musculoesqueletico")
    .replace(/\bmusculo esqueletico\b/gi, "musculoesqueletico")
    .replace(/\bcorrelacionado a\b/gi, "relacionado con")
    .toLowerCase()
    .replace(/\btipo i\b/g, "tipo uno")
    .replace(/\btipo ii\b/g, "tipo dos")
    .replace(/\btipo iii\b/g, "tipo tres")
    .replace(/\b(a|b|o|ab) positivo\b/g, (match, group) => `${group.toUpperCase()} positivo`)
    .replace(/\b(a|b|o|ab) negativo\b/g, (match, group) => `${group.toUpperCase()} negativo`)
    .replace(/\bel el ojo\b/g, "el ojo")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRecommendation(value) {
  return normalizeClinicalRecommendationText(normalizeClinicalText(value))
    .replace(/(^|\s)\[\d+(?:,\d+)*(?:y\d+)?\]\s*/gi, "$1")
    .replace(/(^|\s)\d+(?:,\d+)*(?:y\d+)?\.\s+/gi, "$1")
    .replace(/^se recomienda\s+/i, "")
    .replace(/^recomienda\s+/i, "")
    .replace(/^por ello,\s*/i, "")
    .replace(/^uso de correctores/i, "el uso de correctores")
    .replace(/^uso permanente/i, "el uso permanente")
    .replace(/\bdieta baja\b/gi, "mantener una dieta baja")
    .replace(/\bmantener dieta\b/gi, "mantener una dieta")
    .replace(/\buso de hidratantes oculares\b/gi, "hidratantes oculares")
    .replace(/\buso de protectores auditivos\b/gi, "el uso de protectores auditivos")
    .replace(/\bcontrol por nutrici\?n\b/gi, "acudir a control por nutricion")
    .replace(/\bcontrol por nutricion\b/gi, "acudir a control por nutricion")
    .replace(/\.\s*control por nutricion\b/gi, ", y acudir a control por nutricion")
    .replace(/\.\s*control por endocrinologia\b/gi, ", y acudir a control por endocrinologia")
    .replace(/^control control\b/i, "control")
    .replace(/\bcontrol control\b/gi, "control")
    .replace(/,\s*y\s+/gi, " y ")
    .replace(/[.]+$/g, "")
    .trim();
}

function uniqueTexts(values, normalizer = normalizeClinicalText) {
  const seen = new Set();

  return values
    .map((value) => normalizer(value))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function joinNatural(items) {
  const values = items.filter(Boolean);

  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} y ${values[1]}`;

  return `${values.slice(0, -1).join(", ")} y ${values[values.length - 1]}`;
}

function textHasAny(value, terms) {
  const text = normalizeClinicalText(value);
  return terms.some((term) => text.includes(term));
}

function joinRecommendationFragments(value) {
  return cleanupSpaces(value)
    .replace(/\.\s+control\s+mensual\s+de\s+peso\b/gi, ", realizar control mensual de peso")
    .replace(/\.\s+control\s+por\s+nutricion\b/gi, ", y acudir a control por nutricion")
    .replace(/\.\s+control\s+por\s+endocrinologia\b/gi, ", seguir control por endocrinologia")
    .replace(/\.\s+evaluacion\s+por\s+endocrinologia\b/gi, ", seguir control por endocrinologia")
    .replace(/\bseguimiento\s+y\s+control\s+por\s+endocrinologia\b/gi, "seguimiento por endocrinologia")
    .replace(/\.\s+seguir\s+indicaciones\s+de\s+medico\s+especialista\b/gi, ", seguir las indicaciones del medico especialista")
    .replace(/\.\s+seguir\s+las\s+indicaciones\s+del\s+medico\s+especialista\b/gi, ", seguir las indicaciones del medico especialista")
    .replace(/\.\s+proximo\s+control\s+anual\b/gi, " y realizar proximo control anual")
    .replace(/\.\s+proximo\s+control\s+en\s+(\d+)\s+meses\b/gi, " y realizar proximo control en $1 meses")
    .replace(/\.\s+control\s+por\s+otorrinolaringologia\b/gi, " y control por otorrinolaringologia")
    .replace(/\.\s+interconsulta\s+por\s+otorrinolaringologia\b/gi, " e interconsulta por otorrinolaringologia")
    .replace(/\.\s+control\s+por\s+oftalmologia\b/gi, ", control por oftalmologia")
    .replace(/\.\s+uso\s+de\s+correctores\s+oculares\b/gi, ", uso de correctores oculares")
    .replace(/\.\s+uso\s+de\s+hidratantes\s+oculares\b/gi, ", uso de hidratantes oculares")
    .replace(/\.\s+renovacion\b/gi, ", renovacion")
    .trim();
}

function dedupeRecommendationConcepts(recommendations) {
  const values = [];
  const hasCombinedEndocrineNutrition = recommendations.some((item) =>
    textHasAny(item, ["control por endocrinologia y nutricion", "endocrinologia y nutricion"]),
  );

  recommendations.forEach((item) => {
    const text = normalizeClinicalText(item);

    if (!text) return;

    if (
      hasCombinedEndocrineNutrition &&
      (text === "evaluacion por endocrinologia" ||
        text === "control por endocrinologia" ||
        text === "control por nutricion" ||
        text === "acudir a control por nutricion")
    ) {
      return;
    }

    if (
      values.some((existing) => textHasAny(existing, ["endocrinologia"])) &&
      (text === "evaluacion por endocrinologia" || text === "control por endocrinologia")
    ) {
      return;
    }

    if (
      values.some((existing) => textHasAny(existing, ["nutricion"])) &&
      (text === "control por nutricion" || text === "acudir a control por nutricion")
    ) {
      return;
    }

    values.push(item);
  });

  return values;
}

function normalizeAreaRecommendations(group, area = "") {
  const normalizedByArea = normalizeRecommendationsForArea(area || group?.area, group);
  if (normalizedByArea.length) return normalizedByArea;

  return dedupeRecommendationConcepts(getRecommendationTexts(group).map(joinRecommendationFragments));
}

function joinMetabolicFindings(items) {
  const values = items.filter(Boolean);
  const mixedIndex = values.findIndex((item) => item.includes("compatible con hiperlipidemia mixta"));

  if (mixedIndex > 0) {
    const mixed = values[mixedIndex];
    const before = values.filter((_, index) => index !== mixedIndex);
    return `${before.join(", ")}, ${mixed}`;
  }

  return joinNatural(values);
}

function getRecommendationTexts(group) {
  return uniqueTexts(
    (group?.recomendaciones || []).map(
      (item) => item.texto_normalizado || item.texto_original,
    ),
    normalizeRecommendation,
  );
}

function getFindingTexts(group, options = {}) {
  return uniqueTexts(
    (group?.hallazgos || [])
      .filter((item) => item.narrar !== false)
      .filter((item) => (options.tipo ? item.tipo === options.tipo : true))
      .map((item) => item.resultado),
  );
}

function hasNarrableGroupFindings(group) {
  return Boolean(
    group?.hallazgos?.some((item) => item.narrar !== false),
  );
}

function getTreatment(saludo = {}) {
  const sexo = normalizeClinicalText(saludo.sexo);

  if (sexo.includes("masculino") || sexo === "m") {
    return "señor";
  }

  if (sexo.includes("femenino") || sexo === "f") {
    return "señora";
  }

  return "";
}

function getNaturalGreetingName(saludo = {}) {
  const orderedName = [saludo.nombres, saludo.apellidos].filter(Boolean).join(" ");
  return toNaturalName(orderedName || saludo.nombre_para_saludo || "");
}

function buildGreeting(findings) {
  const name = getNaturalGreetingName(findings.saludo);
  const treatment = getTreatment(findings.saludo);
  const salutationName = [treatment, name].filter(Boolean).join(" ");

  if (!salutationName) {
    return "Buenos dias. Le saludamos de parte de la clinica Innomedic. A continuacion, le brindaremos el resumen de su evaluacion medica.";
  }

  return `Buenos dias, ${salutationName}. Le saludamos de parte de la clinica Innomedic. A continuacion, le brindaremos el resumen de su evaluacion medica.`;
}

function buildAnthropometryAndHemoglobin(findings) {
  const data = findings.antropometria || {};
  const lab = findings.laboratorio_basico || {};
  const fragments = [];

  if (hasText(data.peso_kg) && hasText(data.talla_cm) && hasText(data.imc)) {
    const classification = normalizeClinicalText(data.clasificacion_imc);
    let sentence = `Su peso es ${data.peso_kg} kilogramos y su talla es ${data.talla_cm} centimetros, por lo que su indice de masa corporal es de ${data.imc}`;

    if (classification === "normal") {
      sentence += ", valor que se encuentra dentro del rango normal.";
    } else if (classification) {
      sentence += `, correspondiente a ${classification}.`;
    } else {
      sentence += ".";
    }

    fragments.push(sentence);
  } else {
    const partialAnthropometry = [];

    if (hasText(data.peso_kg)) {
      partialAnthropometry.push(`su peso es ${data.peso_kg} kilogramos`);
    }

    if (hasText(data.talla_cm)) {
      partialAnthropometry.push(`su talla es ${data.talla_cm} centimetros`);
    }

    if (hasText(data.imc)) {
      const classification = normalizeClinicalText(data.clasificacion_imc);
      const imcText = classification
        ? `su indice de masa corporal es de ${data.imc}, correspondiente a ${classification}`
        : `su indice de masa corporal es de ${data.imc}`;
      partialAnthropometry.push(imcText);
    }

    if (partialAnthropometry.length) {
      fragments.push(`En sus datos antropometricos, ${joinNatural(partialAnthropometry)}.`);
    }
  }

  if (hasText(lab.hemoglobina_valor)) {
    const unit = hasText(lab.hemoglobina_unidad) ? ` ${lab.hemoglobina_unidad}` : "";
    const statusText = lab.hemoglobina_estado === "NORMAL"
      ? " y se encuentra dentro del rango normal de referencia"
      : lab.hemoglobina_estado === "LOW"
        ? " y se encuentra baja, por debajo del rango de referencia"
        : lab.hemoglobina_estado === "HIGH"
          ? " y se encuentra elevada, por encima del rango de referencia"
          : "";
    fragments.push(`En sus resultados de laboratorio, su hemoglobina es de ${lab.hemoglobina_valor}${unit}${statusText}.`);
  }

  const classification = normalizeClinicalText(data.clasificacion_imc);
  const hasMetabolicFindings = hasNarrableGroupFindings(findings.narrative_groups?.metabolico);
  let imcRecommendation = "";
  if (
    !hasMetabolicFindings &&
    ["sobrepeso", "obesidad tipo uno", "obesidad tipo dos", "obesidad tipo tres"].includes(classification)
  ) {
    const recommendation = normalizeRecommendation(data.recomendacion);
    if (recommendation) {
      const reason =
        classification === "sobrepeso"
          ? "Debido al sobrepeso"
          : "Por el índice de masa corporal consignado";
      imcRecommendation = `${reason}, se recomienda ${joinRecommendationFragments(recommendation)}.`;
    }
  }

  return [cleanupParagraph(fragments.join(" ")), cleanupParagraph(imcRecommendation)]
    .filter(Boolean)
    .join("\n\n");
}

function buildBloodType(findings) {
  const data = findings.laboratorio_basico || {};
  const bloodType = normalizeClinicalText(data.grupo_sanguineo);

  return bloodType ? cleanupParagraph(`Su grupo sanguíneo es ${bloodType}.`) : "";
}

function hasGroupFinding(group, pattern) {
  return Boolean(
    group?.hallazgos?.some((item) => pattern.test(normalizeClinicalText(item.resultado))),
  );
}

function normalizeOphthalmologyFindingText(value) {
  return normalizeClinicalText(value)
    .replace(/\bpresbicia\s+ametropia\b/gi, "presbicia, ametropia")
    .replace(/\bpresbicia,\s+ametropia\s+vision\b/gi, "presbicia, ametropia, vision")
    .replace(/\bpresbicia\s+vision\b/gi, "presbicia, vision")
    .replace(/\bametropia\s+visi[oó]n\b/gi, "ametropia, visión")
    .replace(/\bvision estereoscopica alterada\s+pterigion\b/gi, "vision estereoscopica alterada y pterigion")
    .replace(/\bametropia parcialmente corregida\s+y\s+pterigion\b/gi, "ametropia parcialmente corregida y pterigion")
    .replace(/\bojo izquierdo\s+leve ptosis palpebral\b/gi, "ojo izquierdo y leve ptosis palpebral")
    .replace(/\bojo derecho\s+leve ptosis palpebral\b/gi, "ojo derecho y leve ptosis palpebral")
    .replace(/\b(presbicia(?: parcialmente)? corregida|ametropia(?: parcialmente)? corregida|presbicia|ametropia|discromatopsia)\s+(?=ametropia|pterigion|discromatopsia|visi[oó]n)/gi, "$1, ")
    .replace(/\bpterigion de (primer|segundo|tercer) grado (el ojo (?:izquierdo|derecho))\b/gi, "pterigion de $1 grado en $2")
    .replace(/\bpterigion (primer|segundo|tercer) grado\b/gi, "pterigion de $1 grado")
    .replace(/,\s+y\s+/gi, " y ")
    .trim();
}

function buildMetabolicParagraph(group) {
  if (!group?.narrar) return "";

  const classifiedItems = (group.hallazgos || []).filter((item) => item.reference_classification);
  const normalAnalytes = [
    ["glucosa_valor", "glucosa"],
    ["colesterol_valor", "colesterol"],
    ["trigliceridos_valor", "triglicéridos"],
  ].filter(([field]) => classifiedItems.some(
    (item) => item.field?.endsWith(field) && item.reference_classification === "NORMAL",
  )).map(([, label]) => label);
  const normalSummary = normalAnalytes.length === 0
    ? ""
    : normalAnalytes.length === 1
      ? `Su resultado de ${normalAnalytes[0]} se encuentra dentro del rango de referencia.`
      : `Sus resultados de ${joinNatural(normalAnalytes)} se encuentran dentro de los rangos de referencia.`;
  const classificationSentences = classifiedItems
    .filter((item) => item.reference_classification !== "NORMAL")
    .map((item) => {
    const value = item.source_value || item.value;
    const unit = item.unit || "mg/dL";
    if (item.field?.endsWith("glucosa_valor")) {
      const relation = item.reference_classification === "LOW"
        ? "por debajo del rango de referencia"
        : item.reference_classification === "HIGH"
          ? "por encima del rango de referencia"
          : "dentro del rango de referencia";
      return `Su glucosa es de ${value} ${unit} y se encuentra ${relation}.`;
    }
    const descriptions = {
      NORMAL: "dentro del rango normal reportado",
      BORDERLINE_HIGH: "en el rango límite alto reportado",
      HIGH: "en el rango alto reportado",
      VERY_HIGH: "en el rango muy alto reportado",
    };
    const description = descriptions[item.reference_classification];
    if (item.field?.endsWith("colesterol_valor")) {
      return `Su colesterol total es de ${value} ${unit} y se encuentra ${description}.`;
    }
    return `Sus triglicéridos son de ${value} ${unit} y se encuentran ${description}.`;
  });
  const unclassifiedGroup = {
    ...group,
    hallazgos: (group.hallazgos || []).filter((item) =>
      !item.reference_classification && !item.source_classification_status
    ),
  };
  let findings = getFindingTexts(unclassifiedGroup).filter(
    (finding) =>
      !finding.includes("indice de masa corporal") &&
      !finding.includes("índice de masa corporal"),
  );
  const recommendations = normalizeAreaRecommendations(group, "metabolico");
  const sourceStatements = (group.hallazgos || [])
    .filter((item) => item.narrar !== false && item.source_classification_status)
    .map((item) => {
      const sourceText = normalizeClinicalText(item.resultado);
      return item.source_classification_status === "DISCREPANT"
        ? `La fuente también reporta ${sourceText}; este dato no coincide con la clasificación numérica y requiere revisión.`
        : `Además, la fuente reporta ${sourceText}.`;
    });

  if (!findings.length && !normalSummary && !classificationSentences.length && !sourceStatements.length) return "";

  const hasGlucose = findings.some((finding) => finding.includes("glucosa"));
  const hasHyperglycemia = hasGroupFinding(group, /hiperglicemia/);
  const hasHyperglycemiaTreatment = Boolean(
    group.hallazgos?.some((item) =>
      normalizeClinicalText(item.resultado).includes("hiperglicemia en tratamiento"),
    ),
  );
  const hasTriglycerides = findings.some((finding) => finding.includes("trigliceridos"));
  const hasHypertriglyceridemia = hasGroupFinding(group, /hipertrigliceridemia/);
  const hasCholesterol = findings.some((finding) => finding.includes("colesterol"));
  const hasMixedHyperlipidemia = hasGroupFinding(group, /hiperlipidemia mixta/);

  if (hasGlucose && hasHyperglycemiaTreatment) {
    findings = findings.map((finding) =>
      finding.includes("glucosa") ? "glucosa elevada en tratamiento" : finding,
    );
  }

  if (hasMixedHyperlipidemia && (hasTriglycerides || hasCholesterol)) {
    const lipidFindings = findings.filter(
      (finding) => finding.includes("trigliceridos") || finding.includes("colesterol"),
    );
    findings = findings.filter(
      (finding) =>
        !finding.includes("trigliceridos") &&
        !finding.includes("colesterol") &&
        !finding.includes("hiperlipidemia mixta"),
    );
    findings.push(`${joinNatural(lipidFindings)}, compatible con hiperlipidemia mixta`);
  } else {
    if (hasTriglycerides && hasHypertriglyceridemia) {
      findings = findings.filter((finding) => !finding.includes("hipertrigliceridemia"));
    }

    if (hasGlucose && hasHyperglycemia) {
      findings = findings.filter((finding) => !finding.includes("hiperglicemia"));
    }
  }

  findings = uniqueTexts(findings);

  const verb =
    findings.length === 1 &&
    !findings[0].includes("alteraciones") &&
    !findings[0].startsWith("trigliceridos") &&
    !findings[0].startsWith("leucocitos") &&
    !findings[0].startsWith("plaquetas")
      ? "se evidencia"
      : "se evidencian";
  let sentence = findings.length
    ? `En el area metabolica ${verb === "se evidencia" ? "se registra" : "se registran"} ${joinMetabolicFindings(findings)}.`
    : "";

  if (recommendations.length) {
    sentence += `${sentence ? " " : ""}Como parte de las recomendaciones de la evaluacion, se indica ${joinNatural(recommendations)}.`;
  }

  const classifiedText = [normalSummary, ...classificationSentences].map(cleanupParagraph).filter(Boolean).join(" ");
  const sourceText = sourceStatements.map(cleanupParagraph).join(" ");
  const cleanedSentence = [classifiedText, sourceText, cleanupParagraph(sentence)].filter(Boolean).join(" ");
  if (cleanedSentence.split(/\s+/).length <= 50 || !recommendations.length) {
    return cleanedSentence;
  }

  const findingSentence = findings.length
    ? cleanupParagraph(`En el area metabolica ${verb === "se evidencia" ? "se registra" : "se registran"} ${joinMetabolicFindings(findings)}`)
    : "";
  const recommendationSentence = cleanupParagraph(`Se recomienda ${joinNatural(recommendations)}`);
  return [classifiedText, sourceText, findingSentence, recommendationSentence].filter(Boolean).join(" ");
}

function buildOphthalmologyParagraph(group) {
  if (!group?.narrar) return "";

  const findings = uniqueTexts(
    (group?.hallazgos || [])
      .filter((item) => item.narrar !== false)
      .map((item) => item.resultado),
    normalizeOphthalmologyFindingText,
  );
  const recommendations = normalizeAreaRecommendations(group, "oftalmologia");

  if (!findings.length) return "";

  let paragraph = `En la evaluacion oftalmologica se registra ${joinNatural(findings)}.`;

  if (recommendations.length) {
    paragraph += group.association_status === "SAFE_ASSOCIATION"
      ? ` Por ello, se recomienda ${joinNatural(recommendations)}.`
      : ` Asimismo, se recomienda ${joinNatural(recommendations)}.`;
  }

  return cleanupParagraph(paragraph);
}

function buildAudiometryParagraph(group) {
  if (!group?.narrar) return "";

  const pending = getFindingTexts(group, { tipo: "pendiente" });
  if (pending.length) {
    return "La evaluacion audiometrica queda pendiente por reposo auditivo, por lo que se recomienda completar el control correspondiente.";
  }

  const findings = getFindingTexts(group);
  if (!findings.length) return "";

  const recommendations = normalizeAreaRecommendations(group, "audiometria");
  const verb =
    findings.length === 1 && !findings[0].includes("alteraciones")
      ? "se registra"
      : "se registran";
  const findingSentence = cleanupParagraph(`En la evaluacion audiometrica ${verb} ${joinNatural(findings)}`);
  const recommendationSentence = recommendations.length
    ? cleanupParagraph(`Asimismo, se recomienda ${joinNatural(recommendations)}`)
    : cleanupParagraph("Se recomienda el control correspondiente");
  return `${findingSentence} ${recommendationSentence}`;
}

function buildHemogramParagraph(group) {
  if (!group?.narrar) return "";

  const findings = getFindingTexts(group);
  if (!findings.length) return "";

  return cleanupParagraph(`Además, en el hemograma se observan ${joinNatural(findings)}.`);
}

function buildDermatologyParagraph(group) {
  if (!group?.narrar) return "";

  const findings = getFindingTexts(group);
  const recommendations = normalizeAreaRecommendations(group, "dermatologia");

  if (!findings.length && !recommendations.length) return "";

  const findingSentences = findings.map((finding) => {
    if (/^descartar\b/i.test(finding)) {
      return `En la evaluacion dermatologica se indica ${finding}.`;
    }
    if (/^sospecha de\b/i.test(finding)) {
      return `En la evaluacion dermatologica se reporta ${finding}.`;
    }
    if (/^compatible con\b/i.test(finding)) {
      return `En la evaluacion dermatologica se reporta un hallazgo ${finding}.`;
    }
    return `En la evaluacion dermatologica se reporta ${finding}.`;
  });
  const recommendationSentence = recommendations.length
    ? `Se recomienda ${joinNatural(recommendations)}.`
    : "";
  return cleanupParagraph([...findingSentences, recommendationSentence].filter(Boolean).join(" "));
}

function buildGenericAreaParagraph(group, label, area = "") {
  if (!group?.narrar) return "";
  if (group.suppress_standalone) return "";

  const findings = getFindingTexts(group);
  const recommendations = normalizeAreaRecommendations(group, area);

  if (!findings.length && !recommendations.length) return "";

  if (!findings.length) {
    return cleanupParagraph(`Se recomienda ${joinNatural(recommendations)}.`);
  }

  const preparedFindings = area === "musculoesqueletico"
    ? findings.map((finding) => finding
      .replace(/^en\s+(?=regular estado)/i, "")
      .replace(/^regular estado f[ií]sico musculoesquel[eé]tico\b/i, "un estado fisico musculoesqueletico regular"))
    : findings;
  const pluralSubject = preparedFindings.length > 1 || /^(?:signos|hallazgos|alteraciones)\b/i.test(preparedFindings[0]);
  let paragraph = `En ${label} ${pluralSubject ? "se registran" : "se registra"} ${joinNatural(preparedFindings)}.`;

  if (recommendations.length) {
    paragraph += group.association_status === "SAFE_ASSOCIATION"
      ? ` Por ello, se recomienda ${joinNatural(recommendations)}.`
      : ` Asimismo, se recomienda ${joinNatural(recommendations)}.`;
  }

  return cleanupParagraph(paragraph);
}

function buildInternalMedicineParagraph(group) {
  if (!group?.narrar) return "";

  const findings = getFindingTexts(group);
  const recommendations = normalizeAreaRecommendations(group, "medicina_interna");
  const anemia = findings.filter((finding) => /^anemia\.?$/i.test(finding));
  const remainingFindings = findings.filter((finding) => !/^anemia\.?$/i.test(finding));
  const sentences = [];

  if (anemia.length) sentences.push("Se reporta anemia.");
  if (remainingFindings.length) {
    sentences.push(cleanupParagraph(
      `En medicina interna ${remainingFindings.length > 1 ? "se registran" : "se registra"} ${joinNatural(remainingFindings)}.`,
    ));
  }
  if (recommendations.length) {
    sentences.push(cleanupParagraph(`Se recomienda ${joinNatural(recommendations)}.`));
  }

  return cleanupParagraph(sentences.join(" "));
}

function buildCardiologyParagraph(group) {
  if (!group?.narrar) return "";

  const findings = getFindingTexts(group);
  const recommendations = normalizeAreaRecommendations(group, "cardiologia");

  if (!findings.length && !recommendations.length) return "";

  if (!findings.length) {
    return cleanupParagraph(`Se recomienda ${joinNatural(recommendations)}.`);
  }

  return cleanupParagraph(
    `En el electrocardiograma se reporta ${joinNatural(findings)}. Se recomienda ${joinNatural(recommendations)}.`,
  );
}

function buildOccupationalParagraph(group, groups = {}) {
  if (!group?.narrar) return "";
  if (group.suppress_standalone) return "";

  const recommendations = normalizeAreaRecommendations(group, "ocupacional");
  if (!recommendations.length) return "";

  const text = joinNatural(recommendations);
  const hasHeightRestriction = text.includes("altura mayor a un metro ochenta");
  const hasStereoVisionFinding = Boolean(
    groups.oftalmologia?.hallazgos?.some((item) =>
      normalizeClinicalText(item.resultado).includes("vision estereoscopica alterada"),
    ),
  );

  if (hasHeightRestriction && hasStereoVisionFinding) {
    return cleanupParagraph(
      `Como restriccion laboral, por la alteracion de la vision estereoscopica, ${text}.`,
    );
  }

  return cleanupParagraph(`Como restriccion laboral, ${text}.`);
}

function buildFindingsParagraphs(findings) {
  const groups = findings.narrative_groups || {};

  return [
    buildMetabolicParagraph(groups.metabolico),
    buildHemogramParagraph(groups.hemograma),
    buildOphthalmologyParagraph(groups.oftalmologia),
    buildAudiometryParagraph(groups.audiometria),
    buildGenericAreaParagraph(groups.espirometria, "la evaluacion espirometrica", "espirometria"),
    buildGenericAreaParagraph(groups.neumologia, "la evaluacion respiratoria", "neumologia"),
    buildDermatologyParagraph(groups.dermatologia),
    buildInternalMedicineParagraph(groups.medicina_interna),
    buildGenericAreaParagraph(groups.musculoesqueletico, "la evaluacion musculoesqueletica", "musculoesqueletico"),
    buildGenericAreaParagraph(groups.radiografia_torax, "la radiografia de torax", "radiografia_torax"),
    buildCardiologyParagraph(groups.cardiologia),
    buildGenericAreaParagraph(groups.traumatologia, "traumatologia", "traumatologia"),
    buildGenericAreaParagraph(groups.gastroenterologia, "gastroenterologia", "gastroenterologia"),
    buildGenericAreaParagraph(groups.ginecologia, "ginecologia", "ginecologia"),
    buildGenericAreaParagraph(groups.psicologia, "psicologia clinica", "psicologia"),
    buildGenericAreaParagraph(groups.alergias, "alergias", "alergias"),
    buildGenericAreaParagraph(groups.vascular, "la evaluacion vascular", "vascular"),
    buildOccupationalParagraph(groups.ocupacional, groups),
    buildGenericAreaParagraph(groups.otros, "otros hallazgos", "otros"),
  ].filter(Boolean);
}

function buildNormalExams(findings) {
  if (findings.has_omitted_findings) {
    return "";
  }

  if (!findings.examenes_normales_resumibles?.length) {
    return "";
  }

  const areaLabels = {
    examen_orina: "el examen de orina",
    psicologico: "la evaluación psicológica",
    dosaje_cocaina: "el dosaje de cocaína",
    dosaje_marihuana: "el dosaje de marihuana",
    musculoesqueletico: "la evaluación musculoesquelética",
    ecg: "el electrocardiograma",
    audiometria: "la audiometría",
    oftalmologia: "la evaluación oftalmológica",
    espirometria: "la espirometría",
    radiografia_torax: "la radiografía de tórax",
    odontograma: "el odontograma",
  };
  const explicitAreas = Array.from(new Set(
    findings.examenes_normales_resumibles
      .map((item) => areaLabels[item.area])
      .filter(Boolean),
  ));

  return explicitAreas.length
    ? `No se reportan alteraciones relevantes en ${joinNatural(explicitAreas)}.`
    : "";
}

function splitRestrictions(value) {
  return normalizeRestrictionItems(normalizeClinicalText(value));
}

function buildRestrictionsSentence(value) {
  const restrictions = splitRestrictions(value);
  const inlineRestrictions = restrictions.map((item) =>
    item ? item.charAt(0).toLowerCase() + item.slice(1) : item,
  );

  if (!restrictions.length) return "";

  if (restrictions.length === 1) {
    return `Como restriccion laboral, ${inlineRestrictions[0]}.`;
  }

  const sentences = inlineRestrictions.map((item) => {
    const sentence = cleanupParagraph(item);
    return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : "";
  }).filter(Boolean);
  return `Como restricciones laborales: ${sentences.join(" ")}`;
}

function buildAptitude(findings) {
  if (!findings.aptitud?.narrar || !findings.aptitud.resultado) {
    return "";
  }

  let paragraph = `Por ello, su calificacion final es ${normalizeClinicalText(findings.aptitud.resultado)}.`;

  if (findings.restricciones?.narrar && findings.restricciones.texto) {
    const restrictionsSentence = buildRestrictionsSentence(findings.restricciones.texto);
    if (restrictionsSentence) {
      paragraph += ` ${restrictionsSentence}`;
    }
  }

  return cleanupParagraph(paragraph);
}

function buildClosing() {
  return "Eso seria todo. De presentar alguna duda adicional, no dude en consultar con el medico de su empresa. Muchas gracias.";
}

function cleanupFinalText(value) {
  return String(value || "")
    .split("\n\n")
    .map(cleanupParagraph)
    .filter(Boolean)
    .join("\n\n");
}

function polishFinalNarrativeText(value) {
  return String(value || "")
    .replace(/\.\s+y\b/gi, ", y")
    .replace(/\.\s+seguir\b/gi, ", seguir")
    .replace(/\.\s+próximo\b/gi, " y realizar próximo")
    .replace(/\.\s+control\s+mensual\s+de\s+peso\b/gi, ", realizar control mensual de peso")
    .replace(/\.\s+control\s+por\s+nutrición\b/gi, ", y acudir a control por nutrición")
    .replace(/\.\s+control\s+por\s+endocrinología\b/gi, ", seguir control por endocrinología")
    .replace(/\.\s+evaluación\s+por\s+endocrinología\b/gi, ", seguir control por endocrinología")
    .replace(/\.\s+seguimiento\s+por\s+endocrinología\b/gi, ", seguimiento por endocrinología")
    .replace(/\.\s+control\s+por\s+otorrinolaringología\b/gi, " y control por otorrinolaringología")
    .replace(/\.\s+interconsulta\s+por\s+otorrinolaringología\b/gi, " e interconsulta por otorrinolaringología")
    .replace(/\.\s+seguir\s+indicaciones\s+de\s+médico\s+especialista\b/gi, ", seguir las indicaciones del médico especialista")
    .replace(/\.\s+seguir\s+las\s+indicaciones\s+del\s+médico\s+especialista\b/gi, ", seguir las indicaciones del médico especialista")
    .replace(/\.\s+uso\s+de\s+correctores\s+oculares\b/gi, ", uso de correctores oculares")
    .replace(/\.\s+uso\s+de\s+hidratantes\s+oculares\b/gi, ", uso de hidratantes oculares")
    .replace(/\bzona\s+de\s+ruido\.\s+control\s+por\s+otorrinolaringología\b/gi, "zona de ruido y control por otorrinolaringología")
    .replace(/\bzona\s+de\s+ruido\.\s+interconsulta\s+por\s+otorrinolaringología\b/gi, "zona de ruido e interconsulta por otorrinolaringología")
    .replace(/\bseguimiento\s+y\s+control\s+por\s+endocrinología\b/gi, "seguimiento por endocrinología")
    .replace(/\bacudir\s+a\s+control\s+por\s+nutrición\s+y\s+seguimiento\s+y\s+control\s+por\s+endocrinología\b/gi, "acudir a control por nutrición y seguimiento por endocrinología")
    .replace(/\bhidratantes\s+oculares\.\s+uso\b/gi, "hidratantes oculares, uso")
    .replace(/\bendocrinología\s+y\s+nutrición\s+y\s+evaluación\s+por\s+endocrinología\b/gi, "endocrinología y nutrición")
    .replace(/\bendocrinología\s+y\s+nutrición\s+y\s+control\s+por\s+endocrinología\b/gi, "endocrinología y nutrición")
    .replace(/\bcontrol\s+por\s+endocrinología\s+y\s+nutrición\s+y\s+seguir\s+control\s+por\s+endocrinología\b/gi, "control por endocrinología y nutrición")
    .replace(/\bcontrol\s+por\s+endocrinología\s+y\s+nutrición\s+y\s+acudir\s+a\s+control\s+por\s+nutrición\b/gi, "control por endocrinología y nutrición")
    .replace(/\bse evidencia en regular estado físico musculo esqueletico\b/gi, "se evidencia regular estado físico musculoesquelético")
    .replace(/\bno realizar actividades con exposición a ruido por encima de los límites máximos permitidos sin el uso de protección auditiva\b/gi, "no realizar actividades con exposición a ruido por encima de los límites máximos permitidos sin protección auditiva")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/,(\S)/g, ", $1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeFinalNarrativeText(value) {
  let text = cleanupFinalText(value);

  FINAL_TEXT_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  return polishFinalNarrativeText(text)
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n\n")
    .map(cleanupParagraph)
    .filter(Boolean)
    .join("\n\n");
}

export function buildNarrativeDraftFromFindings(findings = {}) {
  const blockingReasons = findings.blocking_reasons || [];

  if (!findings.can_generate_narrative) {
    return {
      can_generate: false,
      blocking_reasons: blockingReasons,
      text: "",
      sections: {
        saludo: "",
        grupo_sanguineo: "",
        antropometria: "",
        hallazgos: [],
        examenes_normales: "",
        aptitud: "",
        cierre: "",
      },
    };
  }

  const sections = {
    saludo: buildGreeting(findings),
    grupo_sanguineo: buildBloodType(findings),
    antropometria: buildAnthropometryAndHemoglobin(findings),
    hallazgos: buildFindingsParagraphs(findings),
    examenes_normales: buildNormalExams(findings),
    aptitud: buildAptitude(findings),
    cierre: buildClosing(),
  };
  const text = normalizeFinalNarrativeText([
    sections.saludo,
    sections.grupo_sanguineo,
    sections.antropometria,
    ...sections.hallazgos,
    sections.examenes_normales,
    sections.aptitud,
    sections.cierre,
  ]
    .filter(Boolean)
    .join("\n\n"));

  return {
    can_generate: true,
    blocking_reasons: [],
    text,
    sections,
  };
}
