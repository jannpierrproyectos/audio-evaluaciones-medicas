export const PDF_LINE_Y_TOLERANCE = Object.freeze({
  heightRatio: 0.35,
  min: 0.75,
  max: 3,
});

export const PDF_COLUMN_GAP_TOLERANCE = Object.freeze({
  heightRatio: 4,
  min: 24,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function median(values = []) {
  const sorted = values
    .map((value) => finiteNumber(value))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedItem(item, fallbackIndex) {
  return {
    ...item,
    text: String(item?.text || "").trim(),
    x: finiteNumber(item?.x),
    y: finiteNumber(item?.y),
    width: finiteNumber(item?.width),
    height: finiteNumber(item?.height),
    page: finiteNumber(item?.page, 1),
    sourceIndex: Number.isInteger(item?.sourceIndex) ? item.sourceIndex : fallbackIndex,
  };
}

export function getPdfLineYTolerance(items = []) {
  const typicalHeight = median(items.map((item) => item?.height));
  return clamp(
    typicalHeight * PDF_LINE_Y_TOLERANCE.heightRatio,
    PDF_LINE_Y_TOLERANCE.min,
    PDF_LINE_Y_TOLERANCE.max,
  );
}

export function getPdfColumnGapTolerance(items = []) {
  const typicalHeight = median(items.map((item) => item?.height));
  return Math.max(
    PDF_COLUMN_GAP_TOLERANCE.min,
    typicalHeight * PDF_COLUMN_GAP_TOLERANCE.heightRatio,
  );
}

export function groupPdfTextItemsIntoRows(items = [], options = {}) {
  const normalized = items
    .map(normalizedItem)
    .filter((item) => item.text);
  const yTolerance = options.yTolerance ?? getPdfLineYTolerance(normalized);
  const ordered = normalized.sort((left, right) =>
    left.page - right.page ||
    right.y - left.y ||
    left.x - right.x ||
    left.sourceIndex - right.sourceIndex
  );
  const rows = [];

  ordered.forEach((item) => {
    const candidate = rows.findLast((row) =>
      row.page === item.page && Math.abs(row.y - item.y) <= yTolerance
    );
    if (!candidate) {
      rows.push({ page: item.page, y: item.y, items: [item] });
      return;
    }
    candidate.items.push(item);
    candidate.y = candidate.items.reduce((sum, entry) => sum + entry.y, 0) / candidate.items.length;
  });

  return rows
    .map((row) => ({
      ...row,
      items: row.items.sort((left, right) => left.x - right.x || left.sourceIndex - right.sourceIndex),
    }))
    .sort((left, right) => left.page - right.page || right.y - left.y);
}

export function splitPdfRowIntoVisualLines(row, options = {}) {
  const items = [...(row?.items || [])].sort(
    (left, right) => left.x - right.x || left.sourceIndex - right.sourceIndex,
  );
  if (!items.length) return [];
  const columnGap = options.columnGap ?? getPdfColumnGapTolerance(items);
  const lines = [];

  items.forEach((item) => {
    const current = lines[lines.length - 1];
    if (!current) {
      lines.push([item]);
      return;
    }
    const previous = current[current.length - 1];
    const gap = item.x - (previous.x + previous.width);
    if (gap > columnGap) {
      lines.push([item]);
      return;
    }
    current.push(item);
  });

  return lines.map((lineItems) => ({
    text: lineItems.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
    page: row.page,
    x: Math.min(...lineItems.map((item) => item.x)),
    y: row.y,
    width: Math.max(...lineItems.map((item) => item.x + item.width)) - Math.min(...lineItems.map((item) => item.x)),
    height: Math.max(...lineItems.map((item) => item.height)),
    sourceIndex: Math.min(...lineItems.map((item) => item.sourceIndex)),
    textItems: lineItems,
  }));
}

export function groupPdfTextItemsByVisualLine(items = [], options = {}) {
  return groupPdfTextItemsIntoRows(items, options)
    .flatMap((row) => splitPdfRowIntoVisualLines(row, options))
    .sort((left, right) =>
      left.page - right.page ||
      right.y - left.y ||
      left.x - right.x ||
      left.sourceIndex - right.sourceIndex
    );
}

function comparableLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function extractPdfFieldVisualLines(
  pages = [],
  { anchorLabels = [], startLabels = [], endLabels = [], field = "", yTolerance, columnGap } = {},
) {
  const anchorSet = new Set(anchorLabels.map(comparableLabel));
  const startSet = new Set(startLabels.map(comparableLabel));
  const endSet = new Set(endLabels.map(comparableLabel));
  const result = [];
  let active = false;
  let anchorSeen = anchorSet.size === 0;

  [...pages].sort((left, right) => left.page - right.page).forEach((page) => {
    const pageItems = (page.items || []).map((item, index) => ({
      ...item,
      page: item.page ?? page.page,
      sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : index,
    }));
    const rows = groupPdfTextItemsIntoRows(pageItems, { yTolerance });

    for (const row of rows) {
      if (!anchorSeen) {
        anchorSeen = row.items.some((item) => {
          const value = comparableLabel(item.text);
          return [...anchorSet].some((label) =>
            value === label || value.startsWith(`${label}:`) || value.startsWith(`${label} `)
          );
        });
        if (!anchorSeen) continue;
      }
      const startItems = row.items.filter((item) => startSet.has(comparableLabel(item.text)));
      const endItems = row.items.filter((item) => endSet.has(comparableLabel(item.text)));

      if (!active && !startItems.length) continue;
      if (!active) active = true;
      if (endItems.length) {
        active = false;
        break;
      }

      let candidates = row.items;
      if (startItems.length) {
        const rightEdge = Math.max(...startItems.map((item) => item.x + item.width));
        candidates = candidates.filter((item) => item.x > rightEdge && !startItems.includes(item));
      }

      splitPdfRowIntoVisualLines({ ...row, items: candidates }, { columnGap })
        .filter((line) => line.text && !/^[-–—]+$/.test(line.text))
        .forEach((line) => result.push({
          ...line,
          field,
          sourceText: line.text,
        }));
    }
  });

  return result;
}
