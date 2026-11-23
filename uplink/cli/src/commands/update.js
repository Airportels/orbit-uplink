// orbit update: update Uplink now (§9). The plugin comes from the marketplace named `orbit` (Airportels/orbit-uplink, or a device
// set up earlier from Airportels/orbit: both carry the same plugin at the same paths, §36.3); the CLI is reinstalled from the
// marketplace's checkout, as a copy (§35.2, from 0.13.0: installCli packs it and installs the .tgz, never a link), into the place the
// running `orbit` lives (V69): the person's own folder ($ORBIT_HOME/npm) when it runs from there, else Node's global folder.
// ORBIT_UPDATE_CMD replaces the whole thing (tests use a stub), and ORBIT_SETUP_NPM_CMD the pack and install pair alone. All the
// steps share one deadline, UPDATE_BUDGET_MS (60 s), under the 70 s the SessionStart hook gives an update (status.js
// HOOK_UPDATE_BUDGET_MS), so the hook never kills this in the middle of a step: the two `claude plugin` steps get at most 15 s each,
// the install gets what is left (at least 25 s) minus 5 s kept for `orbit --version`, and a step with no time left is skipped and
// says so.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readConfig } from '../store.js';
import { UPLINK_VERSION, CLI_ROOT } from '../version.js';

export const UPDATE_BUDGET_MS = Number(process.env.ORBIT_UPDATE_BUDGET_MS || 60_000);
export const PLUGIN_STEP_MS = 15_000;
export const VERSION_STEP_MS = 5_000;

/**
 * Each step's timeout from the time left: a `claude plugin` step ≤ 15 s, npm everything left but the 5 s kept for the
 * version check, the version check ≤ 5 s. ≤ 0 means skip. Pure (test/hardening.test.mjs).
 */
export function stepTimeout(step, remainingMs) {
  if (step === 'npm') return Math.max(0, remainingMs - VERSION_STEP_MS);
  if (step === 'version') return Math.max(0, Math.min(VERSION_STEP_MS, remainingMs));
  return Math.max(0, Math.min(PLUGIN_STEP_MS, remainingMs));
}

/**
 * The marketplace checkouts the plugin manager keeps (where `orbit update` and `orbit setup` find the clone), first the
 * CLAUDE_CONFIG_DIR profile's, then the default ~/.claude: `<dir>/plugins/marketplaces/<mp>`.
 */
export function cloneDirs(mp = 'orbit') {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return [...new Set([join(configDir, 'plugins', 'marketplaces', mp), join(homedir(), '.claude', 'plugins', 'marketplaces', mp)])];
}

/**
 * §35.2 step 2 (V69, M31 call 16): the person's own folder, `$ORBIT_HOME/npm` (by default ~/.orbit/npm). Setup installs the CLI there
 * when Node's global folder (`npm prefix -g`) can't be written without admin rights, and `orbit update` reinstalls it there when the
 * running `orbit` lives there. An absolute path (ORBIT_HOME resolved), never npm's own config.
 */
export function ownPrefix(env = process.env) {
  return resolve(env.ORBIT_HOME || join(homedir(), '.orbit'), 'npm'); // ORBIT_HOME as store.js orbitHome() reads it
}

