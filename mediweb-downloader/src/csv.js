const COLUMNS = [
  "orden", "paginaMediWeb", "codigo", "fecha", "empresa", "subcontrata", "paciente", "tipoExamen", "tipoDocumento", "aptitud", "categoriaAptitud",
  "idcomprobante", "idpaciente", "estado", "telefono", "numeroDocumento", "archivoCompleto", "archivoPdfCompleto", "paginaConsolidado", "intentos", "mensajeError",
];

function escapeCsv(value) {
  const string = String(value ?? "");
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

export function createCsv(rows) {
  return `\uFEFF${[COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((column) => escapeCsv(row[column])).join(","))].join("\r\n")}\r\n`;
}
