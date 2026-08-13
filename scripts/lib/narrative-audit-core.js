import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function countMatches(value, pattern) {
  return [...String(value || "").matchAll(pattern)].length;
}

function paragraphs(value) {
  return String(value || "").split(/\n{2,}/).filter(Boolean);
}

function hasFlag(auditCase, type) {
  return auditCase.flags?.some((flag) => flag.type === type);
}

function rawField(auditCase, block, field) {
  return auditCase.rawClinical?.[block]?.[field] ?? "";
}

const IDENTITY_NARRATIVE_FLAGS = new Set([
  "identity_name_missing",
  "identity_name_suspicious",
  "identity_name_fragmented",
  "identity_name_too_short",
  "identity_name_contains_numbers",
  "identity_name_contains_label",
  "identity_conflict",
]);

export const NARRATIVE_AUDIT_PATTERNS = [
  ["hemoglobin_without_explicit_unit", "REVIEW", "Laboratorio", (c) => /hemoglobina es de\s+\d+(?:[.,]\d+)?\.(?:\s|$)/i.test(c.displayText)],
  ["tts_decimal_monitoring", "INFORMATIONAL", "TTS", (c) => /\b\d+\.\d+\b/.test(c.ttsText)],
  ["generic_dermatology_hides_finding", "REVIEW", "Dermatología", (c) => /hallazgos dermatológicos registrados/i.test(c.displayText)],
  ["aptitude_restricciones_misspelling", "ERROR", "Aptitud", (c) => /restricciónes/i.test(c.displayText)],
  ["repetitive_se_evidencia", "ERROR", "Redacción", (c) => countMatches(c.displayText, /\bse evidencia(?:n)?\b/gi) >= 3],
  ["audiometry_artificial_causality", "ERROR", "Audiometría", (c) => /alteraciones no debidas a ruido, por lo que se recomienda/i.test(c.displayText)],
  ["generic_other_findings_raw_prose", "REVIEW", "Otros hallazgos", (c) => /En otros hallazgos (?:se evidencia|se registra)/i.test(c.displayText)],
  ["orphan_recommendation", "REVIEW", "Recomendaciones", (c) => hasFlag(c, "orphan_recommendation") || paragraphs(c.displayText).some((p) => /^(?:Asimismo,\s*)?Se recomienda\b/i.test(p))],
  ["ecg_narrative_omission", "REVIEW", "ECG", (c) => hasFlag(c, "finding_not_narrated")],
  ["ophthalmology_missing_connectors", "ERROR", "Oftalmología", (c) => /(corregida|ametropía) (ametropía|pterigión|discromatopsia|visión)/i.test(c.displayText)],
  ["musculoskeletal_grammar", "ERROR", "Musculoesquelético", (c) => /se evidencia en regular estado físico/i.test(c.displayText)],
  ["clinical_accents_missing", "ERROR", "Ortografía clínica", (c) => /\b(torax|radiologicos?|lobulo|oido|proximo|medico|neumologia|traumatologia|oftalmologia|otorrinolaringologia|periferica|hepatica|hematologica|repercusion|clinico|etiologia|alergica|parasitologico|cirugia|neurologia)\b/i.test(c.displayText)],
  ["restriction_list_marker_leak", "ERROR", "Restricciones", (c) => /(?:,|\by)\s+-\s+/i.test(c.displayText)],
  ["duplicated_specialty_followup", "ERROR", "Recomendaciones", (c) => /control por ([a-záéíóúñ]+).*control por \1/i.test(c.displayText)],
  ["identity_affects_narrative", "ERROR", "Identidad", (c) => c.flags?.some((flag) => IDENTITY_NARRATIVE_FLAGS.has(flag.type))],
  ["radiology_subject_verb_grammar", "ERROR", "Radiografía", (c) => /se evidencia (?:hallazgo de )?signos/i.test(c.displayText)],
  ["multiple_other_findings_concatenated", "REVIEW", "Otros hallazgos", (c) => /En otros hallazgos (?:se evidencia|se registra) (?:rinitis alergica.*eosinofilia|insuficiencia venosa.*(?:eosinofilia|hipercolesterolemia|hipertensión|anemia)|alergia a la ceftriaxona.*insuficiencia venosa|migraña.*insuficiencia venosa|micosis.*anemia|hipercolesterolemia definida.*leucopenia|faringitis aguda.*hiperqueratosis.*leucocitosis|descartar onicomicosis.*insuficiencia venosa)/i.test(c.displayText)],
  ["tts_unresolved_epp_db", "ERROR", "TTS", (c) => /\b(?:epp|db)\b/i.test(c.ttsText)],
  ["tts_unresolved_pvc", "REVIEW", "TTS", (c) => /\bpvc\b/i.test(c.ttsText)],
  ["tts_symbols_or_slashes", "ERROR", "TTS", (c) => /[/()]|(?:,|\by)\s+-\s+/.test(c.ttsText)],
  ["long_sentence", "ERROR", "Narrativa/TTS", (c) => hasFlag(c, "long_narrative_sentence") || hasFlag(c, "long_tts_sentence") || c.displayText.split(/(?<=[.!?])\s+/).some((s) => s.trim().split(/\s+/).length > 50)],
  ["duplicate_recommendation", "ERROR", "Recomendaciones", (c) => hasFlag(c, "duplicate_narrative_phrase")],
  ["tts_bad_comparator", "ERROR", "TTS", (c) => /mayor que (?:igual a|a)\b|menor que (?:igual a|a)\b/i.test(c.ttsText)],
  ["lowercase_sentence_start", "ERROR", "Redacción", (c) => /\.\s+(?:se solicita|control regular|uso estricto)\b/.test(c.displayText)],
  ["known_clinical_typo", "ERROR", "Ortografía clínica", (c) => /\bsueperior\b/i.test(c.displayText)],
];

function normalizeKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-PE");
}

function groupInventory(cases, getValue, filter = () => true) {
  const map = new Map();
  cases.filter(filter).forEach((auditCase) => {
    const value = normalizeKey(getValue(auditCase));
    if (!value) return;
    const item = map.get(value) || { text: value, frequency: 0, cases: [] };
    item.frequency += 1;
    item.cases.push({ caseNumber: auditCase.caseNumber, fileName: auditCase.fileName, page: auditCase.pageStart });
    map.set(value, item);
  });
  return [...map.values()].sort((a, b) => b.frequency - a.frequency || a.text.localeCompare(b.text));
}

export function analyzeNarrativeCases(cases) {
  const patternResults = NARRATIVE_AUDIT_PATTERNS.map(([key, classification, area, detector]) => {
    const affected = cases.filter(detector);
    return { key, classification, area, frequency: affected.length, cases: affected.map((item) => item.caseNumber) };
  }).filter((item) => item.frequency > 0);

  const caseResults = cases.map((auditCase) => {
    const issues = patternResults.filter((pattern) => pattern.cases.includes(auditCase.caseNumber));
    const classifications = new Set(issues.map((issue) => issue.classification));
    const status = classifications.has("ERROR")
      ? "ERROR"
      : classifications.has("REVIEW")
        ? "REVIEW"
        : classifications.has("INFORMATIONAL")
          ? "INFORMATIONAL"
          : "OK";
    return {
      caseNumber: auditCase.caseNumber,
      fileName: auditCase.fileName,
      page: auditCase.pageStart,
      status,
      issues: issues.map((issue) => issue.key),
    };
  });

  const statusCounts = Object.fromEntries(["ERROR", "REVIEW", "INFORMATIONAL", "OK"].map((status) => [status, caseResults.filter((item) => item.status === status).length]));
  const flagCount = (type) => cases.reduce((sum, auditCase) => sum + (auditCase.flags || []).filter((flag) => flag.type === type).length, 0);
  const affectedBy = (key) => patternResults.find((item) => item.key === key)?.frequency || 0;
  const duplicateCaseNumbers = new Set(patternResults.filter((item) => item.key.includes("duplicate_recommendation") || item.key === "duplicated_specialty_followup").flatMap((item) => item.cases));
  const omissionCaseNumbers = new Set(patternResults.filter((item) => item.key.includes("omission") || item.key === "generic_dermatology_hides_finding").flatMap((item) => item.cases));

  const ecgInventory = groupInventory(
    cases,
    (auditCase) => rawField(auditCase, "evaluaciones_cualitativas", "ecg_resultado"),
    (auditCase) => hasFlag(auditCase, "finding_not_narrated"),
  );
  const dermatologyInventory = groupInventory(
    cases,
    (auditCase) => auditCase.normalizedClinical?.evaluaciones_cualitativas?.otros_hallazgos_resultado,
    (auditCase) => /hallazgos dermatológicos registrados/i.test(auditCase.displayText),
  ).map((item) => ({ ...item, ruleId: "existing_dermatologia_rule" }));
  const otherFindingsCases = cases.filter((auditCase) => rawField(auditCase, "evaluaciones_cualitativas", "otros_hallazgos_resultado"));
  const otherFindingsFormats = [
    {
      format: "explicit_structural_delimiters",
      frequency: otherFindingsCases.filter((auditCase) => /;|•|\.\s+-\s+|(?:^|\s)\d+(?:\s*[,Y]\s*\d+)*\./i.test(rawField(auditCase, "evaluaciones_cualitativas", "otros_hallazgos_resultado"))).length,
      treatment: "Se separan sintácticamente sin interpretar el contenido.",
    },
    {
      format: "compound_without_explicit_delimiter",
      frequency: affectedBy("multiple_other_findings_concatenated"),
      treatment: "Se conserva para REVIEW; no se inventan límites clínicos.",
    },
    {
      format: "unsupported_clinical_content",
      frequency: cases.filter((auditCase) => hasFlag(auditCase, "unsupported_pattern")).length,
      treatment: "Se conserva neutralmente con unsupported_pattern.",
    },
    {
      format: "generic_other_output",
      frequency: affectedBy("generic_other_findings_raw_prose"),
      treatment: "Se conserva en REVIEW hasta catalogación clínica.",
    },
  ];
  const hemoglobinUnits = cases.map((auditCase) => rawField(auditCase, "laboratorio_numerico", "hemoglobina_unidad")).filter(Boolean);

  return {
    workersReviewed: cases.length,
    displayTextsRead: cases.filter((item) => item.displayText).length,
    ttsTextsRead: cases.filter((item) => item.ttsText).length,
    statusCounts,
    workersWithAnyError: caseResults.filter((item) => item.status === "ERROR").length,
    workersWithAnyReview: caseResults.filter((item) => item.status === "REVIEW" || item.status === "ERROR" && patternResults.some((pattern) => pattern.classification === "REVIEW" && pattern.cases.includes(item.caseNumber))).length,
    workersOnlyInformational: statusCounts.INFORMATIONAL,
    metrics: {
      narrativeOmissions: omissionCaseNumbers.size,
      duplicateRecommendations: duplicateCaseNumbers.size,
      longSentences: affectedBy("long_sentence"),
      identityIssues: affectedBy("identity_affects_narrative"),
      unknownValue: flagCount("unknown_value"),
      unsupportedPattern: flagCount("unsupported_pattern"),
      orphanRecommendations: affectedBy("orphan_recommendation"),
      decimalMonitoring: affectedBy("tts_decimal_monitoring"),
    },
    patterns: patternResults.sort((a, b) => b.frequency - a.frequency || a.key.localeCompare(b.key)),
    ecgInventory,
    dermatologyInventory,
    otherFindingsFormats,
    hemoglobinSourceInvestigation: {
      workersChecked: cases.length,
      explicitAdjacentUnit: hemoglobinUnits.length,
      units: [...new Set(hemoglobinUnits.map(normalizeKey))],
      conclusion: hemoglobinUnits.length === cases.length
        ? "La unidad está explícitamente adyacente al valor y fue asociada por el parser."
        : "Existen casos sin unidad explícitamente asociada; requieren revisión.",
    },
    caseResults,
  };
}

