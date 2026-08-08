import path from "node:path";

const MODES = new Set(["first", "full", "both"]);

export function parseArgs(argv) {
  const options = {
    mode: null, limit: null, perPageLimit: null, output: null, delay: 900, maxPages: null, singlePage: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === "--mode") {
      if (!MODES.has(value)) throw new Error("--mode debe ser first, full o both.");
      options.mode = value;
      index += 1;
    } else if (argument === "--limit") {
      const limit = Number.parseInt(value, 10);
      if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit debe ser un entero mayor que cero.");
      options.limit = limit;
      index += 1;
    } else if (argument === "--output") {
      if (!value || value.startsWith("--")) throw new Error("--output requiere una ruta.");
      options.output = path.resolve(value);
      index += 1;
    } else if (argument === "--per-page-limit") {
      const perPageLimit = /^\d+$/.test(value ?? "") ? Number(value) : Number.NaN;
      if (!Number.isInteger(perPageLimit) || perPageLimit < 1) {
        throw new Error("--per-page-limit debe ser un entero mayor que cero.");
      }
      options.perPageLimit = perPageLimit;
      index += 1;
    } else if (argument === "--delay") {
      const delay = Number.parseInt(value, 10);
      if (!Number.isInteger(delay) || delay < 0) throw new Error("--delay debe ser un entero no negativo en milisegundos.");
      options.delay = delay;
      index += 1;
    } else if (argument === "--max-pages") {
      const maxPages = /^\d+$/.test(value ?? "") ? Number(value) : Number.NaN;
      if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("--max-pages debe ser un entero mayor que cero.");
      options.maxPages = maxPages;
      index += 1;
    } else if (argument === "--single-page") {
      options.singlePage = true;
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }

  if (options.singlePage && options.maxPages !== null) {
    throw new Error("--single-page y --max-pages no pueden usarse juntos.");
  }

  return options;
}
