import { extractPdfTextItems } from "./extractPdfTextItems.js";
import { detectPdfTemplate } from "./detectPdfTemplate.js";
import { parseInnomedicMedicalResult } from "./parseInnomedicMedicalResult.js";
import { validateExtractedWorker } from "../validateExtractedWorker.js";

export async function analyzePdfBatch(file) {
  const extracted = await extractPdfTextItems(file);

  const pages = extracted.pages.map((page) => {
    const template = detectPdfTemplate(page.text);

    return {
      page: page.page,
      template_id: template.template_id,
      template_confidence: template.confidence,
      matched_markers: template.matched_markers,
      text: page.text,
      items: page.items,
    };
  });

  const groupedPages = groupPagesByWorker(pages);
const workers = groupedPages.map((group) => {
  let worker;
  try {
    worker = parseWorkerGroup(group);
  } catch (error) {
    worker = createParserFailureWorker(group, error);
  }
  const validation = validateExtractedWorker(worker);

  return {
    ...worker,
    validation,
    derived_states: {
      ...worker.derived_states,
      validation_warnings: validation.warnings,
      validation_error_count: validation.error_count,
      validation_warning_count: validation.warning_count,
      needs_review:
        worker.derived_states?.needs_review ||
        validation.has_errors ||
        validation.has_warnings,
    },
    app_fields: {
      ...worker.app_fields,
      needs_review:
        worker.app_fields?.needs_review ||
        worker.derived_states?.needs_review ||
        validation.has_errors ||
        validation.has_warnings,
    },
  };
});

  return {
    source_type: "pdf_batch",
    file_name: file?.name || "",
    total_pages: extracted.pageCount,
    pages_analyzed: pages.length,
    groups_detected: groupedPages.length,
    workers_detected: workers.length,
    pages,
    groups: groupedPages,
    workers,
  };
}

function parseWorkerGroup(group) {
  if (group.template_id === "innomedic_resultado_evaluacion_medica_v1") {
    return parseInnomedicMedicalResult(group);
  }

  return {
    source_type: "pdf_text",
    template_id: "unknown",
    raw_text: group.pages.map((page) => page.text).join("\n"),
    derived_states: {
      needs_review: true,
      missing_required_fields: [],
      invalid_numeric_fields: [],
      low_confidence_fields: ["template_id"],
    },
  };
}

function groupPagesByWorker(pages) {
  const groups = [];

  for (const page of pages) {
    const isNewWorkerStart = isLikelyWorkerStartPage(page);

    if (isNewWorkerStart || groups.length === 0) {
      groups.push({
        group_index: groups.length,
        template_id: page.template_id,
        template_confidence: page.template_confidence,
        start_page: page.page,
        end_page: page.page,
        pages: [page],
      });
    } else {
      const currentGroup = groups[groups.length - 1];
      currentGroup.end_page = page.page;
      currentGroup.pages.push(page);
    }
  }

  return groups;
}

function isLikelyWorkerStartPage(page) {
  const text = normalizeText(page.text);

  if (page.template_id === "innomedic_resultado_evaluacion_medica_v1") {
    return (
      text.includes("RESULTADO DE EVALUACION MEDICA") &&
      text.includes("DATOS DEL TRABAJADOR") &&
      text.includes("APELLIDOS Y NOMBRES")
    );
  }

  return false;
}

function normalizeText(text = "") {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function createParserFailureWorker(group, error) {
  return {
    source_type: "pdf_text",
    template_id: group.template_id || "unknown",
    raw_text: group.pages.map((page) => page.text).join("\n"),
    parser_error: error instanceof Error ? error.message : String(error),
    identificacion: {},
    datos_generales_narrables: {},
    laboratorio_numerico: {},
    evaluaciones_cualitativas: {},
    aptitud_y_recomendaciones: {},
    app_fields: { needs_review: true },
    derived_states: {
      needs_review: true,
      start_page: group.start_page,
      end_page: group.end_page,
      missing_required_fields: [],
      invalid_numeric_fields: [],
      low_confidence_fields: ["parser_failure"],
    },
  };
}
