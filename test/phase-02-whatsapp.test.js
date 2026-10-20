import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EvaluationStore } from "../mediweb-downloader/src/evaluationStore.js";
import { prepareAnalysisForReview } from "../src/lib/workerReviewUx.js";
import { approveClinicalText, reconcileWorkerReview, recipientVersion, requestApprovedAudio, getAudioAuthorization } from "../src/lib/clinicalApproval.js";
import { isWhatsAppConfirmed } from "../src/lib/whatsappMessage.js";
import { restoreWorker } from "../src/lib/evaluationPersistence.js";
import { getRecipientChecks } from "../src/lib/recipientPolicy.js";
import { analyzePhones, createWhatsAppCheckWindow, matchesReviewFilter, nextReviewId, phoneSummary, recordWhatsAppDecision, synchronizeRecipients } from "../src/lib/whatsappReview.js";

const now = Date.parse("2026-10-01T12:00:00Z");
const text = "Buenos días. Texto ficticio aprobado para prueba.";
function worker(document = "00000001", phone = "999888777") {
  return { ...prepareAnalysisForReview({ workers: [{ identificacion: { nombres: "Persona", apellidos: `Ficticia ${document}`, dni: document },
    aptitud_y_recomendaciones: { aptitud_final: "APTO" }, datos_operativos: { telefono: phone, archivo_pdf_completo: "ficticio.pdf", archivo_pdf_completo_id: "prueba/ficticio.pdf" },
  }] }, "mediweb").workers[0], evaluation_id: crypto.randomUUID(), batch_id: crypto.randomUUID() };
}
const evidence = { saveAuthorization: true, identity: true, consent: true, pdf: true, expires_at: "2099-01-01T00:00:00Z" };

test("clasifica formatos peruanos, ausentes e incompletos; válido no demuestra WhatsApp", () => {
  const input = [worker("1", "+51 999 888 777"), worker("2", "999888777"), worker("3", "123"), worker("4", ""), worker("5", "abc"), worker("6", "51123456789")];
  const result = synchronizeRecipients(input);
  assert.deepEqual(result.map(item => item.app_fields.phone_analysis.format), ["formato_valido", "formato_valido", "incompleto", "faltante", "invalido", "invalido"]);
  assert.equal(isWhatsAppConfirmed(result[0]), false);
  assert.deepEqual(phoneSummary(result), { validos: 2, invalidos: 4, ausentes: 1, incompletos: 1, pendientes: 6, confirmados: 0, sin_whatsapp: 0, duplicados: 2, conflictos: 2 });
});

test("duplicados entre identidades bloquean la entrega y conservan TTS aprobado", async () => {
  let [first, second] = synchronizeRecipients([worker(), worker("00000002")]);
  assert.throws(() => recordWhatsAppDecision(first, "confirmado_por_operador", evidence, now), /teléfono compartido/);
  first = approveClinicalText(recordWhatsAppDecision(first, "confirmado_por_operador", { ...evidence, duplicate: true }, now), text);
  assert.equal(getAudioAuthorization(first, text).canGenerateAudio, true);
  const changedGroup = synchronizeRecipients([first, second, worker("00000003")]);
  assert.equal(getAudioAuthorization(changedGroup[0], text).canGenerateAudio, true);
  assert.equal(getRecipientChecks(changedGroup[0]).authorized, false);
  await requestApprovedAudio({ worker: changedGroup[0], text, synthesize: async () => ({}) });
});

test("misma persona con varias evaluaciones no se confunde con un conflicto de identidad", () => {
  const first = worker(); const second = { ...structuredClone(first), evaluation_id: crypto.randomUUID(), batch_id: crypto.randomUUID() };
  const results = analyzePhones([first, second]);
  assert.equal(results[0].duplicate, true);
  assert.equal(results[0].conflicting, false);
  assert.equal(results[1].conflicting, false);
});

test("reutiliza únicamente existencia vigente para la misma persona y teléfono, sin trasladar autorización", () => {
  const prior = recordWhatsAppDecision(worker(), "confirmado_por_operador", evidence, now);
  const next = { ...worker(), identificacion: { ...prior.identificacion } };
  const recovered = synchronizeRecipients([next], [prior])[0];
  assert.equal(isWhatsAppConfirmed(recovered), true);
  assert.equal(recovered.app_fields.whatsapp_verification.origin, "recuperada");
  assert.equal(recovered.app_fields.whatsapp_verification.checked_at, prior.app_fields.whatsapp_verification.checked_at);
  assert.equal(recovered.app_fields.recipient_authorization, undefined);
  assert.equal(getRecipientChecks(recovered).authorized, false);
  for (const source of [
    { ...prior, app_fields: { ...prior.app_fields, recipient_authorization: { ...prior.app_fields.recipient_authorization, status: "revocada" } } },
    { ...prior, app_fields: { ...prior.app_fields, recipient_authorization: { ...prior.app_fields.recipient_authorization, expires_at: "2000-01-01" } } },
  ]) assert.equal(isWhatsAppConfirmed(synchronizeRecipients([next], [source])[0]), false);
});