/** Is `p` inside folder `dir` (both by their real paths)? False when either doesn't exist. */
export function insideDir(dir, p) {
  let d, q;
  try { d = realpathSync(dir); q = realpathSync(p); } catch { return false; }
  const rel = relative(d, q);
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** V69: does the running CLI (`cliRoot`, this copy's folder) live in the person's own folder? Then `orbit update` installs there. */
export function runsFromOwnFolder(cliRoot = CLI_ROOT) {
  return insideDir(ownPrefix(), cliRoot);
}

/**
 * §35.2 step 2 (M31 call 6; M32 call 15; V69): install the CLI at `dir` (an uplink/cli folder) AS A COPY, never a link: `npm pack
 * --ignore-scripts` it into a temporary folder (no package script runs while packing), then `npm install -g --no-audit --no-fund
 * [--prefix <prefix>] <the .tgz>`, so its dependencies land under that prefix (Node's global folder, or with `prefix` the person's
 * own folder) and a later `orbit watch` can load firebase. Never `sudo`, never `npm config set`. Both steps share `timeoutMs`.
 * ORBIT_SETUP_NPM_CMD replaces the pair (tests: a stub that records its call; it is run by the shell with ORBIT_SETUP_CLI_DIR set to
 * `dir`, and ORBIT_SETUP_PREFIX to `prefix` when one is given). → { ok, out, status, timedOut }.
 */
export function installCli(dir, timeoutMs, { prefix } = {}) {
  const deadline = Date.now() + timeoutMs;
  const left = () => deadline - Date.now();
  if (process.env.ORBIT_SETUP_NPM_CMD) {
    const env = { ...process.env, ORBIT_SETUP_CLI_DIR: dir };
    if (prefix) env.ORBIT_SETUP_PREFIX = prefix; else delete env.ORBIT_SETUP_PREFIX;
    const r = spawnSync(process.env.ORBIT_SETUP_NPM_CMD, { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env });
    const timedOut = r.error?.code === 'ETIMEDOUT';
    return { ok: r.status === 0 && !timedOut, out: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : ((r.stdout ?? '') + (r.stderr ?? '')).trim(), status: r.status, timedOut };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'orbit-pack-'));
  try {
    const pack = sh('npm', ['pack', dir, '--ignore-scripts', '--pack-destination', tmp, '--silent'], left());
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    if (!pack.ok || !tgz) return { ok: false, out: `npm pack failed: ${pack.out.split('\n').pop() || 'no .tgz'}`, status: pack.status, timedOut: /timed out/.test(pack.out) };
    const inst = sh('npm', ['install', '-g', '--no-audit', '--no-fund', ...(prefix ? ['--prefix', prefix] : []), join(tmp, tgz)], left());
    return { ok: inst.ok, out: inst.out, status: inst.status, timedOut: /timed out/.test(inst.out) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function sh(cmd, args, timeoutMs) {
  if (timeoutMs < 1000) return { ok: false, skipped: true, out: 'skipped: no time left in the update budget', status: null, error: { code: 'skipped' } };
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { ok: r.status === 0 && !timedOut, out: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : ((r.stdout ?? '') + (r.stderr ?? '')).trim(), status: r.status, error: r.error };
}

export async function run() {
  if (process.env.ORBIT_UPDATE_CMD) {
    const r = spawnSync(process.env.ORBIT_UPDATE_CMD, { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: UPDATE_BUDGET_MS });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    return r.status ?? 1;
  }
  const cfg = readConfig();
  const mp = cfg.marketplace || 'orbit';
  const plugin = `orbit@${mp}`;
  const steps = [];
  const deadline = Date.now() + UPDATE_BUDGET_MS;
  const left = () => deadline - Date.now();
  const mu = sh('claude', ['plugin', 'marketplace', 'update', mp], stepTimeout('plugin', left()));
  steps.push(`marketplace ${mp}: ${mu.ok ? 'updated' : `failed (${mu.error?.code ?? mu.out.split('\n').pop()})`}`);
  const pu = sh('claude', ['plugin', 'update', plugin], stepTimeout('plugin', left()));
  steps.push(`plugin ${plugin}: ${pu.ok ? 'updated (restart the session to load it)' : `failed (${pu.error?.code ?? pu.out.split('\n').pop()})`}`);
  const cliDir = cloneDirs(mp).map((d) => join(d, 'uplink', 'cli')).find((p) => existsSync(join(p, 'package.json')));
  // V69: where the running orbit lives: the person's own folder when it runs from there, else Node's global folder (no --prefix)
  const prefix = runsFromOwnFolder() ? ownPrefix() : undefined;
  if (cliDir) {
    const budget = stepTimeout('npm', left());
    const ni = budget < 1000 ? { ok: false, out: 'skipped: no time left in the update budget' } : installCli(cliDir, budget, { prefix }); // a copy, from 0.13.0 (§35.2)
    steps.push(`cli from ${cliDir}: ${ni.ok ? `installed (a copy)${prefix ? ` in ${prefix}` : ''}` : `failed (${ni.out.split('\n').pop()})`}`);
  } else {
    steps.push(`cli: marketplace checkout not found under ${cloneDirs(mp)[0]}; reinstall with: orbit setup (or /orbit:orbit-setup in Claude Code)`);
  }
  // the person's own folder may not be on this process's PATH (the hook finds it by its full path): ask that copy by its full path
  const vr = sh(prefix ? join(prefix, 'bin', 'orbit') : 'orbit', ['--version'], stepTimeout('version', left()));
  steps.push(`orbit --version now: ${vr.ok ? vr.out : `(was ${UPLINK_VERSION})`}`);
  console.log(steps.join('\n'));
  return mu.ok && pu.ok ? 0 : 1;
}
