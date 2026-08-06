import path from "node:path";
import { mkdir, readdir, rmdir } from "node:fs/promises";

export function timestamp(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export async function createOutputPaths(moduleRoot, customBase, mode) {
  const base = customBase ?? path.join(moduleRoot, "downloads");
  const root = path.join(base, timestamp());
  const paths = {
    root,
    control: path.join(root, "control"),
    manifest: path.join(root, "control", "manifest.json"),
    csv: path.join(root, "control", "resultados.csv"),
    tmp: path.join(root, "tmp"),
    full: path.join(root, "reportes-completos"),
    audio: path.join(root, "audioevaluaciones"),
    consolidated: path.join(root, "audioevaluaciones", "primeras-hojas.pdf"),
  };
  await Promise.all([mkdir(paths.control, { recursive: true }), mkdir(paths.tmp, { recursive: true })]);
  if (mode === "full" || mode === "both") await mkdir(paths.full, { recursive: true });
  if (mode === "first" || mode === "both") await mkdir(paths.audio, { recursive: true });
  return paths;
}

export async function removeTmpIfEmpty(directory) {
  try {
    if ((await readdir(directory)).length === 0) await rmdir(directory);
  } catch {
    // No impedir el cierre por una carpeta temporal no vacia o ya eliminada.
  }
}
