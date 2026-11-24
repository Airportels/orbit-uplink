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
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readConfig } from '../store.js';
import { UPLINK_VERSION, CLI_ROOT } from '../version.js';
import { ctx as platformCtx, runNpm, runClaude, runOrbit, layout, splitLines } from '../platform.js';

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
 * `dir`, and ORBIT_SETUP_PREFIX to `prefix` when one is given; W6e: it keeps `shell: true`, and no win32 run uses it).
 * → { ok, out, status, timedOut }. npm runs through platform.js runNpm (W6a: on win32 node + npm-cli.js, no shell); `o` is
 * platform.js's context (a test's fake platform, runner and fs) plus `readdir`.
 */
export function installCli(dir, timeoutMs, { prefix } = {}, o = {}) {
  const c = platformCtx(o);
  const readdir = o.readdir ?? readdirSync;
  const deadline = Date.now() + timeoutMs;
  const left = () => deadline - Date.now();
  if (process.env.ORBIT_SETUP_NPM_CMD) {
    const env = { ...process.env, ORBIT_SETUP_CLI_DIR: dir };
    if (prefix) env.ORBIT_SETUP_PREFIX = prefix; else delete env.ORBIT_SETUP_PREFIX;
    const r = spawnSync(process.env.ORBIT_SETUP_NPM_CMD, { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env });
    const timedOut = r.error?.code === 'ETIMEDOUT';
    return { ok: r.status === 0 && !timedOut, out: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : ((r.stdout ?? '') + (r.stderr ?? '')).trim(), status: r.status, timedOut };
  }
  const tmp = c.mkdtemp(c.path.join(tmpdir(), 'orbit-pack-'));
  try {
    const pack = npm(['pack', dir, '--ignore-scripts', '--pack-destination', tmp, '--silent'], left(), c);
    const tgz = readdir(tmp).find((f) => f.endsWith('.tgz'));
    if (!pack.ok || !tgz) return { ok: false, out: `npm pack failed: ${splitLines(pack.out).pop() || 'no .tgz'}`, status: pack.status, timedOut: /timed out/.test(pack.out) };
    const inst = npm(['install', '-g', '--no-audit', '--no-fund', ...(prefix ? ['--prefix', prefix] : []), c.path.join(tmp, tgz)], left(), c);
    return { ok: inst.ok, out: inst.out, status: inst.status, timedOut: /timed out/.test(inst.out) };
  } finally {
    c.rm(tmp, { recursive: true, force: true });
  }
}

/** W6a: npm with `args` and a timeout, through runNpm. → { ok, out, status, error }. */
function npm(args, timeoutMs, c) {
  if (timeoutMs < 1000) return { ok: false, skipped: true, out: 'skipped: no time left in the update budget', status: null, error: { code: 'skipped' } };
  const r = runNpm(args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs }, c);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const out = r.error?.code === 'no_npm' ? 'npm not found' : timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : ((r.stdout ?? '') + (r.stderr ?? '')).trim();
  return { ok: r.status === 0 && !timedOut, out, status: r.status, error: r.error };
}

function sh(cmd, args, timeoutMs) {
  if (timeoutMs < 1000) return { ok: false, skipped: true, out: 'skipped: no time left in the update budget', status: null, error: { code: 'skipped' } };
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { ok: r.status === 0 && !timedOut, out: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : ((r.stdout ?? '') + (r.stderr ?? '')).trim(), status: r.status, error: r.error };
}

/** W6c: claude with `args` and a timeout, through runClaude (win32: the .exe by its path, a .cmd through cmd.exe). → as sh(). */
function claude(args, timeoutMs, c) {
  if (timeoutMs < 1000) return { ok: false, skipped: true, out: 'skipped: no time left in the update budget', status: null, error: { code: 'skipped' } };
  const r = runClaude(args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs }, c);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  const out = r.error?.message && !timedOut ? r.error.message : timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : ((r.stdout ?? '') + (r.stderr ?? '')).trim();
  // "claude not found on PATH" (W6c) is the step's words, not a code
  return { ok: r.status === 0 && !timedOut, out, status: r.status, error: r.error?.code === 'no_claude' || r.error?.code === 'bad_arg' ? undefined : r.error };
}

/** A step's failure, as the last line of its output (W7), or its error code. */
const why = (r) => r.error?.code ?? splitLines(r.out).pop();

