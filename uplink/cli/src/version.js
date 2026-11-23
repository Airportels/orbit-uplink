// The Uplink version is the CLI package version; the plugin's plugin.json carries the same number.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const UPLINK_VERSION = pkg.version;
export const CONTRACT_VERSION = pkg.orbit?.contractVersion ?? '0.1.3';
export const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** semver compare for "x.y.z[-pre]": -1, 0, 1. Pre-release ranks below its release. */
export function compareVersions(a, b) {
  const pa = String(a).split('-'), pb = String(b).split('-');
  const na = pa[0].split('.').map((n) => parseInt(n, 10) || 0);
  const nb = pb[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) < (nb[i] ?? 0) ? -1 : 1;
  }
  if (pa[1] && !pb[1]) return -1;
  if (!pa[1] && pb[1]) return 1;
  return 0;
}
