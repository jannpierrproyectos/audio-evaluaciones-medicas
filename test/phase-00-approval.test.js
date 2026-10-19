import test from "node:test";
import assert from "node:assert/strict";
import { approveClinicalText, getAudioAuthorization, reconcileWorkerReview, requestApprovedAudio, recipientVersion } from "../src/lib/clinicalApproval.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
const text = "Texto clínico revisado por el operador.";
const worker = () => prepareAnalysisForReview({ workers: [{ identificacion: { nombres: "Ana", apellidos: "Prueba", dni: "00000001" }, aptitud_y_recomendaciones: { aptitud_final: "APTO" } }] }, "pdf").workers[0];

test("importación manual y MediWeb nunca aprueban, incluso con estados previos", () => {
  for (const mode of ["pdf", "mediweb"]) {
    const imported = prepareAnalysisForReview({ workers: [approveClinicalText(worker(), text)] }, mode).workers[0];
    assert.equal(imported.derived_states.reviewed_by_user, false);
    assert.equal(imported.app_fields.needs_review, true);
    assert.equal(getAudioAuthorization(imported, text).canGenerateAudio, false);
  }
});

test("aprobación explícita permite TTS individual y cambios lo bloquean sin llamar al proveedor", async () => {
  const approved = approveClinicalText(worker(), text);
  assert.equal(getAudioAuthorization(approved, text).canGenerateAudio, true);
  let calls = 0;
  const synthesize = async () => { calls++; return { audioUrl: "blob:test" }; };
  await requestApprovedAudio({ worker: approved, text, synthesize });
  for (const denied of [worker(), reconcileWorkerReview(approved, { ...approved, app_fields: { ...approved.app_fields, texto_final: "Cambio" } }), reconcileWorkerReview(approved, { ...approved, laboratorio_numerico: { glucosa_valor: 200 } }), { ...approved, validation: { has_errors: true } }, { ...approved, aptitud_y_recomendaciones: { aptitud_final: "PENDIENTE" } }]) {
    await assert.rejects(requestApprovedAudio({ worker: denied, text, synthesize }), /no autorizado/);
  }
  assert.equal(calls, 1);
  assert.equal(getAudioAuthorization(approved, text + " editado").canGenerateAudio, false);
});

test("MediWeb audio is independent of recipient evidence", async () => {
  const current = approveClinicalText({ ...worker(), source_mode: "mediweb", datos_operativos: { telefono: "999888777" } }, text);
  for (const candidate of [current, { ...current, datos_operativos: {} }, { ...current, app_fields: { ...current.app_fields, recipient_authorization: { status: "revocada" } } }]) {
    let calls = 0;
    await requestApprovedAudio({ worker: candidate, text, synthesize: async () => { calls++; } });
    assert.equal(calls, 1);
  }
  const changed = reconcileWorkerReview(current, { ...current, datos_operativos: { telefono: "988777666" } });
  assert.equal(changed.app_fields.recipient_authorization, null);
  assert.equal(getAudioAuthorization(changed, text).canGenerateAudio, true);
});

for (const scenario of ["texto", "revocacion", "destinatario", "revocar y confirmar", "cambiar y confirmar"]) {
  test(`respuesta TTS tras ${scenario}: solo cambia su vigencia si cambia el contenido clinico`, async () => {
    const { isAudioResponseCurrent } = await import("../src/lib/clinicalApproval.js");
    const { getWhatsAppAvailability } = await import("../src/lib/whatsappMessage.js");
    const requestWorker = approveClinicalText({ ...worker(), source_mode: "mediweb", datos_operativos: {
      telefono: "999888777", archivo_pdf_completo: "prueba.pdf", archivo_pdf_completo_id: "test-id",
    } }, text);
    requestWorker.app_fields.whatsapp_confirmed_phone = "51999888777";
    requestWorker.app_fields.recipient_authorization = { status: "confirmada", version: recipientVersion(requestWorker) };
    let finish;
    let calls = 0;
    const pending = requestApprovedAudio({ worker: requestWorker, text, synthesize: () => {
      calls++;
      return new Promise(resolve => { finish = resolve; });
    } });
    let current = { ...requestWorker, app_fields: { ...requestWorker.app_fields, audio_status: "generando" } };
    assert.equal(isAudioResponseCurrent(requestWorker, current, text), true);
    if (scenario === "texto") current = reconcileWorkerReview(current, {
      ...current, app_fields: { ...current.app_fields, texto_final: "Texto modificado" },
    });
    else if (scenario.includes("destinatario") || scenario === "cambiar y confirmar") {
      current = reconcileWorkerReview(current, { ...current, datos_operativos: { ...current.datos_operativos, telefono: "988777666" } });
    } else current = { ...current, app_fields: { ...current.app_fields, recipient_authorization: null } };
    if (scenario.endsWith("confirmar")) current = { ...current, app_fields: { ...current.app_fields,
      whatsapp_confirmed_phone: scenario.startsWith("cambiar") ? "51988777666" : "51999888777",
      recipient_authorization: { status: "confirmada", version: recipientVersion(current) },
    } };
    finish({ audioUrl: "blob:late", audioFilename: "late.mp3", mimeType: "audio/mpeg" });
    const result = await pending;
    const completed = { ...current, app_fields: { ...current.app_fields,
      audio_url: result.audioUrl, audio_filename: result.audioFilename, audio_mime_type: result.mimeType,
      audio_status: "listo", audio_stale: !isAudioResponseCurrent(requestWorker, current, text),
    } };
    assert.equal(calls, 1);
    assert.equal(completed.app_fields.audio_stale, scenario === "texto");
    assert.equal(getWhatsAppAvailability(completed).hasAudio, scenario !== "texto");
  });
}

test("respuesta sin cambios permanece vigente y no invalida la aprobación", async () => {
  const { isAudioResponseCurrent } = await import("../src/lib/clinicalApproval.js");
  const original = approveClinicalText(worker(), text);
  const current = reconcileWorkerReview(original, { ...original, app_fields: { ...original.app_fields, audio_status: "generando" } });
  assert.equal(isAudioResponseCurrent(original, current, text), true);
});