/**
 * `orbit update`. POSIX as 0.13.0. §37 W24, on win32: claude through runClaude (W6c; the marketplace name from config.json); npm
 * through runNpm (W6a, installCli); W10's folder, npm's global prefix (never --prefix, no own folder), asked once with `npm prefix
 * -g` before the install step, from the same budget; the version step runs that folder's orbit.js with Node (W6b), and says so when
 * the prefix couldn't be told. `o` is platform.js's context (a test's platform, runner and fs).
 */
export async function run(argv = [], o = {}) {
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
  const c = platformCtx(o);
  const mu = c.win ? claude(['plugin', 'marketplace', 'update', mp], stepTimeout('plugin', left()), c) : sh('claude', ['plugin', 'marketplace', 'update', mp], stepTimeout('plugin', left()));
  steps.push(`marketplace ${mp}: ${mu.ok ? 'updated' : `failed (${why(mu)})`}`);
  const pu = c.win ? claude(['plugin', 'update', plugin], stepTimeout('plugin', left()), c) : sh('claude', ['plugin', 'update', plugin], stepTimeout('plugin', left()));
  steps.push(`plugin ${plugin}: ${pu.ok ? 'updated (restart the session to load it)' : `failed (${why(pu)})`}`);
  const cliDir = cloneDirs(mp).map((d) => join(d, 'uplink', 'cli')).find((p) => existsSync(join(p, 'package.json')));
  // V69: where the running orbit lives: the person's own folder when it runs from there, else Node's global folder (no --prefix).
  // W10, W24: on win32 always npm's global folder, never --prefix; `npm prefix -g` says where it is, once, before the install.
  const prefix = !c.win && runsFromOwnFolder() ? ownPrefix() : undefined;
  let globalPrefix = null;
  let prefixFailed = null;
  if (c.win) {
    const t = stepTimeout('plugin', left()); // at most 15 s, from the same budget
    const pre = t < 1000 ? { status: null, error: { code: 'skipped' } } : runNpm(['prefix', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t }, c);
    globalPrefix = pre.status === 0 ? splitLines((pre.stdout ?? '').trim()).filter(Boolean).pop() ?? null : null;
    if (!globalPrefix) {
      const code = pre.error?.code;
      prefixFailed = code === 'no_npm' ? 'npm not found' : code === 'ETIMEDOUT' ? `timed out after ${Math.round(t / 1000)} s` : code === 'skipped' ? 'skipped: no time left in the update budget'
        : splitLines((pre.stderr ?? '').trim()).filter(Boolean).pop() || `exit ${pre.status ?? code}`;
    }
  }
  if (cliDir) {
    const budget = stepTimeout('npm', left());
    const ni = budget < 1000 ? { ok: false, out: 'skipped: no time left in the update budget' } : installCli(cliDir, budget, { prefix }, o); // a copy, from 0.13.0 (§35.2)
    const where = prefix ?? globalPrefix;
    steps.push(`cli from ${cliDir}: ${ni.ok ? `installed (a copy)${where ? ` in ${where}` : ''}` : `failed (${splitLines(ni.out).pop()})`}`);
  } else {
    steps.push(`cli: marketplace checkout not found under ${cloneDirs(mp)[0]}; reinstall with: orbit setup (or /orbit:orbit-setup in Claude Code)`);
  }
  if (c.win) { // W6b: that folder's orbit.js, with Node, never through its shim
    if (!globalPrefix) steps.push(`orbit --version now: unknown, npm prefix -g failed (${prefixFailed}) (was ${UPLINK_VERSION})`);
    else {
      const vt = stepTimeout('version', left());
      const vr = vt < 1000 ? { status: null } : runOrbit(layout(globalPrefix, c).orbitJs, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: vt }, c);
      const v = vr.status === 0 ? splitLines((vr.stdout ?? '').trim())[0] : '';
      steps.push(`orbit --version now: ${v || `(was ${UPLINK_VERSION})`}`);
    }
  } else {
    // the person's own folder may not be on this process's PATH (the hook finds it by its full path): ask that copy by its full path
    const vr = sh(prefix ? join(prefix, 'bin', 'orbit') : 'orbit', ['--version'], stepTimeout('version', left()));
    steps.push(`orbit --version now: ${vr.ok ? vr.out : `(was ${UPLINK_VERSION})`}`);
  }
  console.log(steps.join('\n'));
  return mu.ok && pu.ok ? 0 : 1;
}
