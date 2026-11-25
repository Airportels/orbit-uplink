// The plugin's source copy (CONTRACT §38, v0.13.2, X1–X5). A synced plugin (added by clicks in the Claude desktop app) is the plugin
// folder alone, with no marketplace clone, so the launcher (scripts/orbit-setup.mjs, X6) fetches the CLI it needs: a checkout of the
// public tree at the plugin's own version, `<ORBIT_HOME or ~/.orbit>/src/<version>` (X1). One rule, two implementations: this one
// imports only node: modules (W15a, amended by X2: scripts may import the plugin's own files, so W4's `which` comes from
// ../hooks/find-cli.mjs), and uplink/cli/src/source-copy.js is the CLI's, built on platform.js. A test checks that both give the
// same URL rule, git arguments and environment, folders, rename, checks and words (X14).
//
// ensureCopy (X2, X3): check git (by its absolute path; on win32 a .cmd or .bat git doesn't count; `<git> --version` within 10 s),
// clone `--depth 1 --no-tags --branch v<version>` into `<src>/.fetch-<pid>-<random>`, check HEAD against the remote tag's commit and
// the version in uplink/cli/package.json, then rename it into place (win32: EPERM, EACCES and EBUSY retried with backoff for up to
// 10 s). Every failure leaves no `<src>/<version>` that wasn't there before. pruneCopies (X4) deletes only what X4 allows. Nothing
// here reaches the network but git's clone and ls-remote of SRC_URL (or, in tests only, a file: ORBIT_SRC_URL).
//
// Every function takes an optional last argument `o` of seams: { platform, env, homedir, path, lstat, readdir, rename, rm, mkdir,
// readFile, exists, run, now, sleep, pid, random }, so a test can be Windows on macOS or Linux. The defaults are this process's.
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { which } from '../hooks/find-cli.mjs';

/** X2: the public tree (§36). No GitHub account or credential is needed. */
export const SRC_URL = 'https://github.com/Airportels/orbit-uplink';
/** X1: a version is used only if it matches this. */
export const VERSION_RE = /^\d+\.\d+\.\d+$/;
/** X2 step 4: the package the copy must carry. */
export const CLI_PACKAGE = '@airportels/orbit-cli';
/** X2: the launcher's whole fetch; `git --version`'s own cap. */
export const FETCH_TIMEOUT_MS = 120_000;
export const GIT_CHECK_MS = 10_000;
/** X2 step 5: win32's rename retries, for up to 10 s. */
export const RENAME_RETRY_MS = 10_000;
/** X4: a `.fetch-*` folder older than this is removed by pruning. */
export const STALE_FETCH_MS = 60 * 60 * 1000;

// §37 W20, as platform.js has them (0.13.2: X2's Command Line Tools sentence, X12's "quit and reopen the Claude app").
export const DARWIN_GIT_WORDS = 'Install git: run `xcode-select --install` in Terminal, or type `git` there and macOS offers to install it. If a window offers to install the command line developer tools, click Install, then run /orbit:orbit-setup again.';
export const WIN_GIT_WORDS = 'Install Git for Windows from https://git-scm.com/downloads/win, keeping its recommended PATH option (or, in PowerShell, `winget install --id Git.Git -e --source winget`). Then quit and reopen the Claude app (or your terminal), start a new Claude Code session and run /orbit:orbit-setup again.';

/** The GIT_* variables that steer repository discovery (as setup/publish-uplink.mjs strips them). */
export const GIT_DISCOVERY_VARS = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES']);
const GIT_CONFIG_OVERRIDE = /^GIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/;

const sleepSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const isFileAt = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** The context for `o`: every seam with its default. */
export function ctx(o = {}) {
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  return {
    platform,
    win,
    env: o.env ?? process.env,
    homedir: o.homedir ?? osHomedir,
    path: o.path ?? (win ? win32 : posix),
    exists: o.exists ?? isFileAt, // W4's existence test on win32 (find-cli.mjs uses X_OK on POSIX for programs)
    lstat: o.lstat ?? lstatSync,
    readdir: o.readdir ?? readdirSync,
    rename: o.rename ?? renameSync,
    rm: o.rm ?? rmSync,
    mkdir: o.mkdir ?? mkdirSync,
    readFile: o.readFile ?? ((p) => readFileSync(p, 'utf8')),
    run: o.run ?? ((cmd, args, opts) => spawnSync(cmd, args, opts)),
    now: o.now ?? Date.now,
    sleep: o.sleep ?? sleepSync,
    pid: o.pid ?? process.pid,
    random: o.random ?? (() => Math.random().toString(36).slice(2, 10)),
  };
}

