// /orbit:orbit-setup's launcher (CONTRACT §37 W17; §38 X6, v0.13.2): `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup <args>`.
// It never runs PATH's `orbit` (that may be an older CLI with no `setup`). It reads this plugin's version from its own
// .claude-plugin/plugin.json (relative to this file, never the environment), then uses, in order:
//   1. a CLI of that version through ../hooks/find-cli.mjs: W15 step 3 (the sibling ../cli), step 4 (the marketplace clone; for a
//      synced plugin only a clone at the plugin's version), or X7's step 5 (the source copy at the plugin's version, taken when
//      fetch-cli.mjs's checkCopy says it is one);
//   2. otherwise it fetches the source copy (X2, 120 s) and runs that copy's uplink/cli/bin/orbit.js.
// Either way it runs it with this Node (process.execPath), inherited stdio, this Node's folder first on PATH (§39 N9) and its
// arguments as they are, and exits with the child's
// exit code. The fetch's progress line goes to stderr only, so `setup --json` still prints one JSON object on stdout (§35.2). A failed
// fetch prints why (the URL, the tag, and "check the network and run /orbit:orbit-setup again" where that is the cause) and the paths
// it tried to stderr, prints nothing on stdout, and exits 1. After a setup that exits 0, it prunes the source copies (X4: the two
// newest and the one in use stay; never changes the exit code). The plugin root comes from this file (W15a), never CLAUDE_PLUGIN_ROOT.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findClone, pluginVersion } from '../hooks/find-cli.mjs';
import { FETCH_TIMEOUT_MS, checkCopy, copyDir, ensureCopy, nodeFirstEnv, progressLine, pruneCopies } from './fetch-cli.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const version = pluginVersion({ root });
const found = findClone({ root });
// step 5's copy is taken only when it is one (X3); anything else at that path is ensureCopy's to reuse, replace or refuse
let js = found.js && (found.step !== 5 || checkCopy(copyDir(version), version)) ? found.js : null;
if (!js) {
  if (!version) {
    process.stderr.write(`orbit-setup: this plugin's version couldn't be read from its .claude-plugin/plugin.json (${root}), so Orbit's CLI can't be fetched. Tried:\n${found.tried.map((p) => `  ${p}\n`).join('')}Remove the Orbit plugin (in the Claude app: Customize → Plugins), add it again and run /orbit:orbit-setup again.\n`);
    process.exit(1);
  }
  if (!checkCopy(copyDir(version), version)) process.stderr.write(`${progressLine(version)}\n`);
  const r = ensureCopy(version, { timeoutMs: FETCH_TIMEOUT_MS });
  if (!r.ok) {
    process.stderr.write(`orbit-setup: ${r.message}\nNo Orbit CLI of version ${version} was found here either. Tried:\n${found.tried.map((p) => `  ${p}\n`).join('')}`);
    process.exit(1);
  }
  js = r.js;
}
// §39 N9 (amends W17): this Node's folder first on the child's PATH, so setup's node and npm are the ones just installed
const child = spawn(process.execPath, [js, ...args], { stdio: 'inherit', env: nodeFirstEnv() });
// The person's Ctrl-C reaches the child too (same console): this launcher waits for it and exits as it does. Any other stop is
// passed on to the child.
process.on('SIGINT', () => {});
for (const s of ['SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(s, () => { try { child.kill(s); } catch { /* gone already */ } }); } catch { /* not on this platform */ }
}
child.on('error', (e) => {
  process.stderr.write(`orbit-setup: couldn't start ${js}: ${e.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  // X4: after a successful setup, keep the two newest copies and the one in use; pruning never changes the exit code
  if (code === 0 && args[0] === 'setup' && version) { try { pruneCopies(version); } catch { /* never fails setup */ } }
  process.exit(code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1));
});
