// The plugin's own CLI finder (CONTRACT §37, v0.13.1, W15a). An installed plugin is a copy of uplink/plugin alone
// (<plugins root>/cache/<marketplace>/<plugin>/<version>), so it can't import uplink/cli's platform.js: this file carries the
// plugin's own copies of W4's `which`, W8's `layout` and update.js's `cloneDirs`, which give the same answers (W30's test), and the
// W15 search order that hooks/session-start.mjs and scripts/orbit-setup.mjs both use. It imports only node: modules and runs
// nothing when imported. The plugin root comes from a script's own file (fileURLToPath(new URL('..', import.meta.url))), never
// from CLAUDE_PLUGIN_ROOT, which commands run through the Bash tool, and a terminal, don't have.
//
// Every function takes an optional last argument `o` = { platform, env, exists, isFile, readFile, path, homedir, root }, so a test
// can be Windows on macOS or Linux. The defaults are process.platform, process.env, a stat-based check (`exists`: on POSIX also
// X_OK, a program; `isFile`: any file), fs.readFileSync, path.win32 or path.posix by platform, os.homedir() and this plugin's root.
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const fileAt = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const executableAt = (p) => { try { if (!statSync(p).isFile()) return false; accessSync(p, constants.X_OK); return true; } catch { return false; } };

/** This plugin's root: the parent of this file's folder (hooks/), as each script finds its own. */
export const pluginRoot = () => fileURLToPath(new URL('..', import.meta.url));

/** The context for `o`: every seam with its default. */
export function ctx(o = {}) {
  const platform = o.platform ?? process.platform;
  const win = platform === 'win32';
  return {
    platform,
    win,
    env: o.env ?? process.env,
    exists: o.exists ?? (win ? fileAt : executableAt),
    isFile: o.isFile ?? o.exists ?? fileAt,
    readFile: o.readFile ?? ((p) => readFileSync(p, 'utf8')),
    path: o.path ?? (win ? win32 : posix),
    homedir: o.homedir ?? osHomedir,
    root: o.root,
  };
}

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
 * W4: the full path of `name` on PATH, or null. POSIX: each PATH folder in order, an executable file. win32: PATH split on `;`,
 * each entry trimmed, its surrounding `"` stripped, empty and relative entries skipped; a name whose extension is in PATHEXT is
 * tried as it is, any other name as name + ext for each extension in order. Never the extensionless name, no X_OK test.
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
 * The marketplace checkouts the plugin manager keeps, first the CLAUDE_CONFIG_DIR profile's, then the default ~/.claude:
 * `<dir>/plugins/marketplaces/<mp>` (update.js cloneDirs). Home is os.homedir(), never $HOME.
 */
export function cloneDirs(mp = 'orbit', o = {}) {
  const c = ctx(o);
  const home = c.homedir();
  const configDir = c.env.CLAUDE_CONFIG_DIR || c.path.join(home, '.claude');
  return [...new Set([c.path.join(configDir, 'plugins', 'marketplaces', mp), c.path.join(home, '.claude', 'plugins', 'marketplaces', mp)])];
}

/**
 * W15a: where an installed copy sits. The plugins root is four folders above the plugin root
 * (<root>/cache/<mp>/<plugin>/<version>), and the marketplace is the name two folders above it. §38 X7 (0.13.2): only in that cache
 * layout (the folder three levels up is named `cache`). Any other root, as for a synced plugin (added by clicks in the Claude desktop
 * app) or a --plugin-dir checkout, has no marketplace and no plugins root: `pluginsRoot` and `marketplace` are null, `synced` true.
 */
export function placeOf(o = {}) {
  const c = ctx(o);
  const root = c.path.resolve(c.root ?? pluginRoot());
  const up = (p, n) => { for (let i = 0; i < n; i++) p = c.path.dirname(p); return p; };
  const cached = c.path.basename(up(root, 3)) === 'cache';
  return { pluginRoot: root, pluginsRoot: cached ? up(root, 4) : null, marketplace: cached ? c.path.basename(up(root, 2)) : null, synced: !cached };
}