test("un resultado negativo más reciente y una identidad distinta impiden reutilizar antecedentes", () => {
  const first = recordWhatsAppDecision(worker(), "confirmado_por_operador", evidence, now);
  const negative = recordWhatsAppDecision({ ...structuredClone(first), evaluation_id: crypto.randomUUID() }, "no_disponible", {}, now + 1);
  const next = { ...worker(), identificacion: { ...first.identificacion } };
  assert.equal(isWhatsAppConfirmed(synchronizeRecipients([next], [first, negative])[0]), false);
  assert.equal(isWhatsAppConfirmed(synchronizeRecipients([worker("00000002")], [first])[0]), false);
  assert.equal(isWhatsAppConfirmed(synchronizeRecipients([{ ...next, datos_operativos: { ...next.datos_operativos, telefono: "988777666" } }], [first])[0]), false);
});

test("revocar el antecedente invalida comprobaciones recuperadas y no las resucita", () => {
  const first = recordWhatsAppDecision(worker(), "confirmado_por_operador", evidence, now);
  let next = synchronizeRecipients([{ ...worker(), identificacion: first.identificacion }], [first])[0];
  assert.equal(isWhatsAppConfirmed(next), true);
  const revoked = { ...first, app_fields: { ...first.app_fields, recipient_authorization: { ...first.app_fields.recipient_authorization, status: "revocada" } } };
  next = synchronizeRecipients([next], [revoked])[0];
  assert.equal(isWhatsAppConfirmed(next), false);
  assert.equal(isWhatsAppConfirmed(synchronizeRecipients([next], [first])[0]), false);
});

test("cambiar teléfono o identidad invalida comprobación y autorización sin aprobar clínicamente", () => {
  const original = recordWhatsAppDecision(worker(), "confirmado_por_operador", evidence, now);
  for (const next of [{ ...original, datos_operativos: { ...original.datos_operativos, telefono: "988777666" } }, { ...original, identificacion: { ...original.identificacion, dni: "00000009" } }]) {
    const changed = reconcileWorkerReview(original, next);
    assert.equal(isWhatsAppConfirmed(changed), false);
    assert.equal(changed.app_fields.recipient_authorization, null);
    assert.equal(changed.derived_states.reviewed_by_user, false);
  }
});

test("navegación consecutiva evita bucles con Revisar después y conserva filtros", () => {
  let input = synchronizeRecipients([worker("1"), worker("2", "988777666"), worker("3", "977666555")]);
  const [a, b, c] = input.map(item => item.evaluation_id);
  input[0] = recordWhatsAppDecision(input[0], "incierto", {}, now);
  assert.equal(nextReviewId(input, a, [a]), b);
  input[1] = recordWhatsAppDecision(input[1], "no_disponible", {}, now);
  assert.equal(nextReviewId(input, b, [a, b]), c);
  assert.equal(nextReviewId(input, c, [a, b, c]), null);
  assert.equal(matchesReviewFilter(input[1], "sin-whatsapp"), true);
  assert.equal(matchesReviewFilter(input[1], "bloqueados"), true);
  assert.equal(matchesReviewFilter(input[0], "pendientes"), true);
});

test("apertura reutiliza WindowProxy, no añade mensajes ni datos clínicos y tolera bloqueo", async () => {
  let opens = 0;
  const chat = { closed: false, opener: {}, location: { href: "", replace(url) { this.href = url; } } };
  let openerAssignments = 0;
  Object.defineProperty(chat, "opener", { get: () => null, set: () => {
    if (++openerAssignments > 1) throw new Error("Cross-origin opener write denied");
  } });
  const open = createWhatsAppCheckWindow((url, name) => { opens++; assert.equal(url, "about:blank"); assert.equal(name, "_blank"); return chat; });
  await open(worker()); await open(worker("2", "988777666"));
  assert.equal(opens, 1);
  assert.equal(chat.location.href, "https://wa.me/51988777666");
  assert.equal(chat.opener, null);
  assert.equal(openerAssignments, 1);
  assert.equal(new URL(chat.location.href).search, "");
  await assert.rejects(open(worker("3", "abc")), /inválido/);
  await assert.rejects(createWhatsAppCheckWindow(() => null)(worker()), /ventanas emergentes/);
});

test("restricción cross-origin reemplaza la ventana de comprobación sin conservar opener", async () => {
  let closes = 0, opens = 0, navigations = 0;
  const first = { closed: false, opener: {}, close() { closes++; this.closed = true; }, location: { replace() { if (++navigations > 1) throw new Error("SecurityError"); } } };
  const second = { closed: false, opener: {}, location: { href: "", replace(url) { this.href = url; } } };
  const open = createWhatsAppCheckWindow(() => ++opens === 1 ? first : second);
  await open(worker()); await open(worker("2", "988777666"));
  assert.equal(closes, 1);
  assert.equal(opens, 2);
  assert.equal(second.opener, null);
  assert.equal(second.location.href, "https://wa.me/51988777666");
});

