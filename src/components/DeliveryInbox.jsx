import { useCallback, useEffect, useRef, useState } from "react";
import { deliveryAction } from "../services/mediwebService.js";
import { canConfirmDeliveryRecipient, deliveryPreflight, deliveryState, deliveryTaskLabel, matchesDeliveryFilter, nextDelivery, nextPendingDelivery } from "../lib/deliveryUx.js";
import { getTtsConfiguration } from "../lib/evaluationPersistence.js";
import { openWhatsAppCheck } from "../lib/whatsappReview.js";

const parts = [["message", "mensaje"], ["pdf", "PDF"], ["mp3", "MP3"]];
export default function DeliveryInbox({ onClose, onCorrect, onAuthorizeRecipient, initialBatchId, embedded = false }) {
  const [allBatches, setAllBatches] = useState(false);
  const [rows, setRows] = useState([]), [selectedId, setSelectedId] = useState(null), [filter, setFilter] = useState("preparables");
  const [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  const [opened, setOpened] = useState(new Set()), [reason, setReason] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [outcomes, setOutcomes] = useState({ message: "incierto", pdf: "incierto", mp3: "incierto" });
  const lock = useRef(false), mounted = useRef(false);
  const refresh = useCallback(async () => {
    const result = await deliveryAction("list");
    if (mounted.current) setRows(result.rows); return result.rows;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => { refresh().then(rows => setSelectedId(rows.find(row => row.batch_id === initialBatchId && deliveryState(row) !== "enviados")?.evaluation_id || rows.find(row => deliveryState(row) !== "enviados")?.evaluation_id || rows[0]?.evaluation_id || null)).catch(error => setMessage(error.message)); }, 0);
    const interval = setInterval(() => { if (!lock.current) refresh().catch(error => setMessage(error.message)); }, 15000);
    return () => { mounted.current = false; clearTimeout(timer); clearInterval(interval); };
  }, [refresh, initialBatchId]);
  const scoped = rows.filter(row => allBatches || !initialBatchId || row.batch_id === initialBatchId);
  const filtered = scoped.filter(row => matchesDeliveryFilter(row, filter));
  const selected = filtered.find(row => row.evaluation_id === selectedId) || filtered[0];
  const record = selected?.delivery;
  const ready = record?.state === "listo" && !selected.reasons.length;
  const openedHere = opened.has(record?.id);
  const preparedHere = ready && openedHere && parts.every(([part]) => record?.events.some(event => event.action === part));

  async function execute(label, task) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setMessage("");
    try { await task(); }
    catch (error) { setFilter("pendientes"); openWhatsAppCheck.discardReservation(); if (mounted.current) setMessage(error.code === "FILE_NOT_FOUND" ? "El PDF completo no está disponible en las ubicaciones de este Connector [FILE_NOT_FOUND]. Los audios y el lote se conservan; comprueba el Connector que guardó el documento." : error.message || "No se pudo completar la accion. Revisa su estado antes de repetir."); }
    finally { await refresh().catch(() => {}); lock.current = false; if (mounted.current) setBusy(""); }
  }
  function select(id) {
    if (lock.current || !id) return;
    setSelectedId(id); setReason(""); setAcknowledged(false); setMessage("");
    setOutcomes({ message: "incierto", pdf: "incierto", mp3: "incierto" });
  }
  function openConversation() {
    if (lock.current || !ready) return;
    try { openWhatsAppCheck.reserve({ fresh: true }); } catch { setMessage("Permite ventanas emergentes; no se abrió una conversación ni se confirmó un envío."); return; }
    execute("abriendo conversación", async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      const begun = await deliveryAction("begin", { id: record.id, kind: "conversation", configuration: proof.configuration });
      let success = false;
      try { await openWhatsAppCheck({ datos_operativos: { telefono: begun.phone } }); success = true; }
      finally { await deliveryAction("settle", { id: record.id, intent: begun.intent, success, configuration: proof.configuration }); }
      if (mounted.current) setOpened(value => new Set([...value, record.id]));
    });
  }
  function prepareAndOpen() {
    if (lock.current || !selected || (selected.reasons.length && !canConfirmDeliveryRecipient(selected))) return;
    try { openWhatsAppCheck.reserve({ fresh: true }); } catch { setMessage("Permite abrir WhatsApp para continuar."); return; }
    execute("preparando envío", async () => {
      if (!selected.checks.authorized && canConfirmDeliveryRecipient(selected)) await onAuthorizeRecipient(selected);
      const proof = await deliveryPreflight(selected.evaluation_id);
      const prepared = await deliveryAction("prepare", { evaluationId: selected.evaluation_id, ...proof });
      const action = async (kind, perform) => {
        const begun = await deliveryAction("begin", { id: prepared.id, kind, configuration: proof.configuration });
        let success = false;
        try { await perform(begun); success = true; }
        finally { await deliveryAction("settle", { id: prepared.id, intent: begun.intent, success, configuration: proof.configuration }); }
      };
      await action("conversation", begun => openWhatsAppCheck({ datos_operativos: { telefono: begun.phone } }));
      setOpened(value => new Set([...value, prepared.id]));
      if (!prepared.confirmations.message) await action("message", begun => navigator.clipboard.writeText(begun.message));
      for (const kind of ["pdf", "mp3"]) {
        if (!prepared.confirmations[kind]) await deliveryAction("reveal", { id: prepared.id, kind, configuration: proof.configuration });
      }
      setMessage("Conversación abierta, mensaje copiado y archivos disponibles. Envía manualmente en WhatsApp y registra el resultado.");
    });
  }
  function copyMessage() {
    execute("copiando mensaje", async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      const begun = await deliveryAction("begin", { id: record.id, kind: "message", configuration: proof.configuration });
      let success = false;
      try { await navigator.clipboard.writeText(begun.message); success = true; }
      finally { await deliveryAction("settle", { id: record.id, intent: begun.intent, success, configuration: proof.configuration }); }
    });
  }
  function checkedAction(action, payload) {
    return execute(action, async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      await deliveryAction(action, { id: record.id, ...payload, configuration: proof.configuration });
    });
  }
  function complete() {
    execute("confirmando entrega", async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      await deliveryAction("complete", { id: record.id, confirmed: true, allParts: true, configuration: proof.configuration });
      const current = await refresh(), next = nextPendingDelivery(current.filter(row => allBatches || !initialBatchId || row.batch_id === initialBatchId), selected.evaluation_id);
      if (next) { setSelectedId(next); setReason(""); setAcknowledged(false); }
      else setMessage("No quedan otras entregas autorizadas pendientes.");
    });
  }
  const Container = embedded ? "section" : "main";
  return <Container className={`${embedded ? "" : "app-shell "}delivery-inbox`}>
    <header className="panel__header"><div><h1>Enviar por WhatsApp</h1><p>Preparación asistida. Cada envío lo realiza y declara el operador en WhatsApp.</p></div><button type="button" disabled={Boolean(busy)} onClick={onClose}>Volver a texto y audio</button></header>
    <div className="delivery-toolbar"><p>Listas: {scoped.filter(row => deliveryState(row) === "listos").length} · Completadas: {scoped.filter(row => deliveryState(row) === "enviados").length} · Incidencias: {scoped.filter(row => deliveryState(row) === "incidencias").length} · Total: {scoped.length}</p>
    <label>Filtrar entregas <select aria-label="Filtrar entregas" disabled={Boolean(busy)} value={filter} onChange={event => { setFilter(event.target.value); const next = scoped.find(row => matchesDeliveryFilter(row, event.target.value)); if (next) select(next.evaluation_id); else setSelectedId(null); }}>
      <option value="preparables">Para enviar</option><option value="pendientes">Todas las pendientes</option><option value="listos">Listos</option><option value="enviados">Enviados</option><option value="incidencias">Incidencias</option><option value="todos">Todos</option>
    </select></label>
    <button type="button" disabled={Boolean(busy)} onClick={() => setAllBatches(value => !value)}>{allBatches ? "Solo este lote" : "Otros lotes"}</button>
    <button type="button" disabled={Boolean(busy)} onClick={() => refresh().catch(error => setMessage(error.message))}>Actualizar bandeja</button></div>
    <div className="delivery-layout">
      <div role="listbox" aria-label="Evaluaciones para entrega" className="delivery-list">{filtered.map(row => <button role="option" aria-selected={row.evaluation_id === selected?.evaluation_id} key={row.evaluation_id} disabled={Boolean(busy)} onClick={() => select(row.evaluation_id)}>
        <strong>{row.name || "Identidad pendiente"}</strong><span>{row.phone} · {deliveryTaskLabel(row)}</span>
      </button>)}{!filtered.length && <p>No hay evaluaciones listas en este filtro. Puedes revisar las pendientes desde el selector.</p>}</div>
      {selected && <section className="panel" aria-label="Entrega seleccionada">
        <div className="delivery-person"><h2>{selected.name || "Identidad pendiente"}</h2><span>{selected.phone}</span></div>
        <div className="delivery-readiness">
          <span className={selected.checks.whatsapp ? "is-valid" : ""}>WhatsApp {selected.checks.whatsapp ? "confirmado" : "pendiente"}</span>
          <span className={selected.checks.identity && selected.checks.consent ? "is-valid" : ""}>Destinatario {selected.checks.identity && selected.checks.consent ? "autorizado" : "pendiente"}</span>
          <span className={selected.approval ? "is-valid" : ""}>Texto {selected.approval ? "aprobado" : "por revisar"}</span>
          <span className={record?.pdf && record?.mp3 ? "is-valid" : ""}>{record?.pdf && record?.mp3 ? "PDF y MP3 verificados" : "Archivos por preparar"}</span>
        </div>
        {record?.completed_at && <p>Entrega completada por declaracion del operador: {record.completed_at}</p>}
        {selected.reasons.length > 0 && !canConfirmDeliveryRecipient(selected) && <ul>{selected.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {record?.reason && <p role="alert">{record.reason}</p>}
        {canConfirmDeliveryRecipient(selected) && !selected.checks.duplicateResolved && <p role="alert">Este teléfono figura en evaluaciones de personas distintas. Antes de continuar, comprueba que corresponde al destinatario mostrado y que está autorizado para recibir sus documentos.</p>}
        {canConfirmDeliveryRecipient(selected) && <p className="muted-text">Al preparar, confirmas que comprobaste la identidad, la autorización real por WhatsApp y que el PDF corresponde a esta evaluación.</p>}
        <div className="delivery-main-actions">
          {(!selected.reasons.length || canConfirmDeliveryRecipient(selected)) && !["completada", "incierta"].includes(record?.state) && <button type="button" className={preparedHere ? "secondary-button" : "primary-button"} disabled={Boolean(busy)} onClick={prepareAndOpen}>{canConfirmDeliveryRecipient(selected) ? (selected.checks.duplicateResolved ? "Confirmar destinatario y preparar envío" : "Confirmar identidad del teléfono compartido y preparar envío") : preparedHere ? "Volver a preparar adjuntos" : "Preparar envío por WhatsApp"}</button>}
          {ready && <button type="button" className="primary-button" disabled={!preparedHere || Boolean(busy)} onClick={complete}>Confirmo que envié mensaje, PDF y MP3 · siguiente</button>}
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => onCorrect(selected.batch_id, selected.evaluation_id)}>Revisar o corregir evaluación</button>
        </div>
        {record?.message && <details><summary>Mensaje preparado {preparedHere ? "· copiado para pegar" : ""}</summary><label>Mensaje institucional<textarea aria-label="Mensaje institucional preparado" readOnly rows={6} value={record.message} /></label></details>}
        <details><summary>Adjuntos, envío parcial y herramientas</summary>
        <div className="button-row"><button type="button" disabled={!ready || Boolean(busy)} onClick={openConversation}>Abrir WhatsApp</button>
          <button type="button" disabled={!ready || !openedHere || Boolean(busy)} onClick={copyMessage}>Copiar mensaje</button>
          {parts.slice(1).map(([part, label]) => <button key={part} type="button" disabled={!ready || !openedHere || Boolean(busy) || Boolean(record?.confirmations[part])} onClick={() => checkedAction("reveal", { kind: part })}>Mostrar {label}</button>)}</div>
        <small>Mostrar crea una copia temporal legible, privada de tu usuario, durante un máximo de 15 minutos. Adjunta y comprueba el archivo antes de confirmar su envío; después se elimina la copia. No la muevas ni copies a otra carpeta.</small>
        <button type="button" disabled={!ready || !openedHere || Boolean(busy)} onClick={() => checkedAction("uncertain", { confirmed: true })}>El resultado es parcial o incierto</button>
        <fieldset><legend>Declaraciones de envío del operador</legend>{parts.map(([part, label]) => <p key={part}>{label}: {record?.confirmations[part] ? "enviado confirmado por operador" : "sin confirmar"} <button type="button" disabled={!ready || !openedHere || Boolean(busy) || Boolean(record?.confirmations[part]) || !record?.events.some(event => event.action === part)} onClick={() => checkedAction("confirm", { part, confirmed: true })}>Confirmo que envié {label}</button></p>)}</fieldset>
        </details>
        <small className="muted-text">Copias privadas durante 15 minutos. Puedes volver a prepararlas; los originales cifrados se conservan.</small>
        {record?.state === "completada" && <details><summary>Reabrir entrega ya completada</summary><p>Puede duplicar información ya enviada. Requiere un motivo y autorización explícita del operador.</p>
          <label>Motivo de reapertura<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label><label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> Confirmo que quiero repetir esta entrega</label>
          <button type="button" disabled={Boolean(busy) || !acknowledged || reason.trim().length < 5} onClick={() => execute("reabriendo", () => deliveryAction("reopen", { id: record.id, confirmed: true, reason }))}>Reabrir con motivo</button>
        </details>}
        {record?.state === "incierta" && <details open><summary>Conciliar resultado incierto</summary><p>Comprueba el chat y los adjuntos manualmente. Una duda pendiente mantiene el bloqueo. No se borran confirmaciones previas.</p>
          {parts.map(([part, label]) => <label key={part}>Resultado de {label}<select aria-label={`Resultado de ${label}`} value={outcomes[part]} onChange={event => setOutcomes(value => ({ ...value, [part]: event.target.value }))}><option value="incierto">Aún incierto</option><option value="no_enviado">Comprobé que no se envió</option><option value="enviado">Comprobé que se envió</option></select></label>)}
          <label>Motivo de conciliación<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label><label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> Declaro que comprobé estos resultados manualmente</label>
          <button type="button" disabled={Boolean(busy) || !acknowledged || reason.trim().length < 5} onClick={() => execute("conciliando", async () => deliveryAction("reconcile", { id: record.id, outcomes, reason, confirmed: true, configuration: await getTtsConfiguration() }))}>Guardar conciliación</button>
        </details>}
        <div className="button-row"><button type="button" disabled={Boolean(busy) || filtered.length < 2} onClick={() => select(nextDelivery(scoped, selected.evaluation_id, filter, -1))}>Anterior</button><button type="button" disabled={Boolean(busy) || filtered.length < 2} onClick={() => select(nextDelivery(scoped, selected.evaluation_id, filter))}>Siguiente</button></div>
      </section>}
    </div>
    {busy && <p role="status">{busy}…</p>}{message && <p role="status">{message}</p>}
    <p className="delivery-footnote">Envío manual en WhatsApp. Solo se registra la entrega que declares.</p>
  </Container>;
}
