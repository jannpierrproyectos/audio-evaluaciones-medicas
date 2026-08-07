const REPORT_SELECTOR = 'a[href*="imprimirtodos.php"]';

const COLUMN_ALIASES = Object.freeze({
  codigo: ["CODIGO", "CODIGO ATENCION", "COD ATENCION"],
  fecha: ["FECHA"],
  empresa: ["EMPRESA"],
  subcontrata: ["SUBCONTRATA"],
  tipoExamen: ["T EXAMEN", "TIPO EXAMEN"],
  paciente: ["PACIENTE", "TRABAJADOR"],
  tipoDocumento: ["T DOC", "TIPO DOCUMENTO"],
  aptitud: ["APTITUD"],
  impSf: ["IMP S F", "IMP SF"],
});

export function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.:]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeHeader(value = "") {
  return normalizeText(value).toUpperCase();
}

export function resolveColumnIndexes(headerCells) {
  const normalizedHeaders = headerCells.map(normalizeHeader);
  const indexes = {};
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES)) {
    indexes[column] = normalizedHeaders.findIndex((header) => aliases.includes(header));
  }

  // APTITUD debe ser exacto. "CRITERIOS DE APTITUD" nunca es un alias valido.
  indexes.aptitud = normalizedHeaders.findIndex((header) => header === "APTITUD");
  return indexes;
}

export function extractRowData(headerCells, rowCells) {
  const indexes = resolveColumnIndexes(headerCells);
  const valueAt = (column) => indexes[column] >= 0 ? String(rowCells[indexes[column]] ?? "").trim() : "";
  return {
    codigo: valueAt("codigo"),
    fecha: valueAt("fecha"),
    empresa: valueAt("empresa"),
    subcontrata: valueAt("subcontrata"),
    tipoExamen: valueAt("tipoExamen"),
    paciente: valueAt("paciente"),
    tipoDocumento: valueAt("tipoDocumento"),
    aptitud: valueAt("aptitud"),
  };
}

export async function extractVisibleReports(page) {
  const rawRows = await page.locator(REPORT_SELECTOR).evaluateAll((anchors) => {
    const normalize = (value = "") => String(value).normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[.:]+/g, " ")
      .replace(/\s+/g, " ").trim().toUpperCase();
    const directCells = (row) => [...row.children]
      .filter((child) => child.tagName === "TD" || child.tagName === "TH");
    const cellTexts = (row) => directCells(row).map((cell) => (cell.innerText || "").trim());
    const isHeaderLike = (row) => {
      const cells = directCells(row);
      const values = cells.map((cell) => normalize(cell.innerText));
      const known = new Set(["CODIGO", "FECHA", "EMPRESA", "SUBCONTRATA", "T EXAMEN", "PACIENTE", "T DOC", "APTITUD", "IMP S F"]);
      const knownCount = values.filter((value) => known.has(value)).length;
      // Exigir varias etiquetas conocidas evita registrar accidentalmente datos de una fila.
      return knownCount >= 3;
    };
    const isCorrectHeader = (row) => {
      const values = cellTexts(row).map(normalize);
      const hasDocument = values.includes("T DOC") || values.includes("TIPO DOCUMENTO");
      return values.includes("PACIENTE") && hasDocument && values.includes("APTITUD");
    };

    return anchors.map((anchor) => {
      const row = anchor.closest("tr");
      const table = row?.closest("table");
      if (!row || !table) return null;

      // table.rows puede incluir secciones de la tabla, pero se excluyen filas de tablas internas.
      const tableRows = [...table.rows].filter((candidate) => candidate.closest("table") === table);
      const headerRows = tableRows.filter(isHeaderLike);
      const exactHeaderRows = headerRows.filter(isCorrectHeader);
      const previousExactHeaders = exactHeaderRows.filter((candidate) => candidate.rowIndex < row.rowIndex);
      const previousHeaders = headerRows.filter((candidate) => candidate.rowIndex < row.rowIndex);
      const headerRow = previousExactHeaders.at(-1) ?? exactHeaderRows[0]
        ?? previousHeaders.at(-1) ?? headerRows[0] ?? null;

      return {
        href: anchor.href,
        cells: cellTexts(row),
        headers: headerRow ? cellTexts(headerRow) : [],
        headerRows: headerRows.map(cellTexts),
      };
    }).filter(Boolean);
  });

  const seen = new Set();
  const atenciones = [];
  const headerSignatures = new Set();
  const encabezadosEncontrados = [];

  for (const raw of rawRows) {
    for (const headerRow of raw.headerRows) {
      const normalized = headerRow.map(normalizeHeader).filter(Boolean);
      const signature = normalized.join(" | ");
      if (signature && !headerSignatures.has(signature)) {
        headerSignatures.add(signature);
        encabezadosEncontrados.push(signature);
      }
    }

    const ids = extractIds(raw.href);
    const normalizedUrl = normalizeUrl(raw.href);
    const fallback = raw.cells.map(normalizeText).join("|");
    const key = ids.idcomprobante ? `id:${ids.idcomprobante}` : normalizedUrl ? `url:${normalizedUrl}` : `row:${fallback}`;
    if (seen.has(key)) continue;
    seen.add(key);
    atenciones.push({ url: raw.href, ...extractRowData(raw.headers, raw.cells), ...ids });
  }

  return {
    atenciones,
    encabezadosEncontrados,
    totalFilasDetectadas: rawRows.length,
    duplicadosEnPagina: rawRows.length - atenciones.length,
  };
}

export function createAttentionKey(atencion) {
  if (atencion.idcomprobante) return `id:${atencion.idcomprobante}`;
  if (atencion.codigo && atencion.idpaciente) return `codigo-paciente:${normalizeText(atencion.codigo)}:${atencion.idpaciente}`;
  if (atencion.idpaciente && atencion.fecha) return `paciente-fecha:${atencion.idpaciente}:${normalizeText(atencion.fecha)}`;
  const normalizedUrl = normalizeUrl(atencion.url);
  if (normalizedUrl) return `url:${normalizedUrl}`;
  return `fila:${[atencion.codigo, atencion.fecha, atencion.tipoExamen, atencion.aptitud].map(normalizeText).join("|")}`;
}

function extractIds(href) {
  try {
    const url = new URL(href);
    const entries = [...url.searchParams.entries()];
    const getInsensitive = (name) => entries.find(([key]) => normalizeText(key) === name)?.[1] ?? "";
    return { idcomprobante: getInsensitive("idcomprobante"), idpaciente: getInsensitive("idpaciente") };
  } catch {
    return { idcomprobante: "", idpaciente: "" };
  }
}

function normalizeUrl(href) {
  try {
    const url = new URL(href);
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}