test("TTS exige aprobacion clinica; identidad y consentimiento solo bloquean entrega y no se inventan", async () => {
  const original = approveClinicalText(worker(), text);
  const onlyAccount = recordWhatsAppDecision(original, "confirmado_por_operador", {}, now);
  let calls = 0; const synthesize = async () => { calls++; return {}; };
  await requestApprovedAudio({ worker: onlyAccount, text, synthesize });
  assert.equal(getRecipientChecks(onlyAccount).authorized, false);
  const allowed = recordWhatsAppDecision(original, "confirmado_por_operador", evidence, now);
  assert.equal(getAudioAuthorization(allowed, text).canGenerateAudio, true);
  await requestApprovedAudio({ worker: allowed, text, synthesize });
  for (const authorization of [{ ...allowed.app_fields.recipient_authorization, identity_confirmed: false }, { ...allowed.app_fields.recipient_authorization, pdf_confirmed: false }, { ...allowed.app_fields.recipient_authorization, channel_authorized: false }, { ...allowed.app_fields.recipient_authorization, status: "revocada" }, { ...allowed.app_fields.recipient_authorization, expires_at: "2000-01-01" }]) {
    const denied = recordWhatsAppDecision({ ...allowed, app_fields: { ...allowed.app_fields, recipient_authorization: authorization } }, "confirmado_por_operador", {}, now);
    assert.equal(getRecipientChecks(denied).authorized, false);
    await requestApprovedAudio({ worker: denied, text, synthesize });
  }
  assert.equal(calls, 7);
});

test("compatibilidad Fase 01 y persistencia cifrada de cola/comprobaciones después de reinicio", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ae-wa-review-test-"));
  const protection = { restrictDirectory: async () => {}, protectKey: async bytes => Buffer.from(bytes).reverse() };
  try {
    const store = await new EvaluationStore({ directory, protection }).initialize();
    const imported = await store.import({ workers: [worker()], greeting: "Buenos días" }, "2".repeat(64));
    let person = imported.snapshot.workers[0];
    person = approveClinicalText(recordWhatsAppDecision(person, "confirmado_por_operador", evidence, now), text);
    imported.snapshot.workers[0] = person;
    imported.snapshot.whatsapp_queue = { selected_evaluation_id: person.evaluation_id, filter: "confirmados", visited: [person.evaluation_id] };
    await store.save(imported.id, imported.snapshot, imported.revision);
    const reopened = await new EvaluationStore({ directory, protection }).initialize();
    const loaded = await reopened.load(imported.id);
    assert.equal(loaded.snapshot.whatsapp_queue.selected_evaluation_id, person.evaluation_id);
    assert.equal(isWhatsAppConfirmed(restoreWorker(loaded.snapshot.workers[0])), true);
    const contacts = (await reopened.contacts()).contacts;
    assert.equal(contacts[0].app_fields.whatsapp_verification.origin, "operador_cola");
    assert.equal(JSON.stringify(contacts).includes(text), false);
    assert.equal(JSON.stringify(contacts).includes("clinical_approval"), false);
    const legacy = structuredClone(person);
    legacy.app_fields.recipient_authorization = { status: "confirmada", version: recipientVersion(legacy), expires_at: evidence.expires_at };
    assert.equal(getRecipientChecks(restoreWorker(legacy)).authorized, true);
    const ciphertext = await readFile(path.join(directory, "catalogue.enc"));
    assert.equal(ciphertext.includes(Buffer.from(text)), false);
    assert.equal(ciphertext.includes(Buffer.from("999888777")), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("delivery reserves its new window during the click and only discards an unused reservation", async () => {
  const windows = [];
  const open = createWhatsAppCheckWindow(() => {
    const tab = { closed: false, opener: {}, location: { href: "", replace(url) { this.href = url; } }, close() { this.closed = true; } };
    windows.push(tab); return tab;
  });
  await open(worker());
  open.reserve({ fresh: true });
  assert.equal(windows.length, 2, "New window exists before any awaited preflight");
  assert.equal(windows[0].closed, false, "Checking chat remains untouched");
  open.discardReservation();
  assert.equal(windows[1].closed, true, "Missing PDF leaves no empty delivery tab");
  assert.equal(windows[0].closed, false);
  open.reserve({ fresh: true });
  await open(worker("2", "988777666"));
  open.discardReservation();
  assert.equal(windows[2].closed, false, "An opened conversation is never discarded");
  assert.equal(windows[2].location.href, "https://wa.me/51988777666");
});
