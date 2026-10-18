// Local review manifest only. Does not modify public release manifests or publish.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStaging } from '../mediweb-downloader/scripts/packaging.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'mediweb-downloader/package.json')));
const staging = path.join(root, 'mediweb-downloader/build-windows/staging');
await validateStaging(staging);
const staged = JSON.parse(await readFile(path.join(staging, 'app/package.json')));
assert.equal(staged.version, pkg.version);
const host = path.join(staging, 'AudioEvaluacionesConnector.exe');
const signature = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p=[Console]::In.ReadToEnd(); [Console]::Out.Write((Get-AuthenticodeSignature -LiteralPath $p).Status.ToString())'], { input: host, encoding: 'utf8', windowsHide: true });
if (signature.status !== 0 || !/^[A-Za-z]+$/.test(signature.stdout.trim())) throw new Error('No se pudo comprobar la firma.');
const files = [];
async function collect(relative, sourceOnly = false) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const item = path.join(relative, entry.name);
    if (entry.isDirectory()) await collect(item, sourceOnly);
    else if (!sourceOnly || /\.(?:m?js)$/.test(entry.name)) { const bytes = await readFile(path.join(root, item)); files.push({ path: item.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
}
for (const directory of ['dist', 'mediweb-downloader/build-windows/staging']) await collect(directory);
for (const directory of ['api', 'server']) await collect(directory, true);
for (const entry of await readdir(path.join(root, 'tts-service/app'), { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.py')) continue;
  const relative = `tts-service/app/${entry.name}`, bytes = await readFile(path.join(root, relative));
  files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const setup = `AudioEvaluacionesConnector-${pkg.version}-Setup.exe`;
const setupExists = await access(path.join(root, 'mediweb-downloader/dist-windows', setup)).then(() => true, () => false);
const output = path.join(root, 'mediweb-downloader/dist-windows', `CANDIDATE-${pkg.version}.json`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ candidate: pkg.version, generated_at: new Date().toISOString(), status: 'PENDIENTE_ACEPTACION_NO_DISTRIBUIR',
  minimum_connector: pkg.version, tts_contract: 1, host_signature: signature.stdout.trim(), setup: { file: setup, exists: setupExists, acceptance: 'PENDIENTE' },
  blockers: ['ACEPTACION_HOME_EXPLORER_Y_CIFRADO_DISPOSITIVO_PENDIENTE', ...(!setupExists ? ['COMPILACION_SETUP_PENDIENTE'] : []), ...(signature.stdout.trim() !== 'Valid' ? ['FIRMA_VALIDADA_PENDIENTE'] : []), 'ACEPTACION_GATEWAY_PENDIENTE', 'ACEPTACION_REAL_Y_AUDITORIAS_PENDIENTES'],
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2) + '\n', { flag: 'wx' });
console.log(`Candidata local ${pkg.version}: ${files.length} archivos con SHA-256, firma ${signature.stdout.trim()}, Setup ${setupExists ? 'presente, aceptación pendiente' : 'no generado'}. No publicada.`);
