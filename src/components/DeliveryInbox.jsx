import { useCallback, useEffect, useRef, useState } from "react";
import { deliveryAction } from "../services/mediwebService.js";
import { deliveryPreflight, deliveryState, nextDelivery, nextPendingDelivery } from "../lib/deliveryUx.js";
import { getTtsConfiguration } from "../lib/evaluationPersistence.js";
import { openWhatsAppCheck } from "../lib/whatsappReview.js";

const parts = [["message", "mensaje"], ["pdf", "PDF"], ["mp3", "MP3"]];
export default function DeliveryInbox({ onClose, onCorrect }) {
  const [rows, setRows] = useState([]), [selectedId, setSelectedId] = useState(null), [filter, setFilter] = useState("pendientes");
  const [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  const [opened, setOpened] = useState(new Set()), [reason, setReason] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [outcomes, setOutcomes] = useState({ message: "incierto", pdf: "incierto", mp3: "incierto" });
  const attempted = useRef(new Set()), lock = useRef(false), cancelRequested = useRef(false), mounted = useRef(false);
  const refresh = useCallback(async () => {
    const result = await deliveryAction("list");
    if (mounted.current) setRows(result.rows); return result.rows;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => { refresh().then(rows => setSelectedId(rows.find(row => deliveryState(row) !== "enviados")?.evaluation_id || rows[0]?.evaluation_id || null)).catch(error => setMessage(error.message)); }, 0);
    const interval = setInterval(() => { if (!lock.current) refresh().catch(error => setMessage(error.message)); }, 15000);
    return () => { mounted.current = false; clearTimeout(timer); clearInterval(interval); };
  }, [refresh]);
  const filtered = rows.filter(row => filter === "todos" || deliveryState(row) === filter);
  const selected = rows.find(row => row.evaluation_id === selectedId) || filtered[0];
  const record = selected?.delivery;
  const ready = record?.state === "listo" && !selected.reasons.length;
  const openedHere = opened.has(record?.id);

  async function execute(label, task) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setMessage("");
    try { await task(); }
    catch (error) { if (mounted.current) setMessage(error.message || "No se pudo completar la acción. Revisa su estado antes de repetir."); }
    finally { await refresh().catch(() => {}); lock.current = false; if (mounted.current) setBusy(""); }
  }
  async function prepare(row) {
    cancelRequested.current = false;
    await execute("preparando", async () => {
      const proof = await deliveryPreflight(row.evaluation_id);
      if (cancelRequested.current) return;
      await deliveryAction("prepare", { evaluationId: row.evaluation_id, ...proof });
      if (cancelRequested.current) await deliveryAction("cancel", { evaluationId: row.evaluation_id });
    });
  }
  useEffect(() => {
    if (!selected || selected.reasons.length || selected.delivery && !["invalidada"].includes(selected.delivery.state)) return;
    const key = `${selected.evaluation_id}:${selected.binding}`;
    if (attempted.current.has(key) || lock.current) return;
    const timer = setTimeout(() => { if (!lock.current) { attempted.current.add(key); prepare(selected); } }, 0);
    return () => clearTimeout(timer);
  });
  function select(id) {
    if (lock.current || !id) return;
    setSelectedId(id); setReason(""); setAcknowledged(false); setMessage("");
    setOutcomes({ message: "incierto", pdf: "incierto", mp3: "incierto" });
  }
  function openConversation() {
    if (lock.current || !ready) return;
    try { openWhatsAppCheck.reserve(); } catch { setMessage("Permite ventanas emergentes; no se abrió una conversación ni se confirmó un envío."); return; }
    execute("abriendo conversación", async () => {
      const proof = await deliveryPreflight(selected.evaluation_id);
      const begun = await deliveryAction("begin", { id: record.id, kind: "conversation", configuration: proof.configuration });
      let success = false;
      try { await openWhatsAppCheck({ datos_operativos: { telefono: begun.phone } }); success = true; }
      finally { await deliveryAction("settle", { id: record.id, intent: begun.intent, success, configuration: proof.configuration }); }
      if (mounted.current) setOpened(value => new Set([...value, record.id]));
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
      await deliveryAction("complete", { id: record.id, confirmed: true, configuration: proof.configuration });
      const current = await refresh(), next = nextPendingDelivery(current, selected.evaluation_id);
      if (next) { setSelectedId(next); setReason(""); setAcknowledged(false); }
      else setMessage("No quedan otras entregas autorizadas pendientes.");
    });
  }
  return <main className="app-shell delivery-inbox">
    <header className="panel__header"><div><h1>Bandeja de entregas</h1><p>Preparación asistida. Cada envío lo realiza y declara el operador en WhatsApp.</p></div><button type="button" disabled={Boolean(busy)} onClick={onClose}>Volver al panel</button></header>
    <p>Listas: {rows.filter(row => deliveryState(row) === "listos").length} · Completadas: {rows.filter(row => deliveryState(row) === "enviados").length} · Incidencias: {rows.filter(row => deliveryState(row) === "incidencias").length} · Total: {rows.length}</p>
    <label>Filtrar entregas <select aria-label="Filtrar entregas" disabled={Boolean(busy)} value={filter} onChange={event => { setFilter(event.target.value); const next = rows.find(row => event.target.value === "todos" || deliveryState(row) === event.target.value); if (next) select(next.evaluation_id); else setSelectedId(null); }}>
      <option value="pendientes">Pendientes</option><option value="listos">Listos</option><option value="enviados">Enviados</option><option value="incidencias">Incidencias</option><option value="todos">Todos</option>
    </select></label>
    <button type="button" disabled={Boolean(busy)} onClick={() => refresh().catch(error => setMessage(error.message))}>Actualizar bandeja</button>
    <div className="delivery-layout">
      <div role="listbox" aria-label="Evaluaciones para entrega" className="delivery-list">{filtered.map(row => <button role="option" aria-selected={row.evaluation_id === selected?.evaluation_id} key={row.evaluation_id} disabled={Boolean(busy)} onClick={() => select(row.evaluation_id)}>
        <strong>{row.name || "Identidad pendiente"}</strong><span>{row.phone} · {row.delivery?.state || (row.reasons.length ? "bloqueado" : "pendiente de preparación")}</span>
      </button>)}{!filtered.length && <p>No hay registros para este filtro.</p>}</div>
      {selected && <section className="panel" aria-label="Entrega seleccionada">
        <h2>{selected.name || "Identidad pendiente"}</h2><p>Contacto: {selected.phone}</p>
        <p>WhatsApp: {selected.checks.whatsapp ? "confirmado" : "pendiente"} · Identidad: {selected.checks.identity ? "verificada" : "pendiente"} · Autorización: {selected.checks.consent ? "vigente" : selected.checks.authorizationStatus} · Aprobación clínica: {selected.approval ? "vigente" : "pendiente o invalidada"}</p>
        <p>PDF: {record?.pdf ? "preparado con huella" : selected.pdf ? "referencia por comprobar" : "faltante o sin verificar"} · MP3: {record?.mp3 ? "preparado con huella" : selected.audio ? "registrado; se comprobará su vigencia" : "faltante u obsoleto"}</p>
        <p>Preparación: {record?.state || "pendiente"} · Conversación: {openedHere ? "abierta en esta sesión" : record?.events.some(event => event.action === "conversation") ? "abierta anteriormente; vuelve a comprobarla" : "sin abrir"}</p>
        {record?.phone && <p>Versión preparada para: {record.recipient_name} · {record.phone}{record.completed_at ? ` · Completada por declaración del operador: ${record.completed_at}` : ""}</p>}
        {selected.reasons.length > 0 && <ul>{selected.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {record?.reason && <p role="alert">{record.reason}</p>}
        <button type="button" disabled={Boolean(busy)} onClick={() => onCorrect(selected.batch_id, selected.evaluation_id)}>Revisar o corregir evaluación</button>
        {!selected.reasons.length && !["completada", "incierta"].includes(record?.state) && <button type="button" disabled={Boolean(busy)} onClick={() => prepare(selected)}>{["cancelada", "preparando"].includes(record?.state) ? "Reanudar preparación" : "Comprobar y preparar entrega"}</button>}
        {busy === "preparando" && <button type="button" onClick={() => { cancelRequested.current = true; setMessage("Cancelación solicitada: se conservarán los archivos protegidos, sin abrir chats ni enviar información."); }}>Cancelar preparación</button>}
        {record?.state === "listo" && !record.events.some(event => ["conversation", "message", "pdf", "mp3", "confirm"].includes(event.action)) && <button type="button" disabled={Boolean(busy)} onClick={() => execute("cancelando", () => deliveryAction("cancel", { evaluationId: selected.evaluation_id }))}>Pausar preparación</button>}
        {record?.message && <label>Mensaje institucional preparado<textarea aria-label="Mensaje institucional preparado" readOnly rows={10} value={record.message} /></label>}
        <div className="button-row"><button type="button" disabled={!ready || Boolean(busy)} onClick={openConversation}>Abrir WhatsApp</button>
          <button type="button" disabled={!ready || !openedHere || Boolean(busy) || Boolean(record?.confirmations.message)} onClick={copyMessage}>Copiar mensaje</button>
          {parts.slice(1).map(([part, label]) => <button key={part} type="button" disabled={!ready || !openedHere || Boolean(busy) || Boolean(record?.confirmations[part])} onClick={() => checkedAction("reveal", { kind: part })}>Mostrar {label}</button>)}</div>
        <small>Mostrar crea una copia temporal legible, privada de tu usuario, durante un máximo de 15 minutos. Adjunta y comprueba el archivo antes de confirmar su envío; después se elimina la copia. No la muevas ni copies a otra carpeta.</small>
        <fieldset><legend>Declaraciones de envío del operador</legend>{parts.map(([part, label]) => <p key={part}>{label}: {record?.confirmations[part] ? "enviado confirmado por operador" : "sin confirmar"} <button type="button" disabled={!ready || !openedHere || Boolean(busy) || Boolean(record?.confirmations[part]) || !record?.events.some(event => event.action === part)} onClick={() => checkedAction("confirm", { part, confirmed: true })}>Confirmo que envié {label}</button></p>)}</fieldset>
        <button type="button" className="primary-button" disabled={!ready || Boolean(busy) || !parts.every(([part]) => record?.confirmations[part])} onClick={complete}>Confirmar y siguiente</button>
        {record?.state === "completada" && <details><summary>Reabrir entrega ya completada</summary><p>Puede duplicar información ya enviada. Requiere un motivo y autorización explícita del operador.</p>
          <label>Motivo de reapertura<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label><label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> Confirmo que quiero repetir esta entrega</label>
          <button type="button" disabled={Boolean(busy) || !acknowledged || reason.trim().length < 5} onClick={() => execute("reabriendo", () => deliveryAction("reopen", { id: record.id, confirmed: true, reason }))}>Reabrir con motivo</button>
        </details>}
        {record?.state === "incierta" && <details open><summary>Conciliar resultado incierto</summary><p>Comprueba el chat y los adjuntos manualmente. Una duda pendiente mantiene el bloqueo. No se borran confirmaciones previas.</p>
          {parts.map(([part, label]) => <label key={part}>Resultado de {label}<select aria-label={`Resultado de ${label}`} value={outcomes[part]} onChange={event => setOutcomes(value => ({ ...value, [part]: event.target.value }))}><option value="incierto">Aún incierto</option><option value="no_enviado">Comprobé que no se envió</option><option value="enviado">Comprobé que se envió</option></select></label>)}
          <label>Motivo de conciliación<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label><label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> Declaro que comprobé estos resultados manualmente</label>
          <button type="button" disabled={Boolean(busy) || !acknowledged || reason.trim().length < 5} onClick={() => execute("conciliando", async () => deliveryAction("reconcile", { id: record.id, outcomes, reason, confirmed: true, configuration: await getTtsConfiguration() }))}>Guardar conciliación</button>
        </details>}
        <div className="button-row"><button type="button" disabled={Boolean(busy) || filtered.length < 2} onClick={() => select(nextDelivery(rows, selected.evaluation_id, filter, -1))}>Anterior</button><button type="button" disabled={Boolean(busy) || filtered.length < 2} onClick={() => select(nextDelivery(rows, selected.evaluation_id, filter))}>Siguiente</button></div>
      </section>}
    </div>
    {busy && <p role="status">{busy}…</p>}{message && <p role="status">{message}</p>}
    <p>Las confirmaciones son declaraciones del operador, no evidencias del servidor de WhatsApp. No se realizan envíos automáticos ni se generan audios desde esta bandeja.</p>
  </main>;
}
