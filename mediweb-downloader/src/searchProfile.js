import { createHash } from "node:crypto";
import { isSessionExpired } from "./session.js";
import { extractVisibleReports, createAttentionKey, normalizeText } from "./mediwebTable.js";
import { hasValidResultsTable } from "./pagination.js";
import { MEDIWEB_URL } from "./browser.js";

export const flowError = code => Object.assign(new Error("Se requiere revisar la sesión o la búsqueda en MediWeb."), { code, status: 409 });
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Learn only visible, semantically labelled search controls from the operator's
// actual page. Never collect credentials, hidden fields, patient or document input.
export async function inspectSearch(page) {
  if (!page || await isSessionExpired(page)) return { authentication: "expired", ready: false };
  if (new URL(page.url()).origin !== new URL(MEDIWEB_URL).origin) throw flowError("SEARCH_ORIGIN_CHANGED");
  const search = await page.evaluate(() => {
    const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = element => Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== "hidden";
    const forms = [...document.forms].filter(form => new URL(form.action || location.href).origin === location.origin && !new URL(form.action || location.href).search && ["get", "post"].includes(form.method.toLowerCase()) && /atencion|ocupacional|consulta|busqueda/i.test(new URL(form.action || location.href).pathname));
    const candidates = forms.map(form => {
      const buttons = [...form.querySelectorAll('button, input[type="submit"]')].filter(element => visible(element) && /^(buscar|consultar)$/i.test((element.textContent || element.value).trim()));
      const controls = []; let supported = buttons.length === 1;
      for (const element of form.querySelectorAll("input,select,textarea")) {
        if (!visible(element) || element.disabled || ["submit", "button", "hidden"].includes(element.type)) continue;
        const label = norm([...element.labels || []].map(label => label.textContent).join(" ") || element.getAttribute("aria-label"));
        const kind = /^empresa:?$/.test(label) ? "empresa" : /^(tipo de examen|tipo examen):?$/.test(label) ? "examen" :
          /^(fecha inicial|fecha inicio|desde):?$/.test(label) ? "desde" : /^(fecha final|fecha fin|hasta):?$/.test(label) ? "hasta" : null;
        if (!kind || !element.id || !["select-one", "date"].includes(element.type)) { supported = false; continue; }
        controls.push({ id: element.id, kind, type: element.type, value: element.value,
          label: element.type === "select-one" ? element.selectedOptions[0]?.textContent?.trim() || "" : element.value });
      }
      const action = new URL(form.action || location.href); action.search = ""; action.hash = "";
      return { action: action.href, method: form.method.toLowerCase(), controls, supported: supported && controls.length > 0 && new Set(controls.map(control => control.kind)).size === controls.length,
        button: buttons[0]?.textContent?.trim() || buttons[0]?.value || "" };
    });
    const supported = candidates.filter(form => form.supported);
    const form = supported.length === 1 ? supported[0] : null;
    // Saving/replaying filters requires a fully supported form. Importing the
    // table already prepared by the operator does not. Still check every known
    // filter when another control makes that form unsuitable for replay.
    const manual = form || (candidates.length === 1 ? candidates[0] : null);
    return { form, controls: manual?.controls || [] };
  });
  const { form, controls } = search;
  const ready = await hasValidResultsTable(page);
  const extraction = ready ? await extractVisibleReports(page) : null;
  const structure = form ? hash({ action: form.action, method: form.method, controls: form.controls.map(({ id, kind, type }) => ({ id, kind, type })), button: form.button })
    : controls.length ? hash(controls.map(({ id, kind, type }) => ({ id, kind, type }))) : null;
  return { authentication: ready ? "results_visible" : "unknown", ready, form, controls, structure, extraction };
}

function dateValue(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function verifySearchRows(extraction, controls = []) {
  if (!extraction?.atenciones?.length) throw flowError("SEARCH_NO_RESULTS");
  for (const row of extraction.atenciones) for (const control of controls) {
    if (!control.value || /^(todos|todas|seleccione|--)/i.test(control.label)) continue;
    if (control.kind === "empresa" && normalizeText(row.empresa) !== normalizeText(control.label)) throw flowError("SEARCH_RESULTS_MISMATCH");
    if (control.kind === "examen" && normalizeText(row.tipoExamen) !== normalizeText(control.label)) throw flowError("SEARCH_RESULTS_MISMATCH");
    if (["desde", "hasta"].includes(control.kind)) {
      const date = dateValue(row.fecha);
      if (!date || (control.kind === "desde" ? date < control.value : date > control.value)) throw flowError("SEARCH_RESULTS_MISMATCH");
    }
  }
  return hash(extraction.atenciones.map(row => ({ key: createAttentionKey(row), fecha: row.fecha, empresa: row.empresa,
    tipoExamen: row.tipoExamen, paciente: row.paciente, aptitud: row.aptitud })));
}

export async function applySearchProfile(page, profile) {
  let inspection = await inspectSearch(page);
  if (inspection.authentication === "expired") throw flowError("SESSION_EXPIRED");
  if (!inspection.form && !inspection.ready && profile?.form?.action && new URL(profile.form.action).origin === new URL(MEDIWEB_URL).origin) {
    await page.goto(profile.form.action, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => { throw flowError("SEARCH_MANUAL_REQUIRED"); });
    inspection = await inspectSearch(page);
    if (inspection.authentication === "expired") throw flowError("SESSION_EXPIRED");
  }
  if (!profile?.structure || inspection.structure !== profile.structure) throw flowError("SEARCH_INTERFACE_CHANGED");
  for (const control of profile.form.controls) {
    const locator = page.locator(`[id=${JSON.stringify(control.id)}]`);
    if (control.type === "select-one") await locator.selectOption(control.value);
    else await locator.fill(control.value);
  }
  // Wait for an actual search response; a previous visible table alone is insufficient.
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).origin === new URL(profile.form.action).origin &&
      new URL(response.url()).pathname === new URL(profile.form.action).pathname && response.ok() &&
      response.request().method().toLowerCase() === profile.form.method, { timeout: 15000 }),
    page.getByRole("button", { name: profile.form.button, exact: true }).click(),
  ]).catch(() => { throw flowError("SEARCH_NOT_CONFIRMED"); });
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const result = await inspectSearch(page);
    if (result.authentication === "expired") throw flowError("SESSION_EXPIRED");
    if (result.structure !== profile.structure) throw flowError("SEARCH_INTERFACE_CHANGED");
    if (result.form.controls.every((control, index) => control.value === profile.form.controls[index].value)) {
      try { verifySearchRows(result.extraction, profile.form.controls); return result; } catch { /* Wait for the expected table to render. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw flowError("SEARCH_RESULTS_MISMATCH");
}
