import test from "node:test";
import assert from "node:assert/strict";
import { attachMediwebWorkerMetadata } from "../src/lib/importMediwebPdf.js";
import { prepareAnalysisForReview, prepareInitialNarratives } from "../src/lib/workerReviewUx.js";
import { getAudioAuthorization } from "../src/lib/clinicalApproval.js";

const worker = dni => ({ identificacion: { dni, nombres: "Persona", apellidos: "Ficticia" }, aptitud_y_recomendaciones: { aptitud_final: "APTO" } });
const entry = (dni, page) => ({ numeroDocumento: dni, paginaConsolidado: page, archivoPdfCompleto: "ficticio.pdf", archivoPdfCompletoId: "ficticio/test.pdf", telefono: "999111111" });

test("Fase04: documento y página consistentes vinculan el PDF sin aprobar", () => {
  const analysis = attachMediwebWorkerMetadata({ workers: [worker("00000001")], groups: [{ start_page: 1 }] }, { workers: [entry("00000001", 1)] });
  assert.equal(analysis.workers[0].datos_operativos.archivo_pdf_completo_id, "ficticio/test.pdf");
  assert.equal(getAudioAuthorization(analysis.workers[0], "texto").canGenerateAudio, false);
});
for (const scenario of ["identidad", "pagina", "duplicado"]) test(`Fase04: asociación ${scenario} ambigua bloquea el PDF y TTS`, () => {
  const entries = scenario === "identidad" ? [entry("00000002", 1)] : scenario === "pagina" ? [entry("00000001", 2)] : [entry("00000001", 1), entry("00000001", 1)];
  const analysis = attachMediwebWorkerMetadata({ workers: [{ ...worker("00000001"), datos_operativos: { archivo_pdf_completo_id: "anterior.pdf" } }], groups: [{ start_page: 1 }] }, { workers: entries });
  assert.equal(analysis.workers[0].datos_operativos.archivo_pdf_completo_id, undefined);
  assert.ok(analysis.workers[0].app_fields.mediweb_link_error);
  assert.equal(getAudioAuthorization(analysis.workers[0], "texto").canGenerateAudio, false);
});
test("Fase04: página sin documento conserva trazabilidad pero no autoriza el PDF completo", () => {
  const analysis = attachMediwebWorkerMetadata({ workers: [worker("")], groups: [{ start_page: 1 }] }, { workers: [entry("00000001", 1)] });
  assert.equal(analysis.workers[0].datos_operativos.telefono, "999111111");
  assert.equal(analysis.workers[0].datos_operativos.archivo_pdf_completo_id, undefined);
});
test("Fase04: narrativas iniciales persistibles usan el motor existente sin revisión humana ficticia", () => {
  const analysis = prepareInitialNarratives(prepareAnalysisForReview({ workers: [worker("00000001")] }, "mediweb"), "Buenas tardes");
  const result = analysis.workers[0];
  assert.match(result.app_fields.texto_final, /^Buenas tardes/);
  assert.equal(result.derived_states.reviewed_by_user, false);
  assert.equal(result.clinical_approval.status, "pendiente");
  assert.equal(getAudioAuthorization(result, result.app_fields.texto_final).canGenerateAudio, false);
});
