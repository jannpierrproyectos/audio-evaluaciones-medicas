import { deriveNarrativeFindings } from "../lib/narrative/deriveNarrativeFindings.js";

function comparable(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function getPath(object, path) {
  return String(path || "").split(".").reduce((value, key) => value?.[key], object);
}

function suppressConflictingAreas(findings, reviewFlags) {
  const conflictFields = new Set(
    reviewFlags.filter((flag) => flag.type === "conflicting_values").map((flag) => flag.sourceField),
  );
  if (conflictFields.size === 0) return findings;

  const next = structuredClone(findings);
  next.hallazgos_relevantes = (next.hallazgos_relevantes || []).filter(
    (finding) => !(finding.sources || []).some((source) => conflictFields.has(source)),
  );
  Object.values(next.narrative_groups || {}).forEach((group) => {
    group.hallazgos = (group.hallazgos || []).filter(
      (finding) => !(finding.sources || []).some((source) => conflictFields.has(source)),
    );
    group.narrar = group.hallazgos.length > 0 || group.recomendaciones.length > 0;
  });
  next.has_omitted_findings = true;
  return next;
}

export function applyClinicalRules(worker, reviewFlags = []) {
  const findings = deriveNarrativeFindings(worker);
  const resolved = suppressConflictingAreas(findings, reviewFlags);
  const narrableItems = [
    ...(resolved.hallazgos_relevantes || []),
    ...(resolved.laboratorio_relevante || []),
  ];
  const trace = narrableItems.map((finding) => {
    const sourceField = finding.field || (finding.sources || [])[0] || "";
    return {
      sourceField,
      ruleId: finding.rule_id || `existing_${finding.area || "clinical"}_rule`,
      originalValue: getPath(worker, sourceField),
      normalizedValue: finding.resultado || finding.status,
    };
  });

  const hemoglobin = resolved.laboratorio_basico || {};
  if (hemoglobin.hemoglobina_valor !== null && hemoglobin.hemoglobina_valor !== undefined) {
    trace.push({
      sourceField: "laboratorio_numerico.hemoglobina_valor",
      ruleId: "hemoglobin_source_reference_classification",
      originalValue: {
        value: worker.laboratorio_numerico?.hemoglobina_valor,
        unit: worker.laboratorio_numerico?.hemoglobina_unidad,
        sex: worker.identificacion?.sexo,
        selectedRange: hemoglobin.hemoglobina_rango_seleccionado,
      },
      normalizedValue: hemoglobin.hemoglobina_estado || null,
    });
  }

  Object.entries(resolved.narrative_groups || {}).forEach(([area, group]) => {
    if (!group.recomendaciones?.length || group.association_status === "NONE") return;
    trace.push({
      sourceField: `narrative_groups.${area}`,
      ruleId: "recommendation_structural_association_policy",
      originalValue: group.recomendaciones.map((item) => item.texto_original),
      normalizedValue: group.association_status,
    });
  });

  if (resolved.aptitud?.narrar) {
    trace.push({
      sourceField: "aptitud_y_recomendaciones.aptitud_final",
      ruleId: "aptitude_source_only",
      originalValue: worker.aptitud_y_recomendaciones?.aptitud_final,
      normalizedValue: resolved.aptitud.resultado,
    });
  }

  if (reviewFlags.some((flag) => flag.type === "conflicting_values")) {
    resolved.blocking_reasons = [...(resolved.blocking_reasons || []), "Existen resultados contradictorios."];
    resolved.can_generate_narrative = false;
  }

  return { findings: resolved, trace, ruleVersion: "phase-5.4" };
}

export function hasExplicitAptitude(worker) {
  const value = comparable(worker?.aptitud_y_recomendaciones?.aptitud_final);
  return Boolean(value && value !== "PENDIENTE");
}
