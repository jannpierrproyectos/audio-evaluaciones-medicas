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

function getRawRecommendationText(group) {
  return (group?.recomendaciones || [])
    .map((item) => `${item.texto_original || ""} ${item.texto_normalizado || ""}`)
    .join(" ");
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
    fragments.push(`En sus resultados de laboratorio, su hemoglobina es de ${lab.hemoglobina_valor}.`);
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

function splitMetabolicFindings(findings) {
  const hyper = [];
  const regular = [];

  findings.forEach((finding) => {
    if (finding.includes("hipertrigliceridemia") || finding.includes("hiperglicemia")) {
      hyper.push(finding);
    } else {
      regular.push(finding);
    }
  });

  const filteredRegular = regular.filter((finding) => {
    return !(finding.includes("trigliceridos") && hyper.length > 0 && finding.includes("elevados"));
  });

  return { regular: filteredRegular, hyper };
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
    .replace(/\bametropia\s+vision\b/gi, "ametropia, vision")
    .replace(/\bvision estereoscopica alterada\s+pterigion\b/gi, "vision estereoscopica alterada y pterigion")
    .replace(/\bametropia parcialmente corregida\s+y\s+pterigion\b/gi, "ametropia parcialmente corregida y pterigion")
    .replace(/\bojo izquierdo\s+leve ptosis palpebral\b/gi, "ojo izquierdo y leve ptosis palpebral")
    .replace(/\bojo derecho\s+leve ptosis palpebral\b/gi, "ojo derecho y leve ptosis palpebral")
    .replace(/,\s+y\s+/gi, " y ")
    .trim();
}

function normalizeOphthalmologyRecommendations(group) {
  const text = normalizeClinicalText(
    `${getRawRecommendationText(group)} ${normalizeAreaRecommendations(group).join(", ")}`,
  );
  const recommendations = [];

  if (text.includes("hidratantes oculares")) {
    recommendations.push("uso de hidratantes oculares");
  }

  if (text.includes("correctores oculares") || text.includes("lentes")) {
    recommendations.push("uso de correctores oculares");
  }

  if (text.includes("renovacion")) {
    recommendations.push("renovacion");
  }

  if (text.includes("oftalmologia")) {
    recommendations.push("control por oftalmologia");
  }

  return recommendations.length ? uniqueTexts(recommendations, normalizeClinicalText) : normalizeAreaRecommendations(group);
}

function normalizeAudiometryRecommendations(group) {
  const text = normalizeClinicalText(
    `${getRawRecommendationText(group)} ${normalizeAreaRecommendations(group).join(", ")}`,
  );
  const recommendations = [];

  if (text.includes("protectores auditivos") && text.includes("zona de ruido")) {
    recommendations.push("el uso de protectores auditivos en zona de ruido");
  }

  if (text.includes("interconsulta") && text.includes("otorrinolaringologia")) {
    recommendations.push("interconsulta por otorrinolaringologia");
  } else if (text.includes("otorrinolaringologia") || text.includes("otorrino")) {
    recommendations.push("control por otorrinolaringologia");
  }

  if (text.includes("seguir indicaciones") || text.includes("indicaciones del medico especialista")) {
    recommendations.push("seguir las indicaciones del medico especialista");
  }

  const nextControl = text.match(/proximo control (?:en\s+\d+\s+meses|anual)/);
  if (nextControl) {
    recommendations.push(`realizar ${nextControl[0]}`);
  }

  return recommendations.length ? uniqueTexts(recommendations, normalizeClinicalText) : normalizeAreaRecommendations(group);
}

function normalizeOccupationalRecommendations(group) {
  const text = normalizeClinicalText(
    `${getRawRecommendationText(group)} ${normalizeAreaRecommendations(group).join(", ")}`,
  );
  const recommendations = [];
  const heightMatch = text.match(/no debe trabajar en altura mayor a 1\.80 metros/);

  if (heightMatch) {
    recommendations.push(heightMatch[0]);
  }

  const noiseMatch = text.match(
    /no realizar actividades con exposicion a ruido por encima de los limites maximos permitidos sin (?:el uso de )?proteccion auditiva/,
  );

  if (noiseMatch) {
    recommendations.push(noiseMatch[0].replace("sin el uso de proteccion auditiva", "sin proteccion auditiva"));
  }

  return recommendations.length ? uniqueTexts(recommendations, normalizeClinicalText) : normalizeAreaRecommendations(group);
}

function buildMetabolicParagraph(group) {
  if (!group?.narrar) return "";

  let findings = getFindingTexts(group).filter(
    (finding) =>
      !finding.includes("indice de masa corporal") &&
      !finding.includes("índice de masa corporal"),
  );
  const recommendations = normalizeAreaRecommendations(group, "metabolico");

  if (!findings.length) return "";

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

  if (!findings.length) return "";

  const verb =
    findings.length === 1 &&
    !findings[0].includes("alteraciones") &&
    !findings[0].startsWith("trigliceridos") &&
    !findings[0].startsWith("leucocitos") &&
    !findings[0].startsWith("plaquetas")
      ? "se evidencia"
      : "se evidencian";
  let sentence = `En el area metabolica ${verb} ${joinMetabolicFindings(findings)}.`;

  if (recommendations.length) {
    sentence = sentence.replace(/\.$/, "");
    sentence += `, por lo que se recomienda ${joinNatural(recommendations)}.`;
  }

  return cleanupParagraph(sentence);
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

  let paragraph = `En la evaluacion oftalmologica se evidencia ${joinNatural(findings)}.`;

  if (recommendations.length) {
    paragraph += ` Por ello, se recomienda ${joinNatural(recommendations)}.`;
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
  const suffix = recommendations.length
    ? `, por lo que se recomienda ${joinNatural(recommendations)}.`
    : ", por lo que se recomienda el control correspondiente.";

  const verb =
    findings.length === 1 && !findings[0].includes("alteraciones")
      ? "se evidencia"
      : "se evidencian";
  return cleanupParagraph(`En la evaluacion audiometrica ${verb} ${joinNatural(findings)}${suffix}`);
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

  const hasOnicomicosis = findings.some((item) => item.includes("onicomicosis"));

  if (hasOnicomicosis) {
    return cleanupParagraph("Por los hallazgos dermatologicos registrados, se recomienda evaluacion por dermatologia.");
  }

  if (recommendations.length) {
    return cleanupParagraph(`Asimismo, se recomienda ${joinNatural(recommendations)}.`);
  }

  return cleanupParagraph(`Asimismo, se evidencia ${joinNatural(findings)}.`);
}

function buildGenericAreaParagraph(group, label, area = "") {
  if (!group?.narrar) return "";

  const findings = getFindingTexts(group);
  const recommendations = normalizeAreaRecommendations(group, area);

  if (!findings.length && !recommendations.length) return "";

  if (!findings.length) {
    return cleanupParagraph(`Se recomienda ${joinNatural(recommendations)}.`);
  }

  let paragraph = `En ${label} se evidencia ${joinNatural(findings)}.`;

  if (recommendations.length) {
    paragraph += ` Por ello, se recomienda ${joinNatural(recommendations)}.`;
  }

  return cleanupParagraph(paragraph);
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
    `En el electrocardiograma se consigna ${joinNatural(findings)}, por lo que se recomienda ${joinNatural(recommendations)}.`,
  );
}

function buildOccupationalParagraph(group, groups = {}) {
  if (!group?.narrar) return "";

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
    buildGenericAreaParagraph(groups.neumologia, "la evaluacion espirometrica", "neumologia"),
    buildDermatologyParagraph(groups.dermatologia),
    buildGenericAreaParagraph(groups.medicina_interna, "medicina interna", "medicina_interna"),
    buildGenericAreaParagraph(groups.musculoesqueletico, "la evaluacion musculoesqueletica", "musculoesqueletico"),
    buildGenericAreaParagraph(groups.radiografia_torax, "la radiografia de torax", "radiografia_torax"),
    buildCardiologyParagraph(groups.cardiologia),
    buildGenericAreaParagraph(groups.traumatologia, "traumatologia", "traumatologia"),
    buildGenericAreaParagraph(groups.gastroenterologia, "gastroenterologia", "gastroenterologia"),
    buildGenericAreaParagraph(groups.ginecologia, "ginecologia", "ginecologia"),
    buildGenericAreaParagraph(groups.psicologia, "psicologia clinica", "psicologia"),
    buildGenericAreaParagraph(groups.alergias, "alergias", "alergias"),
    buildGenericAreaParagraph(groups.vascular, "insuficiencia venosa", "vascular"),
    buildOccupationalParagraph(groups.ocupacional, groups),
    buildGenericAreaParagraph(groups.otros, "otros hallazgos", "otros"),
  ].filter(Boolean);
}

function buildNormalExams(findings) {
  if (findings.has_omitted_findings) {
    return "Respecto de los demas examenes informados, no se consignan recomendaciones adicionales para esta orientacion.";
  }

  if (!findings.examenes_normales_resumibles?.length) {
    return "";
  }

  return "Respecto de los demas examenes informados, estos no presentan alteraciones relevantes.";
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

  return `Como restricciones laborales, ${joinNatural(inlineRestrictions)}.`;
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
