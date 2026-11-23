// orbit setup [--station <s>] [--account <label>] [--config <file>] [--json]   (CONTRACT §35.2, v0.13.0, M31; the owner's go V65)
// Brings this device to a working ground seat, in six steps, each `done`, `already` or `failed` (the steps after a failure are
// `skipped`): check (Node 22+, git, npm), cli (the CLI installed as a copy, never a link), config (~/.orbit/config.json), signin (kept
// only when it really works), seat (kept only when it really works), status (orbit status' check). Steps 3 to 6 run in this process,
// with the CLI's own modules: nothing after step 2 runs `orbit` through PATH. Running it again is safe, and it is the repair path: a
// half-done sign-in, missing station ids, a missing config or a broken install are put right; a dead or foreign seat is named, never
// replaced (the fix is the deliberate `orbit seat add --ground --force`, which setup never runs).
// Output: one line per step, then the status block and "Start a new Claude Code session to load Orbit."; with --json, stdout carries
// exactly one JSON object, { steps: [{ step, result, note }], seatId, handle, stationId, failed?: { step, code, fix }, status? }, on
// exit 0 and on exit 1, and the sign-in URL and progress go to stderr. It never prints a seat key, a token or an email address.
// Exit: 0 when every step is done or already; 1 when a step fails; 2 for bad usage.
// Step 2 (V69, M31 call 16): when Node's global folder can't be written without admin rights, the CLI goes in the person's own folder,
// $ORBIT_HOME/npm (by default ~/.orbit/npm), and one PATH line goes in the shell's startup file (~/.zshenv; for bash, ~/.bashrc and
// the login file bash reads), named in the step's note. Never `sudo`, never `npm config set`. In Node's global folder, another
// `orbit` that PATH finds first fails `shadowed`, and the next run doesn't install again (M31 call 17).
// Tests only (left out of the help): --emulator-user <local-part | address> signs in with the Auth emulator, and ORBIT_SETUP_NPM_CMD
// replaces the npm pack and npm install pair (update.js installCli): no test ever runs the real global install.
import { spawnSync } from 'node:child_process';
import { accessSync, appendFileSync, chmodSync, constants, copyFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { ensureHome, orbitHome, paths, readConfig, readPerson, readPersonRaw, readSeat, restorePersonRaw, writePerson } from '../store.js';
import { getIdToken, UNREACHABLE_WORDS } from '../auth.js';
import { personClient, mcCall } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { UPLINK_VERSION, CLI_ROOT, compareVersions } from '../version.js';
import { installCli, cloneDirs, ownPrefix, insideDir } from './update.js';
import { signInAndRegister, refusalWords } from './login.js';
import { enrolWithToken } from './seat.js';
import { collectStatus, formatBlock } from './status.js';

export const STEPS = Object.freeze(['check', 'cli', 'config', 'signin', 'seat', 'status']);
const USAGE = 'orbit setup [--station <s>] [--account <label>] [--config <file>] [--json]';
const OPTIONS = ['station', 'account', 'config', 'json', 'emulator-user'];
/** §35.2 step 2: the install's own budget (not update.js' 60 seconds). */
export const CLI_STEP_MS = 180_000;
export const LAST_LINE = 'Start a new Claude Code session to load Orbit.';
/** §35.2 step 4: not_invited's words in setup (34.3's others are login's). */
export const SETUP_NOT_INVITED = 'Orbit is invite only: ask an admin to invite your Google account, then run /orbit:orbit-setup (or orbit setup) again';
/** V69: the PATH line's comment, the mark of the one line setup adds to a shell's startup file. */
export const PATH_LINE_MARK = '# added by orbit setup';
const SEAT_FIX = 'orbit seat add --ground --force';
/** What a config must carry (§35.2 step 3; §36.1's web config): mcUrl and the four firebase fields. */
export const CONFIG_FIELDS = Object.freeze(['mcUrl', 'firebase.apiKey', 'firebase.authDomain', 'firebase.projectId', 'firebase.databaseURL']);

/** A step that failed: its code (for --json's failed) and the fix the person reads. */
class StepFailed extends Error {
  constructor(code, fix) { super(fix); this.code = code; this.fix = fix; }
}
const fail = (code, fix) => { throw new StepFailed(code, fix); };

/** An executable named `cmd` on PATH (no shell), or null. */
export function which(cmd, pathVar = process.env.PATH ?? '') {
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try { if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return p; } } catch { /* not here */ }
  }
  return null;
}

