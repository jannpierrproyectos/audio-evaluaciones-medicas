const PHONE_LABEL = /\b(?:tel[eé]fono|tel[eé]f\.?|celular)\b\s*:?[ \t]*/giu;
const PHONE_NUMBER = /\+?\s*\d[\d\s().-]{5,22}\d/g;
const INSTITUTIONAL_CONTEXT = /\b(?:central|cl[ií]nica|consultorio|informes|recepci[oó]n|ruc|www\.|direcci[oó]n|sede)\b/i;
const PERSONAL_CONTEXT = /\b(?:correo\s+electr[oó]nico|e-?mail|ficha\s+m[eé]dic[ao]\s+ocupacional|trabajador|paciente)\b/i;
const DOCUMENT_LABEL = /\b(?:DNI|documento(?:\s+de\s+identidad)?|n[uú]mero\s+de\s+documento)\b\s*:?[ \t]*([A-Z0-9-]{6,15})/iu;

function normalizeDigits(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("51") && digits[2] === "9") digits = digits.slice(2);
  return digits;
}

function isUsefulPhone(digits, documentNumbers) {
  if (digits.length < 7 || digits.length > 12 || digits.length === 8) return false;
  if (documentNumbers.has(digits)) return false;
  return true;
}

function linesForPage(page) {
  if (Array.isArray(page.lines)) return page.lines;
  if (!Array.isArray(page.items) || page.items.length === 0) {
    return String(page.text ?? "").split(/\r?\n/).filter(Boolean).map((text) => ({ text }));
  }

  const lines = [];
  for (const item of [...page.items].sort((left, right) => {
    const yDifference = Number(right.y ?? 0) - Number(left.y ?? 0);
    return Math.abs(yDifference) > 2.5 ? yDifference : Number(left.x ?? 0) - Number(right.x ?? 0);
  })) {
    const y = Number(item.y ?? 0);
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines.map((line) => ({
    y: line.y,
    height: page.height,
    text: line.items.sort((left, right) => Number(left.x ?? 0) - Number(right.x ?? 0))
      .map((item) => item.text).join(" "),
  }));
}

function collectDocumentNumbers(pages) {
  const documents = new Set();
  for (const page of pages) {
    for (const line of linesForPage(page)) {
      const match = String(line.text ?? "").match(DOCUMENT_LABEL);
      if (match?.[1]) documents.add(normalizeDigits(match[1]));
    }
  }
  return documents;
}

function candidatesForPage(page, documentNumbers) {
  const candidates = [];
  const pageText = String(page.text ?? "");
  const pageHasPersonalForm = /ficha\s+m[eé]dic[ao]\s+ocupacional/i.test(pageText);

  for (const line of linesForPage(page)) {
    const text = String(line.text ?? "");
    PHONE_LABEL.lastIndex = 0;
    for (const label of text.matchAll(PHONE_LABEL)) {
      const tail = text.slice((label.index ?? 0) + label[0].length, (label.index ?? 0) + label[0].length + 40);
      PHONE_NUMBER.lastIndex = 0;
      const number = PHONE_NUMBER.exec(tail);
      if (!number) continue;
      const digits = normalizeDigits(number[0]);
      if (!isUsefulPhone(digits, documentNumbers)) continue;

      let score = 5;
      if (digits.length === 9 && digits.startsWith("9")) score += 4;
      if (PERSONAL_CONTEXT.test(text)) score += 4;
      if (pageHasPersonalForm) score += 2;
      if (INSTITUTIONAL_CONTEXT.test(text)) score -= 7;
      if (Number.isFinite(line.y) && Number.isFinite(line.height) && line.height > 0) {
        if (line.y > line.height * 0.88 || line.y < line.height * 0.1) score -= 5;
      }
      candidates.push({ digits, score, offset: label.index ?? 0 });
    }
  }

  return candidates.sort((left, right) => right.score - left.score || left.offset - right.offset);
}

export function extractPhoneFromPages(pages = []) {
  const normalizedPages = pages.map((page, index) => ({ ...page, page: page.page ?? index + 1 }));
  const documentNumbers = collectDocumentNumbers(normalizedPages);
  const prioritized = normalizedPages.find((page) => page.page === 11);
  const searchGroups = prioritized
    ? [[prioritized], normalizedPages.filter((page) => page !== prioritized)]
    : [normalizedPages];

  for (const group of searchGroups) {
    let best = null;
    for (const page of group) {
      const candidate = candidatesForPage(page, documentNumbers)[0];
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
    if (best?.score >= 5) return best.digits;
  }
  return "";
}

export function extractDocumentNumberFromPages(pages = []) {
  return [...collectDocumentNumbers(pages)].find(Boolean) ?? "";
}

export async function extractOperationalDataFromPdf(buffer) {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init = [1, 0, 0, 1, 0, 0]) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
      }
    };
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer);
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const view = page.getViewport({ scale: 1 });
    const items = content.items.filter((item) => String(item.str ?? "").trim()).map((item) => ({
      text: item.str,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }));
    pages.push({ page: pageNumber, height: view.height, items, text: items.map((item) => item.text).join(" ") });
  }

  return {
    telefono: extractPhoneFromPages(pages),
    numeroDocumento: extractDocumentNumberFromPages(pages),
  };
}
