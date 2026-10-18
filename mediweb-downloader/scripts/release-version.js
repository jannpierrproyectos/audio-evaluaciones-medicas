import semver from 'semver';

export function windowsVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed || [parsed.major, parsed.minor, parsed.patch].some(value => value > 65534)) throw new Error('Versión no válida para Windows.');
  return `${parsed.major}.${parsed.minor}.${parsed.patch}.0`;
}