/** The first missing field of 35.2 step 3's config (a dotted name), or null when it has them all. */
export function missingField(cfg) {
  for (const f of CONFIG_FIELDS) {
    const v = f.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), cfg);
    if (typeof v !== 'string' || !v.trim()) return f;
  }
  return null;
}

/** Can npm write under `prefix`? It, or the nearest folder above it that exists, must be a writable directory. */
export function writableDir(prefix) {
  let p = prefix;
  for (;;) {
    if (existsSync(p)) {
      try { if (!statSync(p).isDirectory()) return false; accessSync(p, constants.W_OK); } catch { return false; }
      for (const sub of ['lib', join('lib', 'node_modules'), 'bin']) { // a folder npm writes into, when it is already there
        const d = join(p, sub);
        if (p === prefix && existsSync(d)) { try { accessSync(d, constants.W_OK); } catch { return false; } }
      }
      return true;
    }
    const up = dirname(p);
    if (up === p) return false;
    p = up;
  }
}

/** `orbit --version --check-deps` of the orbit at `bin`: { version, ok, out }. */
function probe(bin) {
  const r = spawnSync(bin, ['--version', '--check-deps'], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const version = (r.stdout ?? '').trim().split('\n')[0] ?? '';
  const out = `${(r.stdout ?? '').trim()} ${(r.stderr ?? '').trim()}`.trim().replace(/\s+/g, ' ').slice(0, 300);
  return { version, ok: r.status === 0 && /^\d+\.\d+\.\d+/.test(version), out: out || `exit ${r.status ?? r.error?.code}` };
}

// ── the six steps: each → { result: 'done' | 'already', note }, or throws StepFailed ──

/** §35.2 step 1's words (V67, §35.8), exactly: the nodejs.org installer first (no Terminal needed), Homebrew second. */
export const NODE_WORDS = 'Install Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it (or, if you use Homebrew, `brew install node`). Then start a new Claude Code session and run /orbit:orbit-setup again.';
export const GIT_WORDS = 'Install git: run `xcode-select --install` in Terminal, or type `git` there and macOS offers to install it. Then run /orbit:orbit-setup again.';

function check() {
  const node = process.versions.node;
  if (Number(node.split('.')[0]) < 22) fail('node_too_old', NODE_WORDS); // Node, or npm which comes with it: the same words
  if (!which('git')) fail('no_git', GIT_WORDS);
  if (!which('npm')) fail('no_npm', NODE_WORDS);
  const claude = which('claude');
  return { result: 'done', note: `Node ${node}, git and npm${claude ? ', and claude' : '; claude is not on PATH (orbit update needs it later)'}` };
}

/** Is `p` the same file as `q` (by their real paths)? */
function sameFile(p, q) {
  try { return realpathSync(p) === realpathSync(q); } catch { return false; }
}
const isExecutable = (p) => { try { if (!statSync(p).isFile()) return false; accessSync(p, constants.X_OK); return true; } catch { return false; } };

/**
 * V69: the one line that puts the person's own folder's bin on PATH. With ORBIT_HOME unset it says `$HOME/.orbit/npm/bin`, for the
 * shell to expand; with ORBIT_HOME set, that folder's absolute path written out (the shell that reads the line may not have
 * ORBIT_HOME), inside the double quotes with `\`, `"`, `$` and `` ` `` escaped.
 */
export function pathLine(env = process.env) {
  const bin = env.ORBIT_HOME ? join(ownPrefix(env), 'bin').replace(/[\\"$`]/g, '\\$&') : '$HOME/.orbit/npm/bin';
  return `export PATH="${bin}:$PATH"  ${PATH_LINE_MARK}`;
}

/** M31 call 17: login bash reads the first of these that exists, and only that one. */
export const BASH_LOGIN_FILES = Object.freeze(['.bash_profile', '.bash_login', '.profile']);

/**
 * V69: the shell's startup files the line goes in, by $SHELL (else the account's login shell): zsh's ~/.zshenv; for bash (M31 call
 * 17), the login file bash actually reads (the first of BASH_LOGIN_FILES in `home` that exists, else ~/.bash_profile, which appending
 * creates) and ~/.bashrc. Creating ~/.bash_profile beside an existing ~/.profile would stop login bash reading ~/.profile.
 */
export function shellFiles(env = process.env, home = homedir()) {
  let shell = env.SHELL;
  if (!shell) { try { shell = userInfo().shell; } catch { shell = ''; } }
  const name = basename(shell || '');
  const login = () => BASH_LOGIN_FILES.find((f) => existsSync(join(home, f))) ?? BASH_LOGIN_FILES[0];
  const files = name === 'zsh' ? ['.zshenv'] : name === 'bash' ? [login(), '.bashrc'] : [];
  return { shell: name, files: files.map((f) => join(home, f)) };
}

/**
 * V69: make the person's own folder reachable: add pathLine() to each of the shell's startup files that has no line equal to it
 * (whitespace at either end ignored), so running setup again adds nothing. → { added, note }: `added` when a file changed; the note
 * names the file(s). For another shell, or a file that can't be written, no file changes and the note gives the line to add.
 */
function ensurePathLine() {
  const line = pathLine();
  const { shell, files } = shellFiles();
  const tilde = (f) => `~/${basename(f)}`;
  if (!files.length) return { added: false, note: `your shell (${shell || 'unknown'}) isn't zsh or bash, so no file was changed: add this line to its startup file: ${line}` };
  const added = [], had = [], failed = [];
  for (const f of files) {
    let text = '';
    try {
      if (existsSync(f)) text = readFileSync(f, 'utf8');
      if (text.split('\n').some((l) => l.trim() === line)) { had.push(f); continue; }
      appendFileSync(f, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
      added.push(f);
    } catch (e) {
      failed.push(`${tilde(f)} (${e.code ?? e.message})`);
    }
  }
  const parts = [];
  if (added.length) parts.push(`added its PATH line to ${added.map(tilde).join(' and ')}`);
  if (had.length) parts.push(`its PATH line is in ${had.map(tilde).join(' and ')}`);
  if (failed.length) parts.push(`couldn't write ${failed.join(' or ')}: add this line to it yourself: ${line}`);
  return { added: added.length > 0, note: parts.join('; ') };
}

/** M31 call 17: the fix when PATH's `orbit` (`path`) isn't the copy in Node's global folder (`bin`): name it, and how to remove it. */
export function shadowedFix(path, bin) {
  const q = `'${path.replace(/'/g, "'\\''")}'`;
  return `another orbit comes first on your PATH: ${path}, ahead of the copy setup installed (${bin}). Remove it in Terminal with rm ${q} (sudo rm ${q} when its folder needs admin rights, as /usr/local/bin can), then run setup again`;
}

/**
 * Node's global folder only (§35.2 step 2): PATH must find `orbit` (else not_on_path), and it must be `bin`, the copy in that folder,
 * by real path (else `shadowed`, M31 call 17).
 */
function globalOnPath(bin, prefix) {
  const onPath = which('orbit');
  if (!onPath) fail('not_on_path', `add ${join(prefix, 'bin')} to your PATH`);
  if (!sameFile(onPath, bin)) fail('shadowed', shadowedFix(onPath, bin));
}

/**
 * Step 2 (§35.2, V69, M31 call 17). "Already", in this order: PATH's `orbit`; the copy in the person's own folder; the copy in Node's
 * global folder by its full path, `<npm prefix -g>/bin/orbit`: the first at this version, or newer, that passes --check-deps. A newer
 * one is kept. Otherwise it installs: into Node's global folder when `npm prefix -g` (and its lib, lib/node_modules and bin) can be
 * written, else into the person's own folder with --prefix, then checks the installed copy by its full path. The person's folder
 * gets the PATH line (ensurePathLine). Node's global folder must be what PATH finds (globalOnPath): a copy there that PATH doesn't
 * find, or finds behind another orbit, fails not_on_path or `shadowed` on every run until that's fixed, and is never installed again.
 */
function cli() {
  const own = ownPrefix();
  const ownBin = join(own, 'bin', 'orbit');
  const found = which('orbit');
  let prefix; // `npm prefix -g`, asked once, when needed
  const globalPrefix = () => {
    if (prefix !== undefined) return prefix;
    const pre = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
    prefix = (pre.stdout ?? '').trim().split('\n').pop();
    if (pre.status !== 0 || !prefix) fail('npm_failed', `npm prefix -g didn't answer (${(pre.stderr ?? '').trim().split('\n').pop() || `exit ${pre.status}`}): check npm, then run setup again`);
    return prefix;
  };
  const seen = (p) => [found, ownBin].some((x) => x && (x === p || sameFile(x, p))); // the same file as an earlier candidate
  const candidates = [
    () => found && { bin: found, where: insideDir(own, found) ? 'own' : 'path' },
    () => isExecutable(ownBin) && !(found && sameFile(found, ownBin)) && { bin: ownBin, where: 'own' },
    () => { const g = join(globalPrefix(), 'bin', 'orbit'); return isExecutable(g) && !seen(g) && { bin: g, where: 'global' }; },
  ];
  for (const next of candidates) {
    const c = next();
    if (!c) continue;
    const p = probe(c.bin);
    const cmp = p.ok ? compareVersions(p.version, UPLINK_VERSION) : -1;
    if (cmp < 0) continue;
    if (c.where === 'global') globalOnPath(c.bin, prefix); // PATH doesn't find it, or finds another orbit first: it fails, nothing installed
    const where = c.where === 'own' ? `in ${own}` : 'on PATH';
    const note = cmp > 0 ? `orbit ${p.version} ${where} is newer than this copy (${UPLINK_VERSION}): kept` : `orbit ${p.version} ${where} works`;
    if (c.where === 'path') return { result: 'already', note };
    const line = ensurePathLine();
    return { result: line.added ? 'done' : 'already', note: `${note}; ${line.note}` };
  }
  globalPrefix();
  const toGlobal = writableDir(prefix);
  if (!toGlobal) ensureHome(); // ~/.orbit at 0700 before npm makes ~/.orbit/npm in it
  const target = toGlobal ? prefix : own;
  const r = installCli(realpathSync(CLI_ROOT), CLI_STEP_MS, toGlobal ? {} : { prefix: own });
  if (!r.ok) fail('install_failed', `installing the CLI failed (${r.out.split('\n').filter(Boolean).pop() ?? `exit ${r.status}`}): run setup again`);
  const bin = join(target, 'bin', 'orbit');
  const p = probe(bin);
  if (!p.ok || p.version !== UPLINK_VERSION) fail('bad_install', `the installed orbit (${bin}) isn't this copy (${UPLINK_VERSION}) or can't load its dependencies: ${p.out}`);
  if (toGlobal) {
    globalOnPath(bin, prefix);
    return { result: 'done', note: `installed orbit ${UPLINK_VERSION} under ${prefix} (a copy)` };
  }
  return { result: 'done', note: `installed orbit ${UPLINK_VERSION} in ${own} (a copy: Node's global folder ${prefix} needs admin rights); ${ensurePathLine().note}` };
}

function config(args) {
  const home = ensureHome();
  chmodSync(home, 0o700);
  const target = paths.config();
  if (existsSync(target)) {
    let cfg;
    try { cfg = JSON.parse(readFileSync(target, 'utf8')); } catch { fail('bad_config', `${target} isn't valid JSON: remove ~/.orbit/config.json and rerun setup`); }
    const missing = missingField(cfg);
    if (missing) fail('config_incomplete', `remove ~/.orbit/config.json and rerun setup, or add ${missing}`);
    chmodSync(target, 0o600);
    return { result: 'already', note: `kept ${target}` };
  }
  const given = typeof args.config === 'string' ? args.config : null;
  let here = null;
  try { here = join(realpathSync(CLI_ROOT), '..', '..', 'setup', 'orbit-config.json'); } catch { /* no real path */ }
  const sources = [given, ...cloneDirs().map((d) => join(d, 'setup', 'orbit-config.json')), here].filter(Boolean);
  if (given && !existsSync(given)) fail('no_config', `--config ${given}: no such file`);
  const src = sources.find((f) => existsSync(f));
  if (!src) fail('no_config', 'no Orbit config found: run /orbit:orbit-setup (it starts setup from the plugin\'s clone, which holds one), or pass --config <file>');
  let cfg;
  try { cfg = JSON.parse(readFileSync(src, 'utf8')); } catch { fail('bad_config', `${src} isn't valid JSON`); }
  const missing = missingField(cfg);
  if (missing) fail('config_incomplete', `${src} has no ${missing}: it can't be used (pass --config <file> with a complete config)`);
  copyFileSync(src, target);
  chmodSync(target, 0o600);
  return { result: 'done', note: `copied ${src} to ${target}` };
}

/** McError → is Mission Control (or Google) out of reach? A network error, a timeout, 429 or 5xx. */
const unreachable = (e) => e instanceof McError && (e.code === 'unreachable' || e.status === 0 || e.status === 429 || e.status >= 500);

async function signin(args, ctx) {
  const cfg = readConfig();
  let person = readPerson();
  let kept = false;
  if (person) {
    const before = readPersonRaw(); // the forced refresh rewrites it: put back as it was on a refusal (34.3)
    let token = null;
    try {
      token = await getIdToken({ config: cfg, force: true });
    } catch (e) {
      if (e.code === 'unreachable') fail('unreachable', UNREACHABLE_WORDS);
      if (!['signin_expired', 'not_signed_in'].includes(e.code)) throw e;
    }
    if (token) {
      let reg;
      try {
        reg = await personClient(token).call('registerPerson', {});
      } catch (e) {
        restorePersonRaw(before);
        if (unreachable(e)) fail('unreachable', UNREACHABLE_WORDS);
        const words = e instanceof McError ? refusalWords(e.code, { notInvited: SETUP_NOT_INVITED }) : null;
        if (words) fail(e.code, words);
        throw e;
      }
      person = { ...readPerson(), handle: reg?.handle ?? null, displayName: reg?.displayName ?? person.displayName ?? null, stationIds: Array.isArray(reg?.stationIds) ? reg.stationIds : [] };
      writePerson(person); // as orbit login does: the handle and stationIds written back
      kept = true;
    }
  }
  if (!kept) {
    ctx.progress('signing in with Google: a browser tab opens; use the Google account you were invited at');
    try {
      ({ person } = await signInAndRegister({ config: cfg, emulatorUser: typeof args['emulator-user'] === 'string' ? args['emulator-user'] : null, log: ctx.progress, notInvited: SETUP_NOT_INVITED }));
    } catch (e) {
      if (e instanceof OrbitError && ['not_invited', 'domain_not_allowed', 'email_not_verified', 'unreachable'].includes(e.code)) fail(e.code, e.code === 'unreachable' ? UNREACHABLE_WORDS : e.message);
      // M31 call 15: a 429 or 5xx from registerPerson after a fresh browser sign-in is Mission Control out of reach (as the kept
      // sign-in's path above); orbit login's own answer to it is unchanged
      if (unreachable(e)) fail('unreachable', UNREACHABLE_WORDS);
      throw e;
    }
  }
  if (!person.handle) fail('not_registered', 'Mission Control gave this sign-in no handle: run setup again');
  const stationId = typeof args.station === 'string' ? args.station : person.stationIds?.[0];
  // M31 call 15: the fix words point at the Console, where an invite is accepted
  if (!stationId) fail('no_station', `@${person.handle} is in no station: once an admin has invited you, accept the invite in the Orbit Console (sign in there with this Google account), then run setup again`);
  if (!person.stationIds.includes(stationId)) fail('not_in_station', `@${person.handle} isn't in station "${stationId}": once an admin has invited you there, accept the invite in the Orbit Console, then run setup again; or pick one of yours with --station (${person.stationIds.join(', ') || 'none'})`);
  Object.assign(ctx, { handle: person.handle, stationId });
  return { result: kept ? 'already' : 'done', note: `signed in as @${person.handle}` };
}

async function seat(args, ctx) {
  const person = readPerson();
  const s = readSeat();
  if (s) {
    let who;
    try {
      who = await mcCall('whoami', {}, { token: s.seatKey });
    } catch (e) {
      if (unreachable(e)) fail('unreachable', `can't reach Mission Control: check the network and rerun (${e.message})`);
      if (e instanceof McError && e.status === 401) fail('dead_seat', `this device's seat ${s.seatId} no longer works (its key was refused: retired, or a new key replaced it); to enrol a new one, run ${SEAT_FIX}`);
      throw e;
    }
    const rec = who?.seat ?? {};
    if (rec.retiredAt) fail('dead_seat', `this device's seat ${s.seatId} was retired; to enrol a new one, run ${SEAT_FIX}`);
    const theirs = rec.personUid ? rec.personUid !== person.uid : (s.handle ?? null) !== person.handle;
    if (theirs) fail('foreign_seat', `this device's seat ${s.seatId} isn't @${person.handle}'s; to enrol your own in its place, run ${SEAT_FIX}`);
    if (rec.kind && rec.kind !== 'ground') fail('not_ground', `this device's seat ${s.seatId} is a ${rec.kind} seat, not a ground seat; to enrol a ground seat in its place, run ${SEAT_FIX}`);
    if (rec.stationId !== ctx.stationId) fail('other_station', `this device's seat ${s.seatId} is in station ${rec.stationId ?? 'unknown'}, not ${ctx.stationId}; to enrol one in ${ctx.stationId} in its place, run ${SEAT_FIX} --station ${ctx.stationId}`);
    ctx.seatId = s.seatId;
    const account = typeof args.account === 'string' && args.account !== (rec.accountLabel ?? s.accountLabel) ? `; --account ${args.account} noted, not applied (the seat's account is ${rec.accountLabel ?? s.accountLabel ?? 'unset'})` : '';
    return { result: 'already', note: `this device is already seat ${s.seatId}${account}` };
  }
  try {
    const token = await getIdToken();
    const t = await personClient(token).call('createEnrolToken', { stationId: ctx.stationId, kind: 'ground' });
    if (!t?.token) fail('bad_token', 'createEnrolToken returned no token: run setup again');
    const { seat: enrolled, warning } = await enrolWithToken({ token: t.token, kind: 'ground', accountLabel: typeof args.account === 'string' ? args.account : 'ground', handle: person.handle, stationId: ctx.stationId });
    if (warning) ctx.progress(`warning: ${warning}`);
    ctx.seatId = enrolled.seatId;
    return { result: 'done', note: `enrolled ground seat ${enrolled.seatId} in station ${ctx.stationId}` };
  } catch (e) {
    if (e instanceof StepFailed) throw e;
    if (unreachable(e) || e.code === 'unreachable') fail('unreachable', `can't reach Mission Control: check the network and rerun (${e.message})`);
    throw e;
  }
}

async function status(args, ctx) {
  const s = await collectStatus({ timeoutMs: 10_000 });
  ctx.status = s;
  const hb = s.heartbeatError;
  if (s.update.kind === 'stop') fail('below_minimum', `Uplink ${s.uplinkVersion} is below the minimum ${s.update.minVersion ?? '(see Mission Control)'}: run orbit update (or /orbit:orbit-setup), then start a new session`);
  if (hb && (hb.status === 0 || hb.code === 'unreachable' || hb.status === 429 || hb.status >= 500)) fail('unreachable', `can't reach Mission Control: check the network and rerun (${s.errors[0] ?? 'no answer'})`);
  if (hb && hb.status === 401) fail('dead_seat', `Mission Control refused this device's seat key; to enrol a new one, run ${SEAT_FIX}`);
  if (s.errors.length) fail(hb?.code ?? 'status_error', `orbit status: ${s.errors[0]}`);
  return { result: 'done', note: `seat ${s.seat?.seatId} in station ${s.seat?.stationId}, Uplink ${s.uplinkVersion}` };
}

const RUN = { check, cli, config, signin, seat, status };

export async function run(argv) {
  const { parseArgs } = await import('../args.js');
  const args = parseArgs(argv, { booleans: ['json'] });
  const unknown = Object.keys(args).filter((k) => k !== '_' && !OPTIONS.includes(k));
  const valueless = ['station', 'account', 'config', 'emulator-user'].filter((k) => args[k] === true || args[k] === '');
  if (args._.length || unknown.length || valueless.length) {
    const why = args._.length ? `unexpected "${args._[0]}"` : unknown.length ? `unknown option --${unknown[0]}` : `--${valueless[0]} needs a value`;
    throw new OrbitError(`${why}\nusage: ${USAGE}`, { exitCode: 2 });
  }
  const json = Boolean(args.json);
  const ctx = { seatId: null, handle: null, stationId: null, status: null, progress: (line) => process.stderr.write(`${line}\n`) };
  const steps = [];
  let failed = null;
  for (const step of STEPS) {
    if (failed) { steps.push({ step, result: 'skipped', note: '' }); continue; }
    try {
      const r = await RUN[step](args, ctx);
      steps.push({ step, result: r.result, note: r.note });
    } catch (e) {
      const code = e instanceof StepFailed ? e.code : e.code ?? 'error';
      const fix = e instanceof StepFailed ? e.fix : `${e.message}${e.hint ? ` (${e.hint})` : ''}`;
      failed = { step, code, fix };
      steps.push({ step, result: 'failed', note: fix });
    }
    if (!json) {
      const last = steps.at(-1);
      process.stdout.write(`${last.step}: ${last.result}${last.note ? ` · ${last.note}` : ''}\n`);
    }
  }
  if (json) {
    const out = { steps, seatId: ctx.seatId, handle: ctx.handle, stationId: ctx.stationId, ...(failed && { failed }), ...(ctx.status && { status: ctx.status }) };
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return failed ? 1 : 0;
  }
  for (const s of steps.filter((x) => x.result === 'skipped')) process.stdout.write(`${s.step}: skipped\n`);
  if (ctx.status) process.stdout.write(`\n${formatBlock(ctx.status)}\n`);
  if (failed) {
    process.stdout.write(`\nSetup stopped at ${failed.step}. Fix: ${failed.fix}\n`);
    return 1;
  }
  process.stdout.write(`\n${LAST_LINE}\n`);
  return 0;
}

export { orbitHome };
