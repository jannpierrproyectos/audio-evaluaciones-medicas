import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "scripts"];
const files = [];
for (const root of roots) await collectJavaScript(root, files);

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`node --check: ${files.length} archivos correctos.`);

async function collectJavaScript(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectJavaScript(entryPath, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(entryPath);
  }
}