function renderInventory(title, inventory) {
  const lines = [`## ${title}`, "", "| Texto normalizado | Frecuencia | RuleId | Casos/páginas |", "|---|---:|---|---|"];
  inventory.forEach((item) => {
    const locations = item.cases.map((entry) => `${entry.caseNumber}: ${entry.fileName}, p. ${entry.page}`).join("; ");
    lines.push(`| ${item.text.replaceAll("|", "\\|")} | ${item.frequency} | ${item.ruleId || "—"} | ${locations} |`);
  });
  lines.push("");
  return lines;
}

export async function runNarrativeAudit({ casesPath, outputDir, suffix = "" }) {
  const cases = JSON.parse(await readFile(casesPath, "utf8"));
  if (!Array.isArray(cases)) throw new Error("audit-cases.json no contiene un lote válido.");
  const result = analyzeNarrativeCases(cases);
  const fileSuffix = suffix ? `-${suffix}` : "";
  const summaryPath = path.join(outputDir, `narrative-audit${fileSuffix}-summary.json`);
  const reportPath = path.join(outputDir, `narrative-audit${fileSuffix}-private.md`);
  await mkdir(outputDir, { recursive: true });

  const lines = [
    "# Auditoría real de narrativas",
    "",
    "## Resumen",
    "",
    `Trabajadores revisados: ${result.workersReviewed}`,
    "",
    `ERROR: ${result.statusCounts.ERROR}`,
    "",
    `REVIEW: ${result.statusCounts.REVIEW}`,
    "",
    `Solo INFORMATIONAL: ${result.statusCounts.INFORMATIONAL}`,
    "",
    `OK: ${result.statusCounts.OK}`,
    "",
    "Los estados son exclusivos y se asignan por prioridad ERROR > REVIEW > INFORMATIONAL > OK. Los decimales conservados son INFORMATIONAL y no convierten por sí solos una narrativa en problemática.",
    "",
    "## Patrones",
    "",
    "| Patrón | Clasificación | Área | Frecuencia |",
    "|---|---|---|---:|",
    ...result.patterns.map((item) => `| ${item.key} | ${item.classification} | ${item.area} | ${item.frequency} |`),
    "",
    ...renderInventory("Inventario agregado de ECG omitido", result.ecgInventory),
    ...renderInventory("Inventario dermatológico agregado", result.dermatologyInventory),
    "## Investigación de unidad de hemoglobina",
    "",
    `Casos revisados: ${result.hemoglobinSourceInvestigation.workersChecked}. Unidad explícita adyacente: ${result.hemoglobinSourceInvestigation.explicitAdjacentUnit}. Unidades: ${result.hemoglobinSourceInvestigation.units.join(", ") || "ninguna"}.`,
    "",
    result.hemoglobinSourceInvestigation.conclusion,
    "",
    "## Formatos de otros hallazgos",
    "",
    "| Formato | Frecuencia | Tratamiento |",
    "|---|---:|---|",
    ...result.otherFindingsFormats.map((item) => `| ${item.format} | ${item.frequency} | ${item.treatment} |`),
    "",
    "## Casos",
    "",
    "| Caso | Archivo | Página | Estado | Patrones |",
    "|---:|---|---:|---|---|",
    ...result.caseResults.map((item) => `| ${String(item.caseNumber).padStart(3, "0")} | ${item.fileName} | ${item.page} | ${item.status} | ${item.issues.join(", ") || "—"} |`),
    "",
  ];

  await writeFile(summaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  return { result, summaryPath, reportPath };
}
