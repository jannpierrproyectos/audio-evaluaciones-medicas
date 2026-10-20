import test from "node:test";
import assert from "node:assert/strict";
import { flowSummary, suggestedFlowStep } from "../src/lib/operationalFlow.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { approveClinicalText } from "../src/lib/clinicalApproval.js";
import { recordWhatsAppDecision } from "../src/lib/whatsappReview.js";
import { applyNarrativeGreeting, DEFAULT_NARRATIVE_GREETING } from "../src/lib/narrativeGreeting.js";
const text = "Texto ficticio aprobado para audio.";
function batch() {
  const analysis = prepareAnalysisForReview({ workers: [{ identificacion: { nombres: "Persona", apellidos: "Ficticia", dni: "00000001" }, aptitud_y_recomendaciones: { aptitud_final: "APTO" }, datos_operativos: { telefono: "999111111" } }] }, "mediweb");
  analysis.greeting = DEFAULT_NARRATIVE_GREETING;
  analysis.workers = analysis.workers.map(worker => approveClinicalText(worker, applyNarrativeGreeting(text, analysis.greeting)));
  return analysis;
}
test("operational route starts with pending WhatsApp and keeps audio approval independent", () => {
  const analysis = batch();
  assert.equal(suggestedFlowStep(analysis), "whatsapp");
  assert.equal(flowSummary(analysis).approved, 1);
  assert.equal(flowSummary(analysis).contactsResolved, 0);
  analysis.review_ui = { flow_step: "review" };
  assert.equal(suggestedFlowStep(analysis), "review");
});
test("saved WhatsApp skips repeated verification; negative result also finishes the channel check", () => {
  for (const decision of ["confirmado_por_operador", "no_disponible"]) {
    const analysis = batch(); analysis.workers = analysis.workers.map(worker => recordWhatsAppDecision(worker, decision));
    assert.equal(flowSummary(analysis).contactsResolved, 1);
    assert.equal(suggestedFlowStep(analysis), "review");
  }
});
test("delivery recovery requires a current approved audio, never starts synthesis", () => {
  const analysis = batch(); analysis.review_ui = { flow_step: "delivery" };
  assert.notEqual(suggestedFlowStep(analysis), "delivery");
  analysis.workers[0].app_fields.audio_record = { operation_id: "fictional" };
  analysis.workers[0].app_fields.audio_stale = false;
  assert.equal(suggestedFlowStep(analysis), "delivery");
  analysis.workers[0].app_fields.audio_stale = true;
  assert.notEqual(suggestedFlowStep(analysis), "delivery");
});
