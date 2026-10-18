import { useEffect, useRef, useState } from "react";
import { getWhatsAppAvailability, getWhatsAppRecipientName } from "../lib/whatsappMessage.js";
import { recipientVersion } from "../lib/recipientIdentity.js";
import { getRecipientChecks } from "../lib/recipientPolicy.js";
import { matchesReviewFilter, nextReviewId, openWhatsAppCheck, REVIEW_FILTERS, whatsappState } from "../lib/whatsappReview.js";

function localDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function ContactCard({ worker, busy, onDecision, onCorrectPhone }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const checks = getRecipientChecks(worker, now);
  const availability = getWhatsAppAvailability(worker);
  const version = recipientVersion(worker);
  const conflict = worker.app_fields?.phone_analysis;
  const [openedVersion, setOpenedVersion] = useState("");
  const [feedback, setFeedback] = useState("");
  const [identity, setIdentity] = useState(checks.identity);
  const [consent, setConsent] = useState(checks.consent);
  const [pdf, setPdf] = useState(checks.pdf);
  const [duplicate, setDuplicate] = useState(Boolean(conflict?.conflicting && checks.duplicateResolved));
  const [saveAuthorization, setSaveAuthorization] = useState(false);
  const [expires, setExpires] = useState(localDate(worker.app_fields?.recipient_authorization?.expires_at));
  const [phone, setPhone] = useState(worker.datos_operativos?.telefono || "");
  const canDeclare = openedVersion === version && availability.hasValidPhone;
  const completeEvidence = identity && consent && pdf && Date.parse(expires) > now && (!conflict?.conflicting || duplicate);
  const label = status => status ? "Confirmada" : "Pendiente / bloqueada";
  return <section className="wa-review-card" aria-label="Contacto seleccionado">
    <h3>{getWhatsAppRecipientName(worker) || "Identidad pendiente"}</h3>
    <p><strong>Teléfono:</strong> {worker.datos_operativos?.telefono || "Ausente"} {availability.phone ? `(${availability.phone})` : ""}</p>
    <p><strong>WhatsApp:</strong> {whatsappState(worker)} · Formato: {conflict?.format || "pendiente"}</p>
    {conflict?.duplicate ? <p className="inline-feedback is-error">Teléfono repetido en {conflict.duplicate_count} evaluaciones. {conflict.conflicting ? "Hay identidades distintas: se exige comprobación individual." : "Corresponde a la misma identidad; cada evaluación conserva su autorización."}</p> : null}
    <dl className="whatsapp-availability">
      <div><dt>Existencia de WhatsApp</dt><dd>{label(checks.whatsapp)}</dd></div>
      <div><dt>Identidad del destinatario</dt><dd>{label(checks.identity)}</dd></div>
      <div><dt>Autorización vigente</dt><dd>{label(checks.consent)} ({checks.authorizationStatus})</dd></div>
      <div><dt>Correspondencia del PDF</dt><dd>{label(checks.pdf)}</dd></div>
    </dl>
    {worker.app_fields?.whatsapp_verification?.checked_at ? <p className="muted-text">Comprobación: {worker.app_fields.whatsapp_verification.checked_at} · Origen: {worker.app_fields.whatsapp_verification.origin}</p> : null}
    <button type="button" className="primary-button" disabled={busy || !availability.hasValidPhone} onClick={async () => {
      setOpenedVersion("");
      try { await openWhatsAppCheck(worker); setOpenedVersion(version); setFeedback("Comprueba el chat y registra el resultado. Abrirlo no confirma la cuenta ni autoriza entregas."); }
      catch (error) { setOpenedVersion(""); setFeedback(error.message); }
    }}>Abrir WhatsApp</button>

    <details className="technical-detail">
      <summary>Identidad y autorización para esta evaluación</summary>
      <p className="muted-text">Son declaraciones independientes de la existencia de WhatsApp. No se copian de otras evaluaciones.</p>
      <label><input type="checkbox" checked={identity} disabled={busy} onChange={event => setIdentity(event.target.checked)} /> Identidad del destinatario verificada</label>
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /> Autorización de entrega confirmada</label>
      <label><input type="checkbox" checked={pdf} disabled={busy || !availability.hasPdf} onChange={event => setPdf(event.target.checked)} /> Trabajador y PDF corresponden</label>
      {!availability.hasPdf ? <p>Falta el PDF completo vinculado. Importa desde MediWeb con la opción Ambos.</p> : <p className="muted-text">PDF: {availability.pdfName}</p>}
      <label>Autorización vigente hasta<input type="datetime-local" value={expires} disabled={busy} onChange={event => setExpires(event.target.value)} /></label>
      {conflict?.conflicting ? <label><input type="checkbox" checked={duplicate} disabled={busy} onChange={event => setDuplicate(event.target.checked)} /> Comprobé la identidad para este teléfono compartido</label> : null}
      <label><input type="checkbox" checked={saveAuthorization} disabled={busy} onChange={event => setSaveAuthorization(event.target.checked)} /> Guardar estas declaraciones al confirmar «Tiene WhatsApp»</label>
    </details>
    <details className="technical-detail">
      <summary>Corregir teléfono</summary>
      <label>Teléfono corregido<input type="tel" value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} /></label>
      <button type="button" className="secondary-button" disabled={busy || phone === (worker.datos_operativos?.telefono || "")} onClick={() => onCorrectPhone(phone)}>Guardar teléfono</button>
      <p className="muted-text">El cambio invalida la comprobación y las autorizaciones asociadas.</p>
    </details>
    <div className="audio-control-panel">
      <button type="button" className="primary-button" disabled={busy || !canDeclare || (saveAuthorization && !completeEvidence)} onClick={() => onDecision("confirmado_por_operador", {
        expectedVersion: version, expectedConflictSignature: conflict?.signature || "", identity, consent, pdf, duplicate,
        expectedAuthorization: JSON.stringify(worker.app_fields?.recipient_authorization || null),
        saveAuthorization, expires_at: expires ? new Date(expires).toISOString() : null,
      })}>Tiene WhatsApp</button>
      <button type="button" className="secondary-button" disabled={busy || !canDeclare} onClick={() => onDecision("no_disponible", { expectedVersion: version })}>No tiene WhatsApp</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision("incierto", { expectedVersion: version })}>Revisar después</button>
    </div>
    <p role="status">{feedback}</p>
  </section>;
}

