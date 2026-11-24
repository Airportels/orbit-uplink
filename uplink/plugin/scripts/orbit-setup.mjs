// /orbit:orbit-setup's launcher (CONTRACT §37, v0.13.1, W17): `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup <args>`.
// It runs the marketplace clone's orbit.js, never PATH's `orbit` (that may be an older CLI with no `setup`): W15 steps 3 then 4
// through ../hooks/find-cli.mjs, from this plugin's own root (never the CLAUDE_PLUGIN_ROOT variable, which a terminal doesn't have).
// It runs it with this Node (process.execPath) and inherited stdio, passes its arguments through as they are, and exits with the
// child's exit code. When it finds nothing, it names the paths it tried and exits 1.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findClone } from '../hooks/find-cli.mjs';

const found = findClone({ root: fileURLToPath(new URL('..', import.meta.url)) });
if (!found.js) {
  process.stderr.write(`orbit-setup: the Orbit CLI's checkout (uplink/cli/bin/orbit.js) was not found. Tried:\n${found.tried.map((p) => `  ${p}\n`).join('')}Reinstall the plugin (/plugin marketplace add Airportels/orbit-uplink, then /plugin install orbit@orbit) and run /orbit:orbit-setup again.\n`);
  process.exit(1);
}
const child = spawn(process.execPath, [found.js, ...process.argv.slice(2)], { stdio: 'inherit' });
// The person's Ctrl-C reaches the child too (same console): this launcher waits for it and exits as it does. Any other stop is
// passed on to the child.
process.on('SIGINT', () => {});
for (const s of ['SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(s, () => { try { child.kill(s); } catch { /* gone already */ } }); } catch { /* not on this platform */ }
}
child.on('error', (e) => {
  process.stderr.write(`orbit-setup: couldn't start ${found.js}: ${e.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1)));