/** X1: `<ORBIT_HOME or ~/.orbit>/src` (on win32 %USERPROFILE%\.orbit\src, from homedir()). */
export function srcRoot(o = {}) {
  const c = ctx(o);
  return c.path.join(c.env.ORBIT_HOME ? c.path.resolve(c.env.ORBIT_HOME) : c.path.join(c.homedir(), '.orbit'), 'src');
}
/** X1: one version's copy, `<src>/<version>`. */
export const copyDir = (version, o = {}) => ctx(o).path.join(srcRoot(o), version);
/** X6: the copy's CLI, run with this Node as a clone's is. */
export const copyOrbitJs = (version, o = {}) => ctx(o).path.join(copyDir(version, o), 'uplink', 'cli', 'bin', 'orbit.js');

/** X2: SRC_URL; ORBIT_SRC_URL only as a file: URL and only with ORBIT_TEST_MODE set. → { url } or { error }. */
export function resolveSrcUrl(o = {}) {
  const c = ctx(o);
  const over = c.env.ORBIT_SRC_URL;
  if (over === undefined || over === '') return { url: SRC_URL };
  if (c.env.ORBIT_TEST_MODE && /^file:/i.test(over)) return { url: over };
  return { error: { code: 'bad_src_url', message: `ORBIT_SRC_URL is honoured only as a file: URL in a test (ORBIT_TEST_MODE set); refusing ${over}. Unset it and run /orbit:orbit-setup again.` } };
}

/** X2 step 2: `env` without the GIT_* discovery variables and the GIT_CONFIG_* overrides, never prompting. */
export function gitEnv(env = process.env) {
  const out = { ...env };
  for (const k of GIT_DISCOVERY_VARS) delete out[k];
  for (const k of Object.keys(out)) if (GIT_CONFIG_OVERRIDE.test(k)) delete out[k];
  return { ...out, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: '0' };
}

/** X2 step 2: the clone, shallow, of the tag alone. */
export const cloneArgs = (version, url, tmp) => ['clone', '--depth', '1', '--no-tags', '--branch', `v${version}`, url, tmp];
/** X2 step 3: the tag's commit on the remote (the peeled ^{} line of an annotated tag, else a lightweight tag's ref). */
export const lsRemoteArgs = (version, url) => ['ls-remote', url, `refs/tags/v${version}^{}`, `refs/tags/v${version}`];

/** W20: the Git words for this platform. */
export const gitWords = (o = {}) => (ctx(o).win ? WIN_GIT_WORDS : DARWIN_GIT_WORDS);

/** X6's progress line (the launcher writes it to stderr, so `setup --json` keeps one object on stdout). */
export const progressLine = (version) => `Fetching Orbit's CLI (version ${version}) from github.com/Airportels/orbit-uplink …`;

/** X2 step 1: git's absolute path (W4; on win32 a .cmd or .bat git doesn't count), or null. */
export function gitPath(o = {}) {
  const c = ctx(o);
  const p = which('git', { platform: c.platform, env: c.env, path: c.path, ...(o.exists ? { exists: o.exists } : {}) });
  const onPath = p && c.win && /\.(cmd|bat)$/i.test(p) ? null : p;
  // §39 N9 (amends X2): on win32, no git.exe on PATH → Git for Windows' known places, the first that's there (platform.js's list)
  if (!onPath && c.win) return winGitCandidates(c).find((f) => c.exists(f)) ?? null;
  return onPath;
}

// ── §39 N9 (0.13.3): the plugin's copy of platform.js's PowerShell read and Git for Windows list (the parity test pins both). ──
/** N9: the env's value for `k`, its key matched without case (Windows' env is case-insensitive). */
const envOf = (env, k) => { const key = Object.keys(env).find((x) => x.toUpperCase() === k); return key ? env[key] : undefined; };
/** N9 (WOW64): a 32-bit Node on 64-bit Windows (PROCESSOR_ARCHITEW6432 set), where System32 and %ProgramFiles% are the 32-bit view. */
export const isWow64 = (env) => !!envOf(env, 'PROCESSOR_ARCHITEW6432');
/**
 * N9: %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe, never a bare `powershell`. Under WOW64
 * %SystemRoot%\Sysnative\…, the 64-bit PowerShell, which sees the 64-bit registry (a 64-bit Git's InstallPath, the real Path).
 */
