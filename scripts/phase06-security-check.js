// Limited static artifact check. Prints rule and path only, never matching secrets.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function scanPublicArtifacts(root) {
  const findings = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) { await walk(file); continue; }
      const relative = path.relative(root, file).replaceAll("\\", "/");
      if (/\.(pdf|mp3|wav|csv|enc|dpapi|pfx|p12)$/i.test(item.name) || /^\.env(?:\.|$)/i.test(item.name)) findings.push({ file: relative, rule: "PRIVATE_ARTIFACT" });
      if (!/\.(js|mjs|json|html|css|svg|txt)$/i.test(item.name)) continue;
      const contents = await readFile(file, "utf8");
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk_[A-Za-z0-9]{32,}/.test(contents)) findings.push({ file: relative, rule: "POSSIBLE_PRIVATE_KEY" });
    }
  }
  await walk(root); return findings;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const results = [];
  for (const directory of ["public", "dist"]) {
    const findings = await scanPublicArtifacts(directory);
    results.push({ check: directory, status: findings.length ? "FALLIDA" : "APROBADA", findings });
  }
  // Read variable NAMES only into the report. Values never appear in diagnostics.
  for (const entry of await readdir(".", { withFileTypes: true })) {
    if (!entry.isFile() || !/^\.env(?:\.|$)/.test(entry.name) || entry.name.endsWith("example")) continue;
    const raw = await readFile(entry.name, "utf8");
    const unsafe = [...raw.matchAll(/^\s*(VITE_[A-Z0-9_]+)\s*=/gm)].map(match => match[1]).filter(name => /KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL/.test(name));
    results.push({ check: "Variables públicas de Vite", file: entry.name, status: unsafe.length ? "FALLIDA" : "APROBADA", unsafeNames: unsafe });
  }
  console.log(JSON.stringify({ scope: "Patrones conocidos y artefactos públicos; no sustituye una auditoría de penetración", results }, null, 2));
  if (results.some(result => result.status === "FALLIDA")) process.exitCode = 1;
}
