import { extractVisibleReports, normalizeText } from "./mediwebTable.js";

const NEXT_TEXT = "siguiente";
const DEFAULT_CHANGE_TIMEOUT = 15_000;
const DEFAULT_POLL_INTERVAL = 400;
const PAGINATION_CONTAINERS = [
  'nav[aria-label*="pagin" i]',
  '[role="navigation"][aria-label*="pagin" i]',
  '.pagination',
  '[class*="pagination" i]',
  '[class*="paginacion" i]',
  '[id*="pagination" i]',
  '[id*="paginacion" i]',
];
const NEXT_CANDIDATES = 'a, button, input[type="button"], input[type="submit"]';

function normalizePaginationLabel(value) {
  return normalizeText(value).replace(/\s*[>›»→]+\s*$/u, "").trim();
}

async function visibleExactNext(locator) {
  const matches = [];
  for (const candidate of await locator.all()) {
    const data = await candidate.evaluate((element) => ({
      text: element instanceof HTMLInputElement ? element.value : element.textContent,
      visible: Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== "hidden"
        && getComputedStyle(element).display !== "none",
    })).catch(() => ({ text: "", visible: false }));
    if (data.visible && normalizePaginationLabel(data.text) === NEXT_TEXT) matches.push(candidate);
  }
  return matches;
}

export async function findNextPageControl(page) {
  const relNext = page.locator('[rel~="next" i]');
  const visibleRelNext = [];
  for (const candidate of await relNext.all()) {
    if (await candidate.isVisible().catch(() => false)) visibleRelNext.push(candidate);
  }
  if (visibleRelNext.length === 1) return visibleRelNext[0];

  for (const selector of PAGINATION_CONTAINERS) {
    const matches = await visibleExactNext(page.locator(selector).locator(NEXT_CANDIDATES));
    if (matches.length === 1) return matches[0];
  }

  const documentMatches = await visibleExactNext(page.locator(NEXT_CANDIDATES));
  return documentMatches.length === 1 ? documentMatches[0] : null;
}

export async function isNextPageEnabled(control) {
  if (!control || !await control.isVisible().catch(() => false)) return false;
  return control.evaluate((element) => {
    const disabledClasses = /(^|\s)(disabled|is-disabled|ui-state-disabled|paginate_button_disabled)(\s|$)/i;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute("disabled") || current.getAttribute("aria-disabled")?.toLowerCase() === "true") return false;
      if (disabledClasses.test(current.className || "")) return false;
    }
    return true;
  }).catch(() => false);
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createPageSignature(atenciones) {
  const parts = atenciones.map((item) => item.idcomprobante
    || [item.codigo, item.idpaciente].filter(Boolean).join(":")
    || [item.codigo, item.fecha, item.tipoExamen].map(normalizeText).join(":"))
    .sort();
  return `${parts.length}:${hashText(parts.join("|"))}`;
}

export async function getCurrentPageNumber(page) {
  const selectors = PAGINATION_CONTAINERS.map((container) => `${container} [aria-current="page"]`)
    .concat(PAGINATION_CONTAINERS.map((container) => `${container} .active`));
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    for (const candidate of await candidates.all()) {
      if (!await candidate.isVisible().catch(() => false)) continue;
      const text = normalizeText(await candidate.textContent().catch(() => ""));
      if (/^\d+$/.test(text)) return Number(text);
    }
  }
  return null;
}

export async function hasValidResultsTable(page) {
  return page.locator("table").evaluateAll((tables) => tables.some((table) => {
    const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[.:]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    const headers = [...table.querySelectorAll("th, tr > td")].map((cell) => normalize(cell.textContent));
    return headers.includes("APTITUD") && (headers.includes("IMP S F") || headers.includes("IMP SF"));
  })).catch(() => false);
}

export async function waitForPageSignatureChange(page, previousSignature, {
  timeout = DEFAULT_CHANGE_TIMEOUT,
  pollInterval = DEFAULT_POLL_INTERVAL,
} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const extraction = await extractVisibleReports(page).catch(() => null);
    if (extraction?.atenciones.length > 0) {
      const signature = createPageSignature(extraction.atenciones);
      if (signature !== previousSignature) {
        console.log("[PAGINACIÓN] Cambio de tabla detectado.");
        return { changed: true, extraction, signature };
      }
    }
    await page.waitForTimeout(Math.min(pollInterval, Math.max(0, deadline - Date.now())));
  }
  return { changed: false };
}

async function controlDiagnostic(control) {
  return control.evaluate((element) => ({
    tag: element.tagName,
    text: (element instanceof HTMLInputElement ? element.value : element.textContent || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase(),
  })).catch(() => ({ tag: "DESCONOCIDO", text: "" }));
}

function safePaginationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/gi, "[URL omitida]").replace(/[\r\n]+/g, " ").slice(0, 240);
}