export function powershellExe(o = {}) {
  const c = ctx(o);
  const root = envOf(c.env, 'SYSTEMROOT') || 'C:\\Windows';
  return win32.join(root, isWow64(c.env) ? 'Sysnative' : 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
/** N9: %ProgramFiles%, or %ProgramW6432% under WOW64 (where a 64-bit Git is installed), else undefined. */
export const programFilesOf = (env) => (isWow64(env) && envOf(env, 'PROGRAMW6432')) || envOf(env, 'PROGRAMFILES');
export const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-Command', script];
const PS_UTF8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
export const GIT_REG_SCRIPT = PS_UTF8 + "foreach ($h in 'HKLM','HKCU') { $v = (Get-ItemProperty -Path ($h + ':\\SOFTWARE\\GitForWindows') -Name InstallPath -ErrorAction SilentlyContinue).InstallPath; if ($v) { $h + '=' + $v } }";
export const PS_TIMEOUT_MS = 10_000;
/** N9: one script's output lines (UTF-8), or null when it didn't answer. */
export function powershellLines(script, o = {}) {
  const c = ctx(o);
  const r = c.run(powershellExe(c), psArgs(script), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: PS_TIMEOUT_MS, windowsHide: true });
  if (!r || r.error || r.status !== 0) return null;
  return String(r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
/** N9: HKLM, then HKCU, GitForWindows InstallPath\cmd\git.exe; %ProgramFiles%\Git\cmd\git.exe (%ProgramW6432% under WOW64); %LOCALAPPDATA%\Programs\Git\cmd\git.exe. */
export function winGitCandidates(o = {}) {
  const c = ctx(o);
  if (!c.win) return [];
  const env = (k) => { const key = Object.keys(c.env).find((x) => x.toUpperCase() === k); return key ? c.env[key] : undefined; };
  const lines = powershellLines(GIT_REG_SCRIPT, c) ?? [];
  const reg = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]).filter(([k]) => k));
  const out = [];
  for (const h of ['HKLM', 'HKCU']) if (reg[h]) out.push(win32.join(reg[h], 'cmd', 'git.exe'));
  const pf = programFilesOf(c.env);
  if (pf) out.push(win32.join(pf, 'Git', 'cmd', 'git.exe'));
  if (env('LOCALAPPDATA')) out.push(win32.join(env('LOCALAPPDATA'), 'Programs', 'Git', 'cmd', 'git.exe'));
  return out;
}

/**
 * §39 N9 (amends W17): the launcher's child environment: dirname(execPath) first on PATH (win32: the PATH key matched without
 * case, `;`; POSIX `:`), so setup's `node` and `npm` are the ones this Node came with. Nothing else is added.
 */
export function nodeFirstEnv(env = process.env, execPath = process.execPath, platform = process.platform) {
  const win = platform === 'win32';
  const dir = (win ? win32 : posix).dirname(execPath);
  const out = { ...env };
  const key = win ? (Object.keys(out).find((k) => k.toUpperCase() === 'PATH') ?? 'Path') : 'PATH';
  out[key] = out[key] ? `${dir}${win ? ';' : ':'}${out[key]}` : dir;
  return out;
}

/** A package.json's { name, version }, or null when there is none or it can't be read. */
function pkgOf(dir, c) {
  try {
    const j = JSON.parse(c.readFile(c.path.join(dir, 'uplink', 'cli', 'package.json')));
    return { name: j?.name, version: j?.version };
  } catch {
    return null;
  }
}

/** X3: is `dir` a copy of the CLI at `version`? */
export function checkCopy(dir, version, o = {}) {
  const p = pkgOf(dir, ctx(o));
  return !!p && p.name === CLI_PACKAGE && p.version === version;
}

const lstatOf = (p, c) => { try { return c.lstat(p); } catch { return null; } };
const rmTree = (p, c) => { try { c.rm(p, { recursive: true, force: true, maxRetries: c.win ? 5 : 0, retryDelay: 200 }); } catch { /* best effort */ } };

/**
 * X4: may this entry of <src> go? A symlink: yes (it is unlinked, never followed). A folder: when its uplink/cli/package.json names
 * the CLI, or it has none at all (a failed copy). A foreign package.json, or a plain file: no.
 */
function removable(p, c) {
  const st = lstatOf(p, c);
  if (!st) return false;
  if (st.isSymbolicLink()) return true;
  if (!st.isDirectory()) return false;
  const pkg = pkgOf(p, c);
  if (pkg) return pkg.name === CLI_PACKAGE;
  try { c.readFile(c.path.join(p, 'uplink', 'cli', 'package.json')); return false; } catch { return true; } // unreadable but present: keep
}
/** X4: remove one entry: a symlink by unlinking it (rm without recursion removes the link itself), a folder with its tree. */
function removeEntry(p, c) {
  const st = lstatOf(p, c);
  if (!st) return;
  if (st.isSymbolicLink()) { try { c.rm(p, { force: true }); } catch { /* best effort */ } return; }
  rmTree(p, c);
}