export default function WhatsAppReviewQueue({ analysis, onVerifyContact, onUpdateQueue, onUpdateWorker, onRefreshRecipients, onClose, onSelectWorker }) {
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const activeRef = useRef(true);
  const sectionRef = useRef(null);
  useEffect(() => {
    activeRef.current = true;
    sectionRef.current?.focus();
    sectionRef.current?.scrollIntoView({ block: "start" });
    return () => { activeRef.current = false; };
  }, []);
  const [feedback, setFeedback] = useState("");
  const queue = analysis.whatsapp_queue || {};
  const filter = queue.filter || "pendientes";
  const workers = analysis.workers || [];
  const filtered = workers.filter(worker => matchesReviewFilter(worker, filter));
  const selected = workers.find(worker => worker.evaluation_id === queue.selected_evaluation_id);
  const position = filtered.findIndex(worker => worker.evaluation_id === selected?.evaluation_id);

  async function run(action) {
    if (savingRef.current) return;
    savingRef.current = true; setBusy(true); setFeedback("");
    try { await action(); }
    catch (error) { setFeedback(error.message || "No se guardó el resultado. No se avanzó al siguiente contacto."); }
    finally { savingRef.current = false; setBusy(false); }
  }
  async function navigate(id, extra = {}) {
    await onUpdateQueue({ ...queue, ...extra, selected_evaluation_id: id });
    if (!activeRef.current) return;
    const index = workers.findIndex(worker => worker.evaluation_id === id);
    if (index >= 0) onSelectWorker(index);
  }
  return <section ref={sectionRef} tabIndex={-1} className="wa-review" aria-label="Verificación rápida de WhatsApp">
    <div className="panel__header"><div><h2>Verificación rápida de WhatsApp</h2><p>Un contacto por vez. Los resultados se guardan cifrados antes de avanzar.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Volver al panel</button></div>
    <label>Filtrar contactos<select value={filter} disabled={busy} onChange={event => {
      const value = event.target.value;
      run(() => navigate(workers.find(worker => matchesReviewFilter(worker, value))?.evaluation_id || null, { filter: value, visited: [] }));
    }}>{REVIEW_FILTERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <div className="wa-review-layout">
      <div className="wa-review-list" aria-label="Lista de contactos">
        {filtered.map(worker => <button type="button" key={worker.evaluation_id} className={`worker-row${worker.evaluation_id === selected?.evaluation_id ? " is-selected" : ""}`} disabled={busy} aria-pressed={worker.evaluation_id === selected?.evaluation_id} onClick={() => run(() => navigate(worker.evaluation_id))}>
          <span><strong>{getWhatsAppRecipientName(worker) || "Identidad pendiente"}</strong><small>{worker.datos_operativos?.telefono || "Sin teléfono"} · {whatsappState(worker)}</small></span>
        </button>)}
      </div>
      <div>
        {selected ? <ContactCard key={`${selected.evaluation_id}:${recipientVersion(selected)}:${selected.app_fields?.phone_analysis?.signature || ""}`} worker={selected} busy={busy}
          onCorrectPhone={phone => run(async () => {
            const index = workers.findIndex(worker => worker.evaluation_id === selected.evaluation_id);
            await onUpdateWorker(index, worker => ({ ...worker, datos_operativos: { ...worker.datos_operativos, telefono: phone } }));
            await onRefreshRecipients();
            setFeedback("Teléfono guardado. Vuelve a abrir el chat para comprobarlo.");
          })}
          onDecision={(decision, evidence) => run(async () => {
            const updated = await onVerifyContact(selected.evaluation_id, decision, evidence);
            if (!activeRef.current) return;
            const visited = [...new Set([...(queue.visited || []), selected.evaluation_id])];
            await navigate(nextReviewId(updated, selected.evaluation_id, visited, "pendientes"), { visited, filter: "pendientes" });
            setFeedback("Resultado guardado. Las autorizaciones clínicas y de entrega se mantienen independientes.");
          })} /> : <div className="preview-placeholder">No quedan otros contactos en esta vuelta. Los aplazados siguen pendientes.
          <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => navigate(workers.find(worker => matchesReviewFilter(worker, "pendientes"))?.evaluation_id || null, { visited: [], filter: "pendientes" }))}>Reanudar pendientes</button>
        </div>}
        <div className="audio-control-panel">
          <button type="button" className="secondary-button" disabled={busy || position <= 0} onClick={() => run(() => navigate(filtered[position - 1].evaluation_id))}>Anterior</button>
          <button type="button" className="secondary-button" disabled={busy || !filtered.length || position >= filtered.length - 1} onClick={() => run(() => navigate(filtered[Math.max(0, position + 1)].evaluation_id))}>Siguiente</button>
        </div>
      </div>
    </div>
    <p role="status">{busy ? "Guardando…" : feedback}</p>
  </section>;
}
