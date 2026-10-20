import { useCallback, useEffect, useRef, useState } from "react";
import { deliveryAction } from "../services/mediwebService.js";
import { canConfirmDeliveryRecipient, deliveryPreflight, deliveryState, deliveryTaskLabel, matchesDeliveryFilter } from "../lib/deliveryUx.js";
import { openWhatsAppDelivery } from "../lib/whatsappReview.js";

const parts = [["message", "mensaje"], ["pdf", "PDF"], ["mp3", "MP3"]];
export default function DeliveryInbox({ onClose, onCorrect, onAuthorizeRecipient, initialBatchId, embedded = false }) {
  const allBatches = false;
  const [rows, setRows] = useState([]), [selectedId, setSelectedId] = useState(null), [filter, setFilter] = useState("whatsapp");
  const [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  const [opened, setOpened] = useState(new Set());
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
  const preparedHere = ready && openedHere && parts.slice(1).every(([part]) => record?.events.some(event => event.action === part));
  const selectedIndex = filtered.findIndex(row => row.evaluation_id === selected?.evaluation_id);

  async function execute(label, task) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setMessage("");
    try { await task(); }
    catch (error) { setFilter("todos"); openWhatsAppDelivery.discardReservation(); if (mounted.current) setMessage(error.code === "FILE_NOT_FOUND" ? "El PDF completo no está disponible en las ubicaciones de este Connector [FILE_NOT_FOUND]. Los audios y el lote se conservan; comprueba el Connector que guardó el documento." : error.message || "No se pudo completar la accion. Revisa su estado antes de repetir."); }
    finally { await refresh().catch(() => {}); lock.current = false; if (mounted.current) setBusy(""); }
  }
  function select(id) {
    if (lock.current || !id) return;
    setSelectedId(id); setMessage("");
  }
  function openConversation() {
    if (lock.current || !ready) return;
    try { openWhatsAppDelivery.reserve({ fresh: true }); } catch { setMessage("Permite ventanas emergentes; no se abrió una conversación ni se confirmó un envío."); return; }
    execute("abriendo conversación", async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      const begun = await deliveryAction("begin", { id: record.id, kind: "conversation", configuration: proof.configuration });
      let success = false;
      try { await openWhatsAppDelivery({ datos_operativos: { telefono: begun.phone } }, begun.message || record.message); success = true; }
      finally { await deliveryAction("settle", { id: record.id, intent: begun.intent, success, configuration: proof.configuration }); }
      if (mounted.current) setOpened(value => new Set([...value, record.id]));
    });
  }
  function prepareAndOpen() {
    if (lock.current || !selected || (selected.reasons.length && !canConfirmDeliveryRecipient(selected))) return;
    try { openWhatsAppDelivery.reserve({ fresh: true }); } catch { setMessage("Permite abrir WhatsApp para continuar."); return; }
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
      await action("conversation", begun => openWhatsAppDelivery({ datos_operativos: { telefono: begun.phone } }, begun.message || prepared.message));
      setOpened(value => new Set([...value, prepared.id]));
      for (const kind of ["pdf", "mp3"]) {
        if (!prepared.confirmations[kind]) await deliveryAction("reveal", { id: prepared.id, kind, configuration: proof.configuration });
      }
      setMessage("Conversación abierta con el saludo preparado y archivos disponibles. Envía manualmente en WhatsApp y continúa al siguiente trabajador.");
    });
  }
  function copyMessage() {
    execute("copiando mensaje", async () => {
      await deliveryPreflight(selected.evaluation_id);
      await navigator.clipboard.writeText(record.message);
    });
  }
  function checkedAction(action, payload) {
    return execute(action, async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      await deliveryAction(action, { id: record.id, ...payload, configuration: proof.configuration });
    });
  }
  function nextWorker() {
    if (lock.current) return;
    const next = filtered[selectedIndex + 1];
    if (next) select(next.evaluation_id);
    else onClose();
  }
  const Container = embedded ? "section" : "main";
  return <Container className={`${embedded ? "" : "app-shell "}delivery-inbox`}>
    <header className="panel__header"><div><h1>Enviar por WhatsApp</h1><p>Abre el chat con el mensaje y los adjuntos. Envía manualmente y continúa.</p></div><button type="button" disabled={Boolean(busy)} onClick={onClose}>Volver a texto y audio</button></header>
    <div className="delivery-toolbar"><p>{scoped.length} trabajadores · {Math.max(0, selectedIndex + 1)} de {filtered.length}</p>
    <label>Filtrar entregas <select aria-label="Filtrar entregas" disabled={Boolean(busy)} value={filter} onChange={event => { setFilter(event.target.value); const next = scoped.find(row => matchesDeliveryFilter(row, event.target.value)); if (next) select(next.evaluation_id); else setSelectedId(null); }}>
      <option value="whatsapp">WhatsApp confirmado</option><option value="todos">Todos los trabajadores</option>
    </select></label>
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
          <span className={record?.pdf && record?.mp3 ? "is-valid" : ""}>{record?.pdf && record?.mp3 ? "PDF y MP3 disponibles" : "Archivos por preparar"}</span>
        </div>
        {record?.completed_at && <p>Entrega completada por declaracion del operador: {record.completed_at}</p>}
        {selected.reasons.length > 0 && !canConfirmDeliveryRecipient(selected) && <ul>{selected.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {record?.reason && <p role="alert">{record.reason}</p>}
        {canConfirmDeliveryRecipient(selected) && !selected.checks.duplicateResolved && <p role="alert">Este teléfono figura en evaluaciones de personas distintas. Antes de continuar, comprueba que corresponde al destinatario mostrado y que está autorizado para recibir sus documentos.</p>}
        {canConfirmDeliveryRecipient(selected) && <p className="muted-text">Al preparar, confirmas que comprobaste la identidad, la autorización real por WhatsApp y que el PDF corresponde a esta evaluación.</p>}
        <div className="delivery-main-actions">
          {(!selected.reasons.length || canConfirmDeliveryRecipient(selected)) && !["completada", "incierta"].includes(record?.state) && <button type="button" className={preparedHere ? "secondary-button" : "primary-button"} disabled={Boolean(busy)} onClick={prepareAndOpen}>{canConfirmDeliveryRecipient(selected) ? (selected.checks.duplicateResolved ? "Confirmar destinatario y preparar envío" : "Confirmar identidad del teléfono compartido y preparar envío") : preparedHere ? "Volver a preparar adjuntos" : "Preparar envío por WhatsApp"}</button>}
          <button type="button" className={preparedHere ? "primary-button" : "secondary-button"} disabled={Boolean(busy)} onClick={nextWorker}>{selectedIndex < filtered.length - 1 ? "Siguiente trabajador" : "Volver al lote"}</button>
          <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => onCorrect(selected.batch_id, selected.evaluation_id)}>Revisar o corregir evaluación</button>
        </div>
        <details><summary>Mensaje y adjuntos</summary>
        {record?.message && <label>Mensaje institucional<textarea aria-label="Mensaje institucional preparado" readOnly rows={6} value={record.message} /></label>}
        <div className="button-row"><button type="button" disabled={!ready || Boolean(busy)} onClick={openConversation}>Abrir WhatsApp</button>
          <button type="button" disabled={!ready || !openedHere || Boolean(busy)} onClick={copyMessage}>Copiar mensaje</button>
          {parts.slice(1).map(([part, label]) => <button key={part} type="button" disabled={!ready || !openedHere || Boolean(busy) || Boolean(record?.confirmations[part])} onClick={() => checkedAction("reveal", { kind: part })}>Mostrar {label}</button>)}</div>
        <small>Si los adjuntos caducan, vuelve a prepararlos desde aquí.</small>
        </details>
        {selectedIndex > 0 && <button type="button" disabled={Boolean(busy)} onClick={() => select(filtered[selectedIndex - 1].evaluation_id)}>Anterior</button>}
      </section>}
    </div>
    {busy && <p role="status">{busy}…</p>}{message && <p role="status">{message}</p>}
  </Container>;
}