/** git with a timeout from what's left; → { status, out, timedOut }. */
function git(c, bin, args, timeoutMs, cwdEnv) {
  if (timeoutMs <= 0) return { status: null, out: '', timedOut: true };
  const r = c.run(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env: cwdEnv, windowsHide: true, killSignal: 'SIGKILL' });
  const timedOut = r?.error?.code === 'ETIMEDOUT';
  return { status: r?.status ?? null, out: `${r?.stdout ?? ''}${r?.stderr ?? ''}`, stdout: String(r?.stdout ?? ''), stderr: String(r?.stderr ?? ''), timedOut, error: r?.error };
}
const lastLine = (s) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).pop() ?? '';
const fail = (code, message) => ({ ok: false, code, message });
const network = (url, version, why) => `Orbit's CLI couldn't be fetched from ${url} (tag v${version}): ${String(why).replace(/[.\s]+$/, '')}. Check the network and run /orbit:orbit-setup again.`; // git's line may end in a period

/** X2 step 5: rename with win32's retries (EPERM, EACCES, EBUSY, with backoff, up to 10 s). Throws the last error. */
function renameInto(tmp, dir, c) {
  const until = c.now() + RENAME_RETRY_MS;
  for (let wait = 100; ; wait = Math.min(wait * 2, 2000)) {
    try { c.rename(tmp, dir); return; } catch (e) {
      if (!c.win || !['EPERM', 'EACCES', 'EBUSY'].includes(e?.code) || c.now() + wait > until) throw e;
      c.sleep(wait);
    }
  }
}

/**
 * X2, X3: the copy of the CLI at `version`, fetched when it isn't there. → { ok: true, dir, js, fetched } or
 * { ok: false, code, message } with code bad_version, bad_src_url, no_git, fetch_failed, timeout, missing_tag, version_mismatch or
 * copy_in_the_way (a folder at <src>/<version> that X4 doesn't allow deleting). Synchronous.
 */
