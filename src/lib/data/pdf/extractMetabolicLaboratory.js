import { groupPdfTextItemsIntoRows } from "./pdfTextGeometry.js";
import { parseReferenceExpression, parseSourceNumber } from "../metabolicReference.js";

const ANALYTES = {
  glucosa: { label: /^GLUCOSA\b/, kind: "simple" },
  trigliceridos: {
    label: /^TRIGLICERIDOS\b/,
    kind: "categories",
    categories: [
      ["VERY_HIGH", /^MUY ALTO\s*:/],
      ["BORDERLINE_HIGH", /^LIMITE ALTO\s*:/],
      ["HIGH", /^ALTO\s*:/],
      ["NORMAL", /^NORMAL\s*:/],
    ],
  },
  colesterol: {
    label: /^COLESTEROL\b/,
    kind: "categories",
    categories: [
      ["BORDERLINE_HIGH", /^LIMITE ALTO\s*:/],
      ["HIGH", /^ALTO\s*:/],
      ["NORMAL", /^NORMAL\s*:/],
    ],
  },
};

function comparable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function itemTrace(item) {
  return {
    text: item.text,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    page: item.page,
    fontName: item.fontName || "",
    sourceIndex: item.sourceIndex,
  };
}

function positionFromItems(items) {
  if (!items.length) return null;
  return {
    x: Math.min(...items.map((item) => item.x)),
    y: items.reduce((sum, item) => sum + item.y, 0) / items.length,
    width: Math.max(...items.map((item) => item.x + item.width)) - Math.min(...items.map((item) => item.x)),
    height: Math.max(...items.map((item) => item.height)),
  };
}

function referenceTrace(rawText, items, extra = {}) {
  return {
    rawText,
    page: items[0]?.page ?? null,
    position: positionFromItems(items),
    textItems: items.map(itemTrace),
    ...extra,
  };
}

function findValueAndUnit(anchor, row) {
  const candidates = row.items
    .filter((item) => item.x >= anchor.x && item.x <= anchor.x + 210)
    .sort((left, right) => left.x - right.x || left.sourceIndex - right.sourceIndex);
  const afterAnchor = candidates.filter((item) => item !== anchor && item.x >= anchor.x + anchor.width - 2);
  const referenceStart = afterAnchor.findIndex((item) =>
    /^(?:V\.?\s*R\.?|NORMAL\s*:|LIMITE ALTO\s*:|ALTO\s*:|MUY ALTO\s*:)/.test(comparable(item.text))
  );
  const measurementItems = referenceStart >= 0 ? afterAnchor.slice(0, referenceStart) : afterAnchor;
  const joined = measurementItems.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
  const match = joined.match(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(mg\s*\/\s*d[lL])?/i);
  const value = parseSourceNumber(match?.[1]);
  const unitMatch = match?.[2] || joined.match(/mg\s*\/\s*d[lL]/i)?.[0] || "";
  const contributing = measurementItems.filter((item) => {
    const text = comparable(item.text);
    return /\d/.test(text) || /^MG\s*\/\s*DL$/.test(text);
  });
  return {
    value,
    sourceValue: match?.[1] || "",
    unit: unitMatch.replace(/\s+/g, ""),
    source: referenceTrace(joined, [anchor, ...contributing]),
  };
}

function nearbyItems(rows, anchor, maxDistance = 20) {
  return rows
    .filter((row) => row.page === anchor.page && Math.abs(row.y - anchor.y) <= maxDistance)
    .flatMap((row) => row.items)
    .filter((item) => item.x >= anchor.x && item.x <= anchor.x + 215)
    .sort((left, right) => right.y - left.y || left.x - right.x || left.sourceIndex - right.sourceIndex);
}

function extractSimpleReference(rows, anchor) {
  const candidates = nearbyItems(rows, anchor, 8);
  const raw = candidates.map((item) => item.text).join(" ").replace(/\s+/g, " ");
  const match = raw.match(/V\.?\s*R\.?\s*[:.]?\s*([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*[-–—]\s*[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))/i);
  if (!match) return null;
  const expression = parseReferenceExpression(match[1]);
  const items = candidates.filter((item) => /V\.?\s*R\.?|\d|[-–—]/i.test(item.text));
  return referenceTrace(match[0].trim(), items, { expression });
}

function extractCategoryReferences(rows, anchor, specification) {
  const candidates = nearbyItems(rows, anchor, 20);
  const categories = [];
  candidates.forEach((item, index) => {
    const text = comparable(item.text);
    const definition = specification.categories.find(([, label]) => label.test(text));
    if (!definition) return;
    if (specification === ANALYTES.colesterol && /^MUY ALTO\s*:/.test(text)) return;
    const labelRaw = String(item.text).split(":")[0].trim();
    let expressionRaw = String(item.text).slice(String(item.text).indexOf(":") + 1).trim();
    const sourceItems = [item];
    if (!expressionRaw) {
      const next = candidates[index + 1];
      if (next && Math.abs(next.y - item.y) <= 3 && /[\d<>≤≥-]/.test(next.text)) {
        expressionRaw = next.text.trim();
        sourceItems.push(next);
      }
    }
    const expressionMatch = expressionRaw.match(/(?:<=|>=|≤|≥|<|>)\s*[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)|[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*[-–—]\s*[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)/);
    const expressionText = expressionMatch?.[0] || expressionRaw;
    categories.push({
      classification: definition[0],
      labelRaw,
      expressionRaw: expressionText,
      expression: parseReferenceExpression(expressionText),
      ...referenceTrace(sourceItems.map((entry) => entry.text).join(" "), sourceItems),
    });
  });
  const unique = [...new Map(categories.map((category) => [
    `${category.classification}|${category.expressionRaw}`,
    category,
  ])).values()];
  if (!unique.length) return null;
  const items = unique.flatMap((category) => category.textItems || []);
  return {
    rawText: unique.map((category) => category.rawText).join(" | "),
    page: anchor.page,
    position: positionFromItems(items),
    textItems: items,
    categories: unique,
  };
}

export function extractMetabolicLaboratory(pages = []) {
  const result = {};
  const rows = pages.flatMap((page) => groupPdfTextItemsIntoRows(
    (page.items || []).map((item, index) => ({
      ...item,
      page: item.page ?? page.page,
      sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : index,
    })),
  ));

  Object.entries(ANALYTES).forEach(([analyte, specification]) => {
    const anchors = rows.flatMap((row) => row.items.map((item) => ({ item, row })))
      .filter(({ item }) => item.x < 260 && specification.label.test(comparable(item.text)));
    if (anchors.length !== 1) {
      result[`${analyte}_referencia`] = anchors.length > 1
        ? { rawText: "", ambiguous: true, reason: "MULTIPLE_ANALYTE_ANCHORS", textItems: anchors.map(({ item }) => itemTrace(item)) }
        : null;
      return;
    }
    const { item: anchor, row } = anchors[0];
    const measured = findValueAndUnit(anchor, row);
    result[`${analyte}_valor`] = measured.value;
    result[`${analyte}_valor_fuente`] = measured.sourceValue;
    result[`${analyte}_unidad`] = measured.unit;
    result[`${analyte}_fuente`] = measured.source;
    result[`${analyte}_referencia`] = specification.kind === "simple"
      ? extractSimpleReference(rows, anchor)
      : extractCategoryReferences(rows, anchor, specification);
  });
  return result;
}