/** X1: a version is used only if it matches this (scripts/fetch-cli.mjs has the same pattern). */
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** X6: this plugin's version, from its own .claude-plugin/plugin.json (relative to the plugin root, never the environment), or null. */
export function pluginVersion(o = {}) {
  const c = ctx(o);
  try {
    const v = JSON.parse(c.readFile(c.path.join(placeOf(c).pluginRoot, '.claude-plugin', 'plugin.json')))?.version;
    return typeof v === 'string' && VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** X7 step 5: the source copy's CLI at `version`, `<ORBIT_HOME or ~/.orbit>/src/<version>/uplink/cli/bin/orbit.js` (as fetch-cli.mjs's copyOrbitJs). */
export function copyCliJs(version, o = {}) {
  const c = ctx(o);
  const home = c.env.ORBIT_HOME ? c.path.resolve(c.env.ORBIT_HOME) : c.path.join(c.homedir(), '.orbit');
  return c.path.join(home, 'src', version, 'uplink', 'cli', 'bin', 'orbit.js');
}

/** The version in a clone's uplink/cli/package.json, or null. */
function cloneVersion(dir, c) {
  try { return JSON.parse(c.readFile(c.path.join(dir, 'uplink', 'cli', 'package.json')))?.version ?? null; } catch { return null; }
}

/** `installLocation` of marketplace `mp` in `<pluginsRoot>/known_marketplaces.json`, or null. */
export function installLocation(pluginsRoot, mp, o = {}) {
  const c = ctx(o);
  try {
    const known = JSON.parse(c.readFile(c.path.join(pluginsRoot, 'known_marketplaces.json')));
    const loc = known?.[mp]?.installLocation;
    return typeof loc === 'string' && loc ? loc : null;
  } catch {
    return null;
  }
}

/** W15 steps 1 and 2: PATH's orbit, then the fallback folder → [{ step, js | bin }] candidates in order (not yet checked). */
function installedCandidates(c) {
  const out = [];
  const hit = which('orbit', c);
  if (c.win) {
    if (hit) out.push({ step: 1, js: layout(c.path.dirname(hit), c).orbitJs }); // the orbit.js beside the W4 hit
    const appData = Object.keys(c.env).find((k) => k.toUpperCase() === 'APPDATA');
    if (appData && c.env[appData]) out.push({ step: 2, js: layout(c.path.join(c.env[appData], 'npm'), c).orbitJs });
  } else {
    if (hit) out.push({ step: 1, bin: hit }); // the shim, as before
    const orbitHome = c.env.ORBIT_HOME || c.path.join(c.homedir(), '.orbit'); // V69
    out.push({ step: 2, bin: c.path.join(orbitHome, 'npm', 'bin', 'orbit') });
  }
  return out;
}

/**
 * W15 steps 3 and 4: the plugin's sibling ../cli, then the marketplace clone; §38 X7 step 5: the source copy at the plugin's version
 * → [{ step, js }] candidates in order. Outside the cache layout (a synced plugin) there is no installLocation or
 * <plugins root>/marketplaces/<mp>, and a cloneDirs() clone counts only when its uplink/cli/package.json version is the plugin's
 * (a stale clone from an earlier terminal install never wins over the plugin's own version). Nothing here fetches.
 */
function cloneCandidates(c) {
  const p = c.path;
  const { pluginRoot: root, pluginsRoot, marketplace } = placeOf(c);
  const version = pluginVersion(c);
  const inClone = (dir) => p.join(dir, 'uplink', 'cli', 'bin', 'orbit.js');
  const out = [{ step: 3, js: p.join(root, '..', 'cli', 'bin', 'orbit.js') }];
  if (marketplace) {
    const loc = installLocation(pluginsRoot, marketplace, c);
    if (loc) out.push({ step: 4, js: inClone(loc) });
    out.push({ step: 4, js: inClone(p.join(pluginsRoot, 'marketplaces', marketplace)) });
    for (const d of cloneDirs(undefined, c)) out.push({ step: 4, js: inClone(d) });
  } else if (version) {
    for (const d of cloneDirs(undefined, c)) if (cloneVersion(d, c) === version) out.push({ step: 4, js: inClone(d) });
  }
  if (version) out.push({ step: 5, js: copyCliJs(version, c) });
  const seen = new Set();
  return out.map((x) => ({ ...x, js: p.resolve(x.js) })).filter((x) => !seen.has(x.js) && seen.add(x.js));
}

/** The first candidate that is there: a .js must be a file; on POSIX a bin (steps 1 and 2) must be an executable file. */
function first(cands, c) {
  const tried = [];
  for (const x of cands) {
    const file = x.js ?? x.bin;
    tried.push(file);
    if (x.js ? c.isFile(file) : c.exists(file)) return { ...(x.js ? { js: x.js } : { bin: x.bin }), step: x.step, tried };
  }
  return { tried };
}

/**
 * W15: the CLI for the SessionStart hook, in order: 1 PATH's orbit (POSIX the shim; win32 the orbit.js beside the W4 hit), 2 the
 * fallback folder (POSIX ${ORBIT_HOME or ~/.orbit}/npm/bin/orbit; win32 layout(%APPDATA%\npm).orbitJs), 3 the plugin's sibling
 * ../cli/bin/orbit.js, 4 the marketplace clone (known_marketplaces.json's installLocation, <plugins root>/marketplaces/<mp>, then
 * cloneDirs(); for a synced plugin, cloneDirs() at the plugin's version only), 5 the source copy at the plugin's version (§38 X7;
 * the hook never fetches). → { js } (run it with process.execPath) or { bin } (POSIX: run it as it is), with `step` and `tried`
 * (every path looked at, in order); { tried } alone when there is none.
 */
export function findCli(o = {}) {
  try {
    const c = ctx(o);
    return first([...installedCandidates(c), ...cloneCandidates(c)], c);
  } catch {
    return { tried: [] }; // X7: nothing throws
  }
}

/** W17, §38 X6: the CLI for /orbit:orbit-setup, never PATH's: W15 steps 3, then 4, then X7's step 5. → { js, step, tried } or { tried }. */
export function findClone(o = {}) {
  try {
    const c = ctx(o);
    return first(cloneCandidates(c), c);
  } catch {
    return { tried: [] }; // X7: nothing throws
  }
}

/** The hook's line when no CLI is found (§38 X12, 0.13.2: W15's "unchanged" is superseded). */
export const NO_CLI_LINE = "Orbit: this device has no Orbit CLI yet. Fix: run /orbit:orbit-setup in Claude Code (the desktop app's Code tab, or a terminal).";

/** The hook's line when `status --hook` printed nothing (0.13.0's session-start.sh, unchanged); `rc` is its exit code, or `?`. */
export const printedNothingLine = (rc) => `Orbit: orbit status --hook printed nothing (exit ${rc}). Fix: run \`orbit status\` in a terminal and read its error.`;