export function ensureCopy(version, { timeoutMs = FETCH_TIMEOUT_MS } = {}, o = {}) {
  const c = ctx(o);
  if (typeof version !== 'string' || !VERSION_RE.test(version)) return fail('bad_version', `"${version}" is not a version (x.y.z): nothing was fetched.`);
  const src = resolveSrcUrl(c);
  if (src.error) return fail(src.error.code, src.error.message);
  const url = src.url;
  const root = srcRoot(c);
  const dir = copyDir(version, c);
  const js = copyOrbitJs(version, c);
  // X3: reuse a matching copy; one that doesn't match goes (X4's rule) and is fetched again
  const there = lstatOf(dir, c);
  if (there) {
    // a symlink is never followed (X4): it is unlinked and the copy fetched again
    if (!there.isSymbolicLink() && checkCopy(dir, version, c)) return { ok: true, dir, js, fetched: false };
    if (!removable(dir, c)) return fail('copy_in_the_way', `${dir} is in the way and isn't an Orbit copy, so it was left alone: move it aside and run /orbit:orbit-setup again.`);
    removeEntry(dir, c);
  }
  const deadline = c.now() + timeoutMs;
  const left = () => deadline - c.now();
  // step 1: git, by its absolute path, answering --version within 10 s
  const bin = gitPath(o);
  if (!bin) return fail('no_git', gitWords(c));
  const env = gitEnv(c.env);
  const v = git(c, bin, ['--version'], Math.min(GIT_CHECK_MS, left()), env);
  if (v.status !== 0) return fail('no_git', gitWords(c));
  // step 2: the shallow clone of the tag, into a temporary folder of <src>
  try { c.mkdir(root, { recursive: true }); } catch (e) { return fail('fetch_failed', `${root} can't be made: ${e.message}`); }
  const tmp = c.path.join(root, `.fetch-${c.pid}-${c.random()}`);
  const done = (r) => { rmTree(tmp, c); return r; };
  const cl = git(c, bin, cloneArgs(version, url, tmp), left(), env);
  if (cl.timedOut) return done(fail('timeout', network(url, version, `timed out after ${Math.round(timeoutMs / 1000)} s`)));
  if (cl.status !== 0) {
    const why = lastLine(cl.out) || `git exited ${cl.status ?? cl.error?.code ?? '?'}`;
    // git names a missing ref "Remote branch v<x> not found": that is the tag missing, not the network
    if (/Remote branch .* not found|not found in upstream/i.test(cl.out)) return done(fail('missing_tag', `${url} has no tag v${version} (${why}). Run /orbit:orbit-setup again later, or ask the admin to publish it.`));
    return done(fail('fetch_failed', network(url, version, why)));
  }
  // step 3: HEAD is the tag's commit on the remote (a branch named like the tag must not win)
  // A failed or timed-out ls-remote or rev-parse is the network's failure (DNS, a proxy, GitHub's 5xx), never a missing tag: the
  // tag is unknown then. missing_tag only when ls-remote succeeded with no such tag, or the commits differ (V2: S38-1b).
  const gitFailed = (r) => lastLine(r.stderr) || lastLine(r.out) || `git exited ${r.status ?? r.error?.code ?? '?'}`;
  const ls = git(c, bin, lsRemoteArgs(version, url), left(), env);
  if (ls.timedOut) return done(fail('timeout', network(url, version, `timed out after ${Math.round(timeoutMs / 1000)} s`)));
  if (ls.status !== 0) return done(fail('fetch_failed', network(url, version, gitFailed(ls))));
  const refs = Object.fromEntries(ls.stdout.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((x) => x.length === 2).map(([sha, ref]) => [ref, sha]));
  const tagSha = refs[`refs/tags/v${version}^{}`] ?? refs[`refs/tags/v${version}`];
  const head = git(c, bin, ['-C', tmp, 'rev-parse', 'HEAD'], left(), env);
  if (head.timedOut) return done(fail('timeout', network(url, version, `timed out after ${Math.round(timeoutMs / 1000)} s`)));
  if (head.status !== 0) return done(fail('fetch_failed', network(url, version, gitFailed(head))));
  if (!tagSha || head.stdout.trim() !== tagSha) return done(fail('missing_tag', `${url}'s v${version} isn't the release tag (no tag v${version}, or a branch of that name answered instead). Run /orbit:orbit-setup again later, or ask the admin to publish it.`));
  // step 4: the version in the copy
  const pkg = pkgOf(tmp, c);
  if (!pkg || pkg.name !== CLI_PACKAGE || pkg.version !== version) return done(fail('version_mismatch', `${url} tag v${version} carries ${pkg?.name ?? 'no uplink/cli/package.json'}${pkg?.version ? ` ${pkg.version}` : ''}, not ${CLI_PACKAGE} ${version}.`));
  // step 5: into place; a copy that appeared meanwhile is checked as X3 reuses one
  const raced = () => {
    const st = lstatOf(dir, c);
    if (st && !st.isSymbolicLink() && checkCopy(dir, version, c)) return done({ ok: true, dir, js, fetched: false });
    return null;
  };
  if (lstatOf(dir, c)) {
    const r = raced();
    if (r) return r;
    if (!removable(dir, c)) return done(fail('copy_in_the_way', `${dir} is in the way and isn't an Orbit copy, so it was left alone: move it aside and run /orbit:orbit-setup again.`));
    removeEntry(dir, c);
  }
  try {
    renameInto(tmp, dir, c);
  } catch (e) {
    if (lstatOf(dir, c)) { const r = raced(); if (r) return r; }
    return done(fail('fetch_failed', `${tmp} couldn't be moved to ${dir}: ${e?.code ?? e?.message}. Run /orbit:orbit-setup again.`));
  }
  return { ok: true, dir, js, fetched: true };
}

/** Versions, newest first. */
const byVersionDesc = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
  return 0;
};

/**
 * X4: after a successful setup or update, keep the two newest versions and `inUse`; remove the other version entries X4 allows,
 * and `.fetch-*` folders older than an hour. Never throws. → the names removed.
 */
export function pruneCopies(inUse, o = {}) {
  const removed = [];
  try {
    const c = ctx(o);
    const root = srcRoot(c);
    let names = [];
    try { names = c.readdir(root); } catch { return removed; }
    const versions = names.filter((n) => VERSION_RE.test(n)).sort(byVersionDesc);
    const keep = new Set([...versions.slice(0, 2), ...(inUse ? [inUse] : [])]);
    for (const n of versions) {
      if (keep.has(n)) continue;
      const p = c.path.join(root, n);
      if (removable(p, c)) { removeEntry(p, c); removed.push(n); }
    }
    for (const n of names.filter((x) => x.startsWith('.fetch-'))) {
      const p = c.path.join(root, n);
      const st = lstatOf(p, c);
      if (!st) continue;
      if (st.isSymbolicLink()) { removeEntry(p, c); removed.push(n); continue; }
      if (st.isDirectory() && c.now() - Number(st.mtimeMs ?? 0) > STALE_FETCH_MS) { rmTree(p, c); removed.push(n); }
    }
  } catch { /* X4: pruning never changes the outcome */ }
  return removed;
}