async function detectEmptyLastPage(page, previousSignature) {
  const extraction = await extractVisibleReports(page).catch(() => null);
  if (!extraction || extraction.atenciones.length > 0 || !await hasValidResultsTable(page)) return null;
  const nextControl = await findNextPageControl(page);
  if (nextControl && await isNextPageEnabled(nextControl)) return null;
  return { changed: true, extraction, signature: createPageSignature(extraction.atenciones), previousSignature };
}

export async function goToNextResultsPage(page, previousSignature, options = {}) {
  const changeTimeout = options.changeTimeout ?? options.timeout ?? DEFAULT_CHANGE_TIMEOUT;
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const expectedPageNumber = options.expectedPageNumber ?? null;

  const currentExtraction = await extractVisibleReports(page).catch(() => null);
  const currentSignature = currentExtraction?.atenciones.length > 0
    ? createPageSignature(currentExtraction.atenciones)
    : null;
  console.log("[PAGINACIÓN] Firma actual obtenida.");
  if (currentSignature && currentSignature !== previousSignature) {
    console.log("[PAGINACIÓN] Cambio de tabla detectado.");
    return successfulAdvance(page, {
      changed: true,
      extraction: currentExtraction,
      signature: currentSignature,
    }, expectedPageNumber, 0);
  }
  console.log("[PAGINACIÓN] Buscando control Siguiente...");
  const control = await findNextPageControl(page);
  if (!control) return { status: "last_page", attempt: 0 };

  const diagnostic = await controlDiagnostic(control);
  const visible = await control.isVisible().catch(() => false);
  const enabled = await isNextPageEnabled(control);
  console.log("[PAGINACIÓN] Control Siguiente encontrado");
  console.log(`[PAGINACIÓN] Tag: ${diagnostic.tag}`);
  console.log(`[PAGINACIÓN] Texto: ${diagnostic.text}`);
  console.log(`[PAGINACIÓN] Visible: ${visible ? "sí" : "no"}`);
  console.log(`[PAGINACIÓN] Habilitado: ${enabled ? "sí" : "no"}`);
  if (!visible || !enabled) return { status: "last_page", attempt: 0 };
  console.log("[PAGINACIÓN] Siguiente encontrado y habilitado.");

  try {
    await control.scrollIntoViewIfNeeded({ timeout: 5_000 });
    console.log("[PAGINACIÓN] Ejecutando clic normal...");
    await control.click({ timeout: 5_000, noWaitAfter: true });
    console.log("[PAGINACIÓN] Clic normal enviado.");
    console.log("[PAGINACIÓN] Esperando cambio de tabla...");
    const changed = await waitForPageSignatureChange(page, previousSignature, { timeout: changeTimeout, pollInterval });
    if (changed.changed) return successfulAdvance(page, changed, expectedPageNumber, 1);
    const emptyLastPage = await detectEmptyLastPage(page, previousSignature);
    if (emptyLastPage) return successfulAdvance(page, emptyLastPage, expectedPageNumber, 1);
    console.warn("[PAGINACIÓN] La tabla no cambió tras el clic normal.");
  } catch (error) {
    console.warn(`[PAGINACIÓN] El clic normal falló: ${safePaginationError(error)}`);
  }

  console.log("[PAGINACIÓN] Intentando fallback DOM...");
  try {
    await control.evaluate((element) => element.click(), undefined, { timeout: 5_000 });
  } catch (error) {
    console.warn(`[PAGINACIÓN] El fallback DOM falló: ${safePaginationError(error)}`);
    console.error("[PAGINACIÓN] No fue posible avanzar después de 2 intentos.");
    return { status: "error", attempt: 2, error };
  }

  console.log("[PAGINACIÓN] Esperando cambio de tabla...");
  const changed = await waitForPageSignatureChange(page, previousSignature, { timeout: changeTimeout, pollInterval });
  if (changed.changed) return successfulAdvance(page, changed, expectedPageNumber, 2);
  const emptyLastPage = await detectEmptyLastPage(page, previousSignature);
  if (emptyLastPage) return successfulAdvance(page, emptyLastPage, expectedPageNumber, 2);
  console.error("[PAGINACIÓN] No fue posible avanzar después de 2 intentos.");
  return { status: "error", attempt: 2 };
}

async function successfulAdvance(page, change, expectedPageNumber, attempt) {
  console.log("[PAGINACIÓN] Tabla cambió correctamente.");
  const currentPageNumber = await getCurrentPageNumber(page);
  const detectedPageNumber = currentPageNumber ?? expectedPageNumber;
  if (detectedPageNumber !== null) console.log(`[PAGINACIÓN] Nueva página detectada: ${detectedPageNumber}`);
  return { status: "advanced", attempt, ...change, currentPageNumber };
}
