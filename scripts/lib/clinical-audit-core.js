import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processWorkerClinicalNarrative } from "../../src/clinical/index.js";

export const AUDIT_FILE_PATTERN = /^primeras-hojas(?: \(\d+\))?\.pdf$/i;

function auditFileSequence(filePath) {
  const match = path.basename(filePath).match(/\((\d+)\)\.pdf$/i);
  return match ? Number(match[1]) : 0;
}

function comparable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function countBy(items, getKey) {
  const counts = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export function parseAuditArguments(args = []) {
  const explicitPath = args.find((arg) => !arg.startsWith("--")) || "";
  return {
    explicitPath,
    latest: !explicitPath && args.includes("--latest"),
    all: !explicitPath && args.includes("--all"),
    sanitized: args.includes("--sanitized"),
  };
}

async function listLatestCandidates(downloadsRoot) {
  const entries = await readdir(downloadsRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(downloadsRoot, entry.name, "audioevaluaciones", "primeras-hojas.pdf");
    const candidateStat = await stat(candidate).catch(() => null);
    if (candidateStat?.isFile()) candidates.push({ path: candidate, mtimeMs: candidateStat.mtimeMs });
  }
  return candidates;
}

export async function resolveAuditFiles(args = [], options = {}) {
  const parsed = parseAuditArguments(args);
  const cwd = options.cwd || process.cwd();
  const homeDir = options.homeDir || os.homedir();
  const auditLocalDir = options.auditLocalDir || path.join(cwd, "auditoria-local");
  const downloadsRoot = options.downloadsRoot || path.join(homeDir, "Documents", "AudioEvaluaciones", "Descargas");

  if (parsed.explicitPath) {
    const resolved = path.resolve(cwd, parsed.explicitPath);
    const fileStat = await stat(resolved).catch(() => null);
    if (!fileStat?.isFile()) throw new Error(`No se encontró el archivo de auditoría en:\n${resolved}`);
    return { files: [resolved], mode: "explicit", sanitized: parsed.sanitized };
  }

  if (parsed.all) {
    const entries = await readdir(auditLocalDir, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((entry) => entry.isFile() && AUDIT_FILE_PATTERN.test(entry.name))
      .map((entry) => path.join(auditLocalDir, entry.name))
      .sort((a, b) => auditFileSequence(a) - auditFileSequence(b) || path.basename(a).localeCompare(path.basename(b)));
    if (!files.length) throw new Error(`No se encontraron primeras hojas para auditar en:\n${auditLocalDir}`);
    return { files, mode: "all", sanitized: parsed.sanitized };
  }

  if (parsed.latest) {
    const candidates = await listLatestCandidates(downloadsRoot);
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
    if (!candidates.length) throw new Error(`No se encontraron primeras hojas generadas en:\n${downloadsRoot}`);
    return { files: [candidates[0].path], mode: "latest", sanitized: parsed.sanitized };
  }

  const defaultPath = path.join(auditLocalDir, "primeras-hojas.pdf");
  const defaultStat = await stat(defaultPath).catch(() => null);
  if (!defaultStat?.isFile()) throw new Error(`No se encontró el archivo de auditoría en:\n${defaultPath}`);
  return { files: [defaultPath], mode: "default", sanitized: parsed.sanitized };
}

export async function createPdfFileLike(filePath) {
  const bytes = await readFile(filePath);
  return {
    name: path.basename(filePath),
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function extractIdentityCandidates(rawText) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  const names = [];
  const namePattern = /APELLIDOS\s+Y\s+NOMBRES\s*:?[\s-]*(.+?)(?=\s+(?:DNI|C\.?\s*E\.?|CARNET\s+DE\s+EXTRANJER[IÍ]A|DOCUMENTO|EDAD|SEXO|EMPRESA)(?=\s|:)\s*:|$)/giu;
  for (const match of text.matchAll(namePattern)) {
    const value = match[1].trim();
    if (value && !names.some((item) => comparable(item) === comparable(value))) names.push(value);
  }
  const documents = [];
  const documentPattern = /\b(DNI|C\.?\s*E\.?|CARNET\s+DE\s+EXTRANJER[IÍ]A)(?=\s|:)\s*:?[\s-]*([A-Z0-9-]{6,16})\b/giu;
  for (const match of text.matchAll(documentPattern)) {
    documents.push({ type: match[1], value: match[2] });
  }
  return { names, documents };
}

function normalizedFullName(identity = {}) {
  return String(identity.nombre_completo_original || [identity.nombres, identity.apellidos].filter(Boolean).join(" ")).trim();
}

function createFlag(type, category, message, sourceField = "", details = {}) {
  return { type, category, message, sourceField, ...details };
}

export function auditIdentity(worker, normalizedWorker, rawText) {
  const extracted = worker.identificacion || {};
  const normalized = normalizedWorker.identificacion || {};
  const source = extractIdentityCandidates(rawText);
  const extractedName = normalizedFullName(extracted);
  const normalizedName = normalizedFullName(normalized);
  const flags = [];

  if (!extractedName) flags.push(createFlag("identity_name_missing", "identity", "No se extrajo un nombre.", "identificacion"));
  if (extractedName && comparable(extractedName).split(" ").filter(Boolean).length < 2) {
    flags.push(createFlag("identity_name_too_short", "identity", "El nombre extraído contiene menos de dos segmentos.", "identificacion"));
  }
  if (/\d/.test(extractedName)) flags.push(createFlag("identity_name_contains_numbers", "identity", "El nombre extraído contiene números.", "identificacion"));
  if (/\b(?:APELLIDOS?|NOMBRES?|DNI|DOCUMENTO|EDAD|SEXO|EMPRESA)\b/i.test(extractedName)) {
    flags.push(createFlag("identity_name_contains_label", "identity", "El nombre extraído contiene una etiqueta de formulario.", "identificacion"));
  }
  if (extractedName && /[^\p{L}\s,'-]/u.test(extractedName)) {
    flags.push(createFlag("identity_name_suspicious", "identity", "El nombre contiene caracteres estructuralmente inusuales.", "identificacion"));
  }

  const sourceNames = source.names.map(comparable).filter(Boolean);
  if (sourceNames.length > 1 && new Set(sourceNames).size > 1) {
    flags.push(createFlag("identity_conflict", "identity", "La hoja contiene fragmentos de nombre incompatibles.", "identificacion"));
  }
  if (sourceNames.length && extractedName) {
    const extractedComparable = comparable(extractedName);
    const sourceComparable = sourceNames[0];
    if (sourceComparable !== extractedComparable && (sourceComparable.includes(extractedComparable) || extractedComparable.includes(sourceComparable))) {
      flags.push(createFlag("identity_name_fragmented", "identity", "El nombre fuente y el extraído parecen tener distinta cantidad de segmentos.", "identificacion"));
    } else if (sourceComparable !== extractedComparable) {
      flags.push(createFlag("identity_conflict", "identity", "El nombre fuente detectado no coincide con el valor extraído.", "identificacion"));
    }
  }

  const document = String(extracted.numero_documento || extracted.dni || "").trim();
  const documentType = comparable(extracted.tipo_documento || "DNI");
  if (!document) {
    flags.push(createFlag("identity_document_missing", "identity", "No se extrajo DNI o CE.", "identificacion.numero_documento"));
  } else {
    const validDni = /^\d{8}$/.test(document);
    const validCe = /^[A-Z0-9-]{6,15}$/i.test(document);
    if ((documentType.includes("DNI") && !validDni) || (documentType.includes("CE") && !validCe)) {
      flags.push(createFlag("identity_document_invalid_format", "identity", "El documento no coincide con el formato estructural esperado para su tipo.", "identificacion.numero_documento"));
    }
  }
  const sourceDocuments = Array.from(new Set(source.documents.map((item) => comparable(item.value)).filter(Boolean)));
  if (sourceDocuments.length > 1 || (sourceDocuments.length === 1 && document && sourceDocuments[0] !== comparable(document))) {
    flags.push(createFlag("identity_conflict", "identity", "Los documentos detectados en la fuente no coinciden entre sí o con el valor extraído.", "identificacion.numero_documento"));
  }

  const age = extracted.edad;
  if (!hasValue(age)) flags.push(createFlag("identity_age_missing", "identity", "No se extrajo la edad.", "identificacion.edad"));
  else if (!Number.isInteger(Number(age)) || Number(age) <= 0 || Number(age) > 120) {
    flags.push(createFlag("identity_age_invalid", "identity", "La edad extraída no es un entero estructuralmente válido.", "identificacion.edad"));
  }

  const sex = comparable(extracted.sexo);
  if (!sex) {
    flags.push(createFlag("identity_sex_unrecognized", "identity", "No se extrajo el sexo.", "identificacion.sexo"));
  } else if (!["M", "F", "MASCULINO", "FEMENINO", "HOMBRE", "MUJER"].includes(sex)) {
    flags.push(createFlag("identity_sex_unrecognized", "identity", "El sexo extraído no coincide con un valor reconocido.", "identificacion.sexo"));
  }
  if (!hasValue(extracted.empresa)) flags.push(createFlag("identity_company_missing", "identity", "No se extrajo la empresa.", "identificacion.empresa"));

  return {
    source,
    extracted: {
      name: extractedName,
      document,
      age: age ?? "",
      sex: extracted.sexo || "",
      company: extracted.empresa || "",
    },
    normalized: {
      name: normalizedName,
      document: String(normalized.numero_documento || normalized.dni || ""),
      age: normalized.edad ?? "",
      sex: normalized.sexo || "",
      company: normalized.empresa || "",
    },
    flags,
  };
}

function auditMissingUnits(worker, rawText) {
  const flags = [];
  const fields = [
    ["hemoglobina_valor", "Hemoglobina"],
    ["glucosa_valor", "Glucosa"],
    ["trigliceridos_valor", "Trigliceridos"],
    ["colesterol_valor", "Colesterol"],
  ];
  fields.forEach(([field, label]) => {
    const value = worker.laboratorio_numerico?.[field];
    if (!hasValue(value)) return;
    const pattern = new RegExp(`${label}\\s+${String(value).replace(".", "[.,]")}(?![\\d.,])\\s*(mg\\s*\\/\\s*dL|g\\s*\\/\\s*dL|%)?`, "i");
    const match = String(rawText || "").match(pattern);
    if (match && !match[1]) flags.push(createFlag("missing_unit", "clinical", `No se detectó una unidad junto a ${label}.`, `laboratorio_numerico.${field}`));
  });
  return flags;
}

function auditNarrative(worker, clinicalResult) {
  const flags = [];
  const display = clinicalResult.displayText || "";
  const tts = clinicalResult.ttsText || "";
  const findings = clinicalResult.findings || {};
  if (!display) flags.push(createFlag("display_text_empty", "narrative", "La narrativa visual quedó vacía."));
  if (!tts) flags.push(createFlag("tts_text_empty", "tts", "El texto TTS quedó vacío."));
  if (findings.has_omitted_findings) flags.push(createFlag("finding_not_narrated", "narrative", "Existe al menos un hallazgo extraído que el motor omitió."));

  const paragraphs = display.split(/\n{2,}/).filter(Boolean);
  paragraphs.forEach((paragraph) => {
    const letters = paragraph.match(/\p{L}/gu) || [];
    if (letters.length > 5 && letters.every((letter) => letter === letter.toUpperCase())) {
      flags.push(createFlag("all_caps_narrative", "narrative", "La narrativa contiene un párrafo en mayúsculas sostenidas."));
    }
  });
  const sentences = display.split(/(?<=[.!?])\s+/).map(comparable).filter(Boolean);
  if (new Set(sentences).size < sentences.length) flags.push(createFlag("duplicate_narrative_phrase", "narrative", "La narrativa contiene frases duplicadas."));
  if (sentences.some((sentence) => sentence.split(/\s+/).filter(Boolean).length > 50)) {
    flags.push(createFlag("long_narrative_sentence", "narrative", "La narrativa contiene una frase de más de 50 palabras."));
  }
  if (/\b(?:N\/A|NA|NO APLICA|NO REGISTRA|SIN DATO|NULL|UNDEFINED)\b/i.test(display)) {
    flags.push(createFlag("placeholder_in_narrative", "narrative", "Un placeholder llegó al texto visual."));
  }

  const recommendationText = String(worker.aptitud_y_recomendaciones?.recomendaciones_generales_texto || "");
  const recommendations = recommendationText.split(/\.\s+|;|\n/).map(comparable).filter(Boolean);
  if (new Set(recommendations).size < recommendations.length) {
    flags.push(createFlag("duplicate_recommendation_source", "narrative", "La fuente contiene recomendaciones duplicadas."));
  }
  if (/\b(?:IMC|ECG|PA|HDL|LDL|FEV1|FVC)\b/.test(tts)) flags.push(createFlag("unresolved_abbreviation", "tts", "Quedó una abreviatura clínica sin resolver en TTS."));
  if (/\b(?:mg\s*\/\s*dL|mmHg|kg|cm)\b/i.test(tts)) flags.push(createFlag("unnormalized_tts_unit", "tts", "Quedó una unidad abreviada en TTS."));
  if (tts.split(/(?<=[.!?])\s+/).some((sentence) => sentence.split(/\s+/).filter(Boolean).length > 50)) {
    flags.push(createFlag("long_tts_sentence", "tts", "El texto TTS contiene una frase de más de 50 palabras."));
  }
  return flags;
}

function hasClinicalContent(worker) {
  return [worker.laboratorio_numerico, worker.evaluaciones_cualitativas, worker.aptitud_y_recomendaciones]
    .some((block) => Object.values(block || {}).some(hasValue));
}

function normalizeClinicalFlag(flag) {
  return {
    type: flag.type,
    category: "clinical",
    message: flag.message,
    sourceField: flag.sourceField || "",
    confidence: flag.confidence,
  };
}

function caseHasFlag(auditCase, type) {
  return auditCase.flags.some((flag) => flag.type === type);
}

function requiresReview(flag) {
  return flag.confidence !== "automatic";
}

function addFlagOnce(auditCase, flag) {
  if (!auditCase.flags.some((item) => item.type === flag.type && item.message === flag.message)) auditCase.flags.push(flag);
}

function compareRepeatedWorkers(cases) {
  const byDocument = new Map();
  const byName = new Map();
  cases.forEach((auditCase) => {
    const document = comparable(auditCase.identity.normalized.document);
    const name = comparable(auditCase.identity.normalized.name);
    const keyMap = document ? byDocument : name.split(" ").length >= 2 ? byName : null;
    const key = document || name;
    if (!keyMap || !key) return;
    const previous = keyMap.get(key);
    if (!previous) {
      keyMap.set(key, auditCase);
      return;
    }
    if (previous.fileName === auditCase.fileName) return;
    const duplicateMessage = `Posible duplicado de ${previous.fileName}, página ${previous.pageStart}.`;
    addFlagOnce(auditCase, createFlag("possible_duplicate_worker", "identity", duplicateMessage, "identificacion", { relatedCase: previous.caseNumber }));
    addFlagOnce(previous, createFlag("possible_duplicate_worker", "identity", `Posible duplicado de ${auditCase.fileName}, página ${auditCase.pageStart}.`, "identificacion", { relatedCase: auditCase.caseNumber }));

    const identityFields = ["name", "document", "age", "sex", "company"];
    const identityDifferences = identityFields.filter((field) => comparable(previous.identity.normalized[field]) !== comparable(auditCase.identity.normalized[field]));
    if (identityDifferences.length) {
      const message = `La extracción repetida difiere en: ${identityDifferences.join(", ")}.`;
      addFlagOnce(auditCase, createFlag("identity_extraction_inconsistent", "identity", message, "identificacion", { relatedCase: previous.caseNumber }));
      addFlagOnce(previous, createFlag("identity_extraction_inconsistent", "identity", message, "identificacion", { relatedCase: auditCase.caseNumber }));
    }
    const previousClinical = JSON.stringify(previous.normalizedClinical);
    const currentClinical = JSON.stringify(auditCase.normalizedClinical);
    if (previousClinical !== currentClinical) {
      const message = "El mismo identificador presenta datos clínicos estructurados diferentes entre archivos.";
      addFlagOnce(auditCase, createFlag("repeated_worker_clinical_difference", "clinical", message, "", { relatedCase: previous.caseNumber }));
      addFlagOnce(previous, createFlag("repeated_worker_clinical_difference", "clinical", message, "", { relatedCase: auditCase.caseNumber }));
    }
  });
}

function summarizeCases(cases, fileResults) {
  const flags = cases.flatMap((auditCase) => auditCase.flags.map((flag) => ({ ...flag, fileName: auditCase.fileName })));
  const reviewFlags = flags.filter(requiresReview);
  const automaticFlags = flags.filter((flag) => !requiresReview(flag));
  const identityFlags = reviewFlags.filter((flag) => flag.category === "identity");
  const clinicalFlags = reviewFlags.filter((flag) => flag.category === "clinical");
  const narrativeFlags = reviewFlags.filter((flag) => flag.category === "narrative");
  const ttsFlags = reviewFlags.filter((flag) => flag.category === "tts");
  const problemMap = new Map();
  reviewFlags.forEach((flag) => {
    const entry = problemMap.get(flag.type) || { type: flag.type, count: 0, files: new Set() };
    entry.count += 1;
    entry.files.add(flag.fileName);
    problemMap.set(flag.type, entry);
  });
  const topProblems = [...problemMap.values()]
    .map((entry) => ({ ...entry, files: [...entry.files].sort() }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, 10);
  const parserFailures = cases.filter((item) => item.parserFailure).length;

  return {
    generatedAt: new Date().toISOString(),
    filesProcessed: fileResults.length,
    totals: {
      pages: fileResults.reduce((sum, item) => sum + item.pages, 0),
      pagesProcessed: fileResults.reduce((sum, item) => sum + item.pagesProcessed, 0),
      workersCreated: cases.length,
      workersExtracted: cases.length - parserFailures,
      parserFailures,
      pagesWithoutWorker: fileResults.reduce((sum, item) => sum + item.pagesWithoutWorker, 0),
      workersMissingIdentity: cases.filter((item) => caseHasFlag(item, "identity_name_missing") || caseHasFlag(item, "identity_document_missing")).length,
      workersWithSuspiciousIdentity: cases.filter((item) => item.flags.some((flag) => flag.category === "identity")).length,
      workersMissingClinicalContent: cases.filter((item) => caseHasFlag(item, "missing_clinical_content")).length,
      workersWithoutFlags: cases.filter((item) => !item.flags.some(requiresReview)).length,
      workersWithReviewFlags: cases.filter((item) => item.flags.some(requiresReview)).length,
    },
    files: fileResults.map((file) => ({
      fileName: file.fileName,
      filePath: file.filePath,
      pages: file.pages,
      pagesProcessed: file.pagesProcessed,
      workersCreated: file.caseNumbers.length,
      workersExtracted: file.caseNumbers.filter((number) => !cases[number - 1].parserFailure).length,
      parserFailures: file.caseNumbers.filter((number) => cases[number - 1].parserFailure).length,
      workersWithReviewFlags: file.caseNumbers.filter((number) => cases[number - 1].flags.some(requiresReview)).length,
    })),
    identity: {
      ok: cases.filter((item) => !item.flags.some((flag) => flag.category === "identity")).length,
      ...countBy(identityFlags, (flag) => flag.type),
    },
    clinical: countBy(clinicalFlags, (flag) => flag.type),
    narrative: countBy(narrativeFlags, (flag) => flag.type),
    tts: countBy(ttsFlags, (flag) => flag.type),
    automaticNormalizations: countBy(automaticFlags, (flag) => flag.type),
    problemsByType: countBy(reviewFlags, (flag) => flag.type),
    topProblems,
  };
}

function markdownValue(value) {
  return hasValue(value) ? String(value) : "No disponible";
}

function renderFlagCounts(title, counts) {
  const entries = Object.entries(counts || {}).filter(([key]) => key !== "ok");
  return [`## ${title}`, "", ...(entries.length ? entries.map(([key, count]) => `- ${key}: ${count}`) : ["Sin inconsistencias registradas."]), ""].join("\n");
}

function renderCaseDetail(auditCase, sanitized) {
  const identity = auditCase.identity;
  const name = sanitized ? `Caso ${String(auditCase.caseNumber).padStart(3, "0")}` : markdownValue(identity.normalized.name);
  const document = sanitized ? "[DOCUMENTO]" : markdownValue(identity.normalized.document);
  const company = sanitized ? "[EMPRESA]" : markdownValue(identity.normalized.company);
  const lines = [
    `## Caso global ${String(auditCase.caseNumber).padStart(3, "0")}`,
    "",
    `Archivo: ${auditCase.fileName}`,
    `Página PDF: ${auditCase.pageStart}${auditCase.pageEnd !== auditCase.pageStart ? `-${auditCase.pageEnd}` : ""}`,
    `Nombre: ${name}`,
    `Documento: ${document}`,
    `Edad: ${markdownValue(identity.normalized.age)}`,
    `Sexo: ${markdownValue(identity.normalized.sex)}`,
    `Empresa: ${company}`,
    "",
    "### Extracción de identidad",
    "",
    `Fuente detectada: ${sanitized ? "[NOMBRE FUENTE]" : markdownValue(identity.source.names.join(" | "))}`,
    `Extraído: ${sanitized ? "[NOMBRE EXTRAÍDO]" : markdownValue(identity.extracted.name)}`,
    `Normalizado: ${name}`,
    "",
    "### Review flags",
    "",
    ...auditCase.flags.map((flag) => `- ${flag.type}: ${flag.message}`),
    "",
  ];
  if (!sanitized) {
    lines.push(
      "### Hallazgos clínicos estructurados", "", "```json", JSON.stringify(auditCase.normalizedClinical, null, 2), "```", "",
      "### Display text", "", auditCase.displayText || "[VACÍO]", "",
      "### TTS text", "", auditCase.ttsText || "[VACÍO]", "",
      "### Trazabilidad", "", "```json", JSON.stringify(auditCase.trace, null, 2), "```", "",
    );
  }
  return lines.join("\n");
}

export function renderAuditReport(summary, cases, options = {}) {
  const sanitized = Boolean(options.sanitized);
  const cleanCases = cases.filter((item) => !item.flags.some(requiresReview));
  const flaggedCases = cases.filter((item) => item.flags.some(requiresReview));
  const lines = [
    "# Auditoría de AudioEvaluaciones",
    "",
    `Archivos procesados: ${summary.filesProcessed}`,
    `Páginas: ${summary.totals.pages}`,
    `Trabajadores extraídos: ${summary.totals.workersExtracted}`,
    `Fallos de extracción: ${summary.totals.parserFailures}`,
    `Sin observaciones: ${summary.totals.workersWithoutFlags}`,
    `Revisión recomendada: ${summary.totals.workersWithReviewFlags}`,
    "",
    "## Resultados por archivo",
    "",
    "| Archivo | Páginas | Trabajadores | Fallos | Con revisión |",
    "|---|---:|---:|---:|---:|",
    ...summary.files.map((file) => `| ${file.fileName} | ${file.pages} | ${file.workersExtracted} | ${file.parserFailures} | ${file.workersWithReviewFlags} |`),
    "",
    renderFlagCounts("Identidad", summary.identity),
    renderFlagCounts("Extracción clínica", summary.clinical),
    renderFlagCounts("Narrativa", summary.narrative),
    renderFlagCounts("TTS", summary.tts),
    renderFlagCounts("Normalizaciones automáticas", summary.automaticNormalizations),
    "## Top 10 inconsistencias",
    "",
    ...(summary.topProblems.length ? summary.topProblems.map((item, index) => `${index + 1}. ${item.type} — ${item.count} — ${item.files.join(", ")}`) : ["Sin inconsistencias."]),
    "",
    "## Casos sin problemas",
    "",
    "| Caso | Archivo | Página | Nombre | Estado |",
    "|---:|---|---:|---|---|",
    ...cleanCases.map((item) => `| ${String(item.caseNumber).padStart(3, "0")} | ${item.fileName} | ${item.pageStart} | ${sanitized ? `Caso ${String(item.caseNumber).padStart(3, "0")}` : markdownValue(item.identity.normalized.name)} | OK |`),
    "",
    "## Casos con revisión",
    "",
    ...flaggedCases.map((item) => renderCaseDetail(item, sanitized)),
  ];
  return lines.join("\n");
}

export async function runClinicalAudit({ filePaths, analyzePdf, outputDir = path.join(process.cwd(), "clinical-audit"), sanitized = false }) {
  if (typeof analyzePdf !== "function") throw new Error("Se requiere el analizador PDF productivo.");
  const cases = [];
  const fileResults = [];

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    const fileResult = { fileName, filePath, pages: 0, pagesProcessed: 0, pagesWithoutWorker: 0, caseNumbers: [] };
    try {
      const fileLike = await createPdfFileLike(filePath);
      const analysis = await analyzePdf(fileLike);
      fileResult.pages = analysis.total_pages || 0;
      fileResult.pagesProcessed = analysis.pages_analyzed || 0;
      const coveredPages = new Set((analysis.groups || []).flatMap((group) => group.pages.map((page) => page.page)));
      fileResult.pagesWithoutWorker = Math.max(0, fileResult.pagesProcessed - coveredPages.size);

      (analysis.workers || []).forEach((worker, workerIndex) => {
        const group = analysis.groups?.[workerIndex];
        const rawText = group?.pages?.map((page) => page.text).join("\n") || worker.raw_text || "";
        const auditWorker = {
          ...worker,
          derived_states: { ...(worker.derived_states || {}), reviewed_by_user: true },
        };
        const clinicalResult = processWorkerClinicalNarrative(auditWorker);
        const identity = auditIdentity(worker, clinicalResult.normalizedWorker, rawText);
        const flags = [
          ...identity.flags,
          ...clinicalResult.reviewFlags.map(normalizeClinicalFlag),
          ...auditMissingUnits(worker, rawText),
          ...auditNarrative(worker, clinicalResult),
        ];
        const parserFailure = Boolean(worker.parser_error || worker.template_id === "unknown");
        if (parserFailure) flags.push(createFlag("parser_failure", "parser", worker.parser_error || "Plantilla no reconocida."));
        if (!hasClinicalContent(worker)) flags.push(createFlag("missing_clinical_content", "clinical", "No se extrajo contenido clínico reconocible."));
        const caseNumber = cases.length + 1;
        const auditCase = {
          caseNumber,
          fileName,
          filePath,
          pageStart: group?.start_page || worker.derived_states?.start_page || 0,
          pageEnd: group?.end_page || worker.derived_states?.end_page || group?.start_page || 0,
          parserFailure,
          identity,
          flags,
          rawClinical: {
            datos_generales_narrables: worker.datos_generales_narrables || {},
            laboratorio_numerico: worker.laboratorio_numerico || {},
            evaluaciones_cualitativas: worker.evaluaciones_cualitativas || {},
            aptitud_y_recomendaciones: worker.aptitud_y_recomendaciones || {},
          },
          normalizedClinical: {
            datos_generales_narrables: clinicalResult.normalizedWorker.datos_generales_narrables || {},
            laboratorio_numerico: clinicalResult.normalizedWorker.laboratorio_numerico || {},
            evaluaciones_cualitativas: clinicalResult.normalizedWorker.evaluaciones_cualitativas || {},
            aptitud_y_recomendaciones: clinicalResult.normalizedWorker.aptitud_y_recomendaciones || {},
          },
          displayText: clinicalResult.displayText,
          ttsText: clinicalResult.ttsText,
          trace: clinicalResult.trace,
        };
        cases.push(auditCase);
        fileResult.caseNumbers.push(caseNumber);
      });
    } catch (error) {
      const caseNumber = cases.length + 1;
      cases.push({
        caseNumber, fileName, filePath, pageStart: 0, pageEnd: 0, parserFailure: true,
        identity: { source: { names: [], documents: [] }, extracted: {}, normalized: {} },
        flags: [createFlag("parser_failure", "parser", error instanceof Error ? error.message : String(error))],
        rawClinical: {}, normalizedClinical: {}, displayText: "", ttsText: "", trace: [],
      });
      fileResult.caseNumbers.push(caseNumber);
    }
    fileResults.push(fileResult);
  }

  compareRepeatedWorkers(cases);
  const summary = summarizeCases(cases, fileResults);
  await mkdir(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, "audit-summary.json");
  const casesPath = path.join(outputDir, "audit-cases.json");
  const privateReportPath = path.join(outputDir, "audit-report-private.md");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(casesPath, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  await writeFile(privateReportPath, renderAuditReport(summary, cases), "utf8");
  let sanitizedReportPath = "";
  if (sanitized) {
    sanitizedReportPath = path.join(outputDir, "audit-report-sanitized.md");
    await writeFile(sanitizedReportPath, renderAuditReport(summary, cases, { sanitized: true }), "utf8");
  }
  return { summary, cases, paths: { summaryPath, casesPath, privateReportPath, sanitizedReportPath } };
}
