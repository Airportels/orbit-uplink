// Everything that differs by platform (CONTRACT §37, v0.13.1, W2): finding programs (W4, W5), running them (W6), npm's layout (W8),
// writability (W11), the words a person reads (W13, W20, W21) and the line split (W7). No other file in src/ asks which platform it
// runs on, except src/commands/login.js (the browser opener) and src/watch.js (W25's signals); the plugin carries its own copies
// (uplink/plugin/hooks/find-cli.mjs, W15a). POSIX behaviour is unchanged (W3).
//
// Every function takes an optional last argument `o` = { platform, env, exists, mkdtemp, rm, realpath, run, path, execPath }, so a
// test can be Windows on macOS or Linux (W30). The defaults are process.platform and process.env, a stat-based file check (on POSIX
// also X_OK), fs.mkdtempSync, fs.rmSync, fs.realpathSync.native, a spawnSync runner (the one seam for every child process) and
// path.win32 or path.posix by platform.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { OrbitError } from './errors.js';

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isExecutable = (p) => { try { if (!statSync(p).isFile()) return false; accessSync(p, constants.X_OK); return true; } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** The context for `o`: every seam with its default. */
export function ctx(o = {}) {
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  return {
    platform,
    win,
    env: o.env ?? process.env,
    // On Windows existence is the test (W4); on POSIX a program must be executable, as before (W3).
    exists: o.exists ?? (win ? isFile : isExecutable),
    isFile: o.isFile ?? o.exists ?? isFile,
    isDir: o.isDir ?? isDir,
    mkdtemp: o.mkdtemp ?? mkdtempSync,
    rm: o.rm ?? rmSync,
    realpath: o.realpath ?? realpathSync.native,
    run: o.run ?? ((cmd, args, opts) => spawnSync(cmd, args, opts)),
    path: o.path ?? (win ? win32 : posix),
    execPath: o.execPath ?? process.execPath,
  };
}

export const isWindows = (o = {}) => ctx(o).win;

/** W7: a child's output, split on \r?\n. */
export const splitLines = (s) => String(s ?? '').split(/\r?\n/);

/** W4: the env's PATH value; on win32 the key is matched without case (`Path` or `PATH`). */
export function pathValue(o = {}) {
  const c = ctx(o);
  if (!c.win) return c.env.PATH ?? '';
  const key = Object.keys(c.env).find((k) => k.toUpperCase() === 'PATH');
  return key ? c.env[key] ?? '' : '';
}

/** W4: PATHEXT's extensions (empty entries dropped); unset or empty → .COM;.EXE;.BAT;.CMD. */
export function pathExts(o = {}) {
  const c = ctx(o);
  const key = Object.keys(c.env).find((k) => k.toUpperCase() === 'PATHEXT');
  const exts = String((key && c.env[key]) || '').split(';').map((e) => e.trim()).filter(Boolean);
  return exts.length ? exts : ['.COM', '.EXE', '.BAT', '.CMD'];
}

/**
 * W4: the full path of `name` on PATH, or null. POSIX: each PATH folder in order, an executable file (as 0.13.0). win32: PATH
 * split on `;`, each entry trimmed, its surrounding `"` stripped, empty and relative entries skipped; a name whose extension is in
 * PATHEXT is tried as it is, any other name as name + ext for each extension in order. Never the extensionless name (an sh script
 * Windows can't run), no X_OK test.
 */
export function which(name, o = {}) {
  const c = ctx(o);
  if (!c.win) {
    for (const dir of pathValue(c).split(posix.delimiter)) {
      if (!dir) continue;
      const p = posix.join(dir, name);
      if (c.exists(p)) return p;
    }
    return null;
  }
  const exts = pathExts(c);
  const ext = win32.extname(name).toUpperCase();
  // An appended extension is written in lower case (PATHEXT is upper case; NTFS matches without case): git.exe, orbit.cmd.
  const names = ext && exts.some((e) => e.toUpperCase() === ext) ? [name] : exts.map((e) => name + e.toLowerCase());
  for (const raw of pathValue(c).split(';')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1').trim();
    if (!dir || !win32.isAbsolute(dir)) continue;
    for (const n of names) {
      const p = win32.join(dir, n);
      if (c.exists(p)) return p;
    }
  }
  return null;
}

/**
 * W5: do `a` and `b` name the same install? POSIX: the same file by real path (as 0.13.0). win32: the resolved paths match without
 * case after a final .cmd, .ps1 or .exe is dropped; each resolves with realpath when both exist, else path.win32.resolve.
 */
export function sameInstall(a, b, o = {}) {
  const c = ctx(o);
  if (!a || !b) return false;
  if (!c.win) {
    try { return c.realpath(a) === c.realpath(b); } catch { return false; }
  }
  let ra = win32.resolve(a), rb = win32.resolve(b);
  if (c.isFile(a) && c.isFile(b)) { try { ra = c.realpath(a); rb = c.realpath(b); } catch { /* keep the resolved paths */ } }
  const norm = (p) => p.replace(/\.(cmd|ps1|exe)$/i, '').toLowerCase();
  return norm(ra) === norm(rb);
}

/**
 * W8: where npm puts things for `prefix`. win32: binDir = prefix, shim = prefix\orbit.cmd, pkgDir =
 * prefix\node_modules\@airportels\orbit-cli. POSIX: binDir = prefix/bin, shim = prefix/bin/orbit, pkgDir =
 * prefix/lib/node_modules/@airportels/orbit-cli. orbitJs = pkgDir/bin/orbit.js on both.
 */
export function layout(prefix, o = {}) {
  const c = ctx(o);
  const p = c.win ? win32 : posix;
  const binDir = c.win ? prefix : p.join(prefix, 'bin');
  const pkgDir = c.win ? p.join(prefix, 'node_modules', '@airportels', 'orbit-cli') : p.join(prefix, 'lib', 'node_modules', '@airportels', 'orbit-cli');
  return { binDir, shim: p.join(binDir, c.win ? 'orbit.cmd' : 'orbit'), pkgDir, orbitJs: p.join(pkgDir, 'bin', 'orbit.js') };
}

/**
 * W11: can npm write under `prefix`? win32: a real create and remove (mkdtemp, then rm) in the prefix, or in its nearest existing
 * parent; fs.access ignores ACLs. POSIX: as 0.13.0 (setup.js writableDir: the folder, and lib, lib/node_modules and bin when there,
 * pass W_OK). → { ok, code? }: code EPERM (or what mkdtemp threw) when it can't.
 */
export function writable(prefix, o = {}) {
  const c = ctx(o);
  let p = prefix;
  for (;;) {
    if (c.isDir(p)) break;
    const up = c.path.dirname(p);
    if (up === p) return { ok: false, code: 'ENOENT' };
    p = up;
  }
  if (c.win) {
    let tmp;
    try {
      tmp = c.mkdtemp(win32.join(p, 'orbit-w-'));
      c.rm(tmp, { recursive: true, force: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e?.code ?? 'EPERM' };
    }
  }
  try { accessSync(p, constants.W_OK); } catch (e) { return { ok: false, code: e?.code ?? 'EACCES' }; }
  if (p === prefix) {
    for (const sub of ['lib', posix.join('lib', 'node_modules'), 'bin']) { // a folder npm writes into, when it is already there
      const d = posix.join(p, sub);
      if (c.isDir(d)) { try { accessSync(d, constants.W_OK); } catch (e) { return { ok: false, code: e?.code ?? 'EACCES' }; } }
    }
  }
  return { ok: true };
}

/**
 * W6a: npm's own script on win32: `<dirname(execPath)>\node_modules\npm\bin\npm-cli.js`, else the same relative file beside the
 * folder of which('npm'). null when neither exists (check fails no_npm). POSIX: null (npm runs by name, as 0.13.0).
 */
export function npmCliJs(o = {}) {
  const c = ctx(o);
  if (!c.win) return null;
  const rel = ['node_modules', 'npm', 'bin', 'npm-cli.js'];
  const first = win32.join(win32.dirname(c.execPath), ...rel);
  if (c.isFile(first)) return first;
  const npm = which('npm', c);
  if (npm) {
    const beside = win32.join(win32.dirname(npm), ...rel);
    if (c.isFile(beside)) return beside;
  }
  return null;
}

/** W6a: { cmd, args } that run npm with `args`: win32 node + npm-cli.js, no shell; POSIX `npm` by name. null: no npm (win32). */
export function npmCommand(args, o = {}) {
  const c = ctx(o);
  if (!c.win) return { cmd: 'npm', args };
  const js = npmCliJs(c);
  return js ? { cmd: c.execPath, args: [js, ...args] } : null;
}

/** W6a: run npm (spawnSync options as given, never a shell). No npm on win32 → { status: null, error: { code: 'no_npm' } }. */
export function runNpm(args, opts = {}, o = {}) {
  const c = ctx(o);
  const n = npmCommand(args, c);
  if (!n) return { status: null, stdout: '', stderr: '', error: { code: 'no_npm' } };
  return c.run(n.cmd, n.args, { ...opts, shell: false });
}

/** W6b: run an installed orbit's `orbit.js` with Node (never through its shim), on every platform. */
export function runOrbit(orbitJs, args, opts = {}, o = {}) {
  const c = ctx(o);
  return c.run(c.execPath, [orbitJs, ...args], { ...opts, shell: false });
}

/** W6c: claude on PATH → { path, kind: 'exe' | 'cmd' | 'posix' }, or null. */
export function findClaude(o = {}) {
  const c = ctx(o);
  const p = which('claude', c);
  if (!p) return null;
  if (!c.win) return { path: p, kind: 'posix' };
  return { path: p, kind: /\.(cmd|bat)$/i.test(p) ? 'cmd' : 'exe' };
}

/** cmd.exe by its full path: ComSpec, else <SystemRoot>\System32\cmd.exe (W6c, W6d's browser opener). */
export function cmdExe(o = {}) {
  const c = ctx(o);
  const key = (k) => Object.keys(c.env).find((x) => x.toUpperCase() === k);
  const comspec = key('COMSPEC') && c.env[key('COMSPEC')];
  if (comspec) return comspec;
  const root = (key('SYSTEMROOT') && c.env[key('SYSTEMROOT')]) || 'C:\\Windows';
  return win32.join(root, 'System32', 'cmd.exe');
}

/** W6c: what claude's arguments may be when it runs through cmd.exe. */
export const SAFE_ARG = /^[A-Za-z0-9@._-]+$/;

/**
 * W6c: { cmd, args, opts } that run claude with `args`, or { error }: `claude not found on PATH`, or an argument cmd.exe would
 * misread. A .exe (the native install) and POSIX's claude run by their full path; a .cmd (an npm install) runs as
 * cmd.exe /d /s /c ""<path>" <args>"" with windowsVerbatimArguments, so a path with a space works.
 */
export function claudeCommand(args, o = {}) {
  const c = ctx(o);
  const cl = findClaude(c);
  if (!cl) return { error: 'claude not found on PATH' };
  if (cl.kind !== 'cmd') return { cmd: cl.path, args, opts: {} };
  const bad = args.find((a) => !SAFE_ARG.test(a));
  if (bad !== undefined) return { error: `refused to pass "${bad}" to claude through cmd.exe` };
  return { cmd: cmdExe(c), args: ['/d', '/s', '/c', `""${cl.path}" ${args.join(' ')}"`], opts: { windowsVerbatimArguments: true } };
}

/** W6c: run claude. → spawnSync's result, or { status: null, error: { code: 'no_claude' | 'bad_arg', message } } without running. */
export function runClaude(args, opts = {}, o = {}) {
  const c = ctx(o);
  const cc = claudeCommand(args, c);
  if (cc.error) return { status: null, stdout: '', stderr: cc.error, error: { code: /not found/.test(cc.error) ? 'no_claude' : 'bad_arg', message: cc.error } };
  return c.run(cc.cmd, cc.args, { ...opts, ...cc.opts, shell: false });
}

const found = new Map(); // W6d: git and tar, found once per process (default context only)
/**
 * W6d: git's or tar's absolute path from PATH, never a bare name: on Windows a spawn looks in its working folder first, so a git.exe
 * an Orbiter's patch put in a repo's root would run otherwise. On win32 a .cmd or .bat git doesn't count (no_git). null: not found.
 */
export function toolPath(name, o = {}) {
  const c = ctx(o);
  const cache = !o || Object.keys(o).length === 0;
  if (cache && found.has(name)) return found.get(name);
  let p = which(name, c);
  if (p && c.win && /\.(cmd|bat)$/i.test(p)) p = null;
  if (cache) found.set(name, p);
  return p;
}
/**
 * W6d (amended after the review of t-0097): git's absolute path from PATH, or the error no_git with W20's Git words. Never a bare
 * `git` or `git.exe`: on Windows a bare name is looked for in the spawn's working folder first. Every command that runs git calls
 * this (git.js, factory.js), so each fails the same way, not only setup's check.
 */
export function gitBin(o = {}) {
  const p = toolPath('git', o);
  if (!p) throw new OrbitError(gitWords(o), { code: 'no_git' });
  return p;
}
/** W6d: tar's absolute path from PATH, or the extract step's own error (no_tar). Never a bare `tar` or `tar.exe`. */
export function tarBin(o = {}) {
  const p = toolPath('tar', o);
  if (!p) throw new OrbitError("tar isn't on PATH, so the result can't be extracted: install tar (it comes with Windows 10 and 11, and with macOS), then run the command again", { code: 'no_tar' });
  return p;
}

/** W21: does this platform have POSIX file modes? On win32 fileMode() is null, and the words drop "(mode …)". */
export const hasFileModes = (o = {}) => !ctx(o).win;

/** W10, W12: is `prefix` under %VOLTA_HOME% (win32's node_manager)? */
export function underVolta(prefix, o = {}) {
  const c = ctx(o);
  if (!c.win) return false;
  const key = Object.keys(c.env).find((k) => k.toUpperCase() === 'VOLTA_HOME');
  const volta = key && c.env[key];
  if (!volta) return false;
  const rel = win32.relative(win32.resolve(volta).toLowerCase(), win32.resolve(prefix).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !win32.isAbsolute(rel));
}

// ── W20: the words, by platform. The darwin words are 0.13.0's, unchanged. ──

export const DARWIN_NODE_WORDS = 'Install Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it (or, if you use Homebrew, `brew install node`). Then start a new Claude Code session and run /orbit:orbit-setup again.';
export const DARWIN_GIT_WORDS = 'Install git: run `xcode-select --install` in Terminal, or type `git` there and macOS offers to install it. Then run /orbit:orbit-setup again.';
export const WIN_NODE_WORDS = 'Install Node.js 22 or newer: download the Windows Installer (.msi) from https://nodejs.org and run it, keeping its default options (or, in PowerShell, `winget install OpenJS.NodeJS.LTS`). Then close and reopen your terminal, start a new Claude Code session and run /orbit:orbit-setup again.';
export const WIN_GIT_WORDS = 'Install Git for Windows from https://git-scm.com/downloads/win, keeping its recommended PATH option (or, in PowerShell, `winget install --id Git.Git -e --source winget`). Then close and reopen your terminal, start a new Claude Code session and run /orbit:orbit-setup again.';

export const nodeWords = (o = {}) => (ctx(o).win ? WIN_NODE_WORDS : DARWIN_NODE_WORDS);
export const gitWords = (o = {}) => (ctx(o).win ? WIN_GIT_WORDS : DARWIN_GIT_WORDS);

/** W20: win32's global_not_writable. */
export const globalNotWritableWords = (prefix) => `npm's global folder ${prefix} can't be written without admin rights. Install Node.js with the Windows Installer (.msi) from https://nodejs.org, which keeps it in your user folder (%APPDATA%\\npm), then run /orbit:orbit-setup again.`;

/** W13: win32's not_on_path fix, exactly. */
export const winNotOnPathFix = (prefix) => `npm's global folder ${prefix} isn't on your PATH. Press Win+R and run \`rundll32 sysdm.cpl,EditEnvironmentVariables\`. Under your user variables select Path, click Edit, then New, paste ${prefix} (skip this if it's already listed), and click OK twice. Then close every terminal window and Claude Code, open a new terminal and run /orbit:orbit-setup again.`;

/** W13: win32's shadowed fix: another Orbit install (its folder holds node_modules\@airportels\orbit-cli), or another program. */
export function winShadowedFix(file, prefix, o = {}) {
  const c = ctx(o);
  const dir = win32.dirname(file);
  const orbitHere = c.isDir(win32.join(dir, 'node_modules', '@airportels', 'orbit-cli'));
  return orbitHere
    ? `another Orbit install comes first on your PATH (${file}): run \`npm.cmd uninstall -g --prefix "${dir}" @airportels/orbit-cli\`, then run /orbit:orbit-setup again.`
    : `another program named orbit comes first on your PATH (${file}). It isn't Orbit, so don't delete it: move ${prefix} above its folder in your Path (as above), or ask whoever installed it.`;
}

/** W20: orbit watch's keep-awake line. darwin: 0.13.0's; win32: the Settings path; elsewhere 0.13.0's generic line. */
export function keepAwakeWords(o = {}) {
  const c = ctx(o);
  if (c.platform === 'darwin') return 'Keep this Mac awake while watching: on power with the lid open, or run `caffeinate -i` (S8 run 2: a sleeping Mac cannot run the turn).';
  if (c.win) return 'Keep this computer awake while watching: plugged in, with Sleep set to Never in Settings > System > Power.';
  return 'Keep this machine awake while watching.';
}

/**
 * W20: a path as words. POSIX keeps 0.13.0's `~/…` for a path in the home folder; win32 prints the real path, never `~/`.
 * `home` is the home folder, `p` the path.
 */
export function shownPath(p, home, o = {}) {
  const c = ctx(o);
  if (c.win || !home) return p;
  return p === home ? '~' : p.startsWith(`${home}/`) ? `~/${p.slice(home.length + 1)}` : p;
}
