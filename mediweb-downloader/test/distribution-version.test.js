import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { windowsVersion } from '../scripts/release-version.js';

test('Candidato: prerelease conserva SemVer y genera recurso numérico Windows válido', async () => {
  assert.equal(windowsVersion('0.6.0-rc.1'), '0.6.0.0');
  assert.throws(() => windowsVersion('0.6.0";injection'));
  assert.throws(() => windowsVersion('70000.1.0'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.version, '0.6.0-rc.2'); assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
});
