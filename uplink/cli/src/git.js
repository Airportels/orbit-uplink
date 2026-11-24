// Synchronous git plumbing helpers. Every call is `git -C <cwd> ...` with prompts off; nothing here pushes to a user's origin.
// §37 (v0.13.1): git runs by the absolute path PATH gives (W6d: platform.gitBin, never a bare `git`, so a git.exe in a repo's root
// never runs on Windows); its output splits on \r?\n (W7); a fetch or ls-remote also sets GCM_INTERACTIVE=0 (W26: Git Credential
// Manager never opens a window).
import { execFileSync } from 'node:child_process';
import { OrbitError } from './errors.js';
import { gitBin, splitLines } from './platform.js';

/** W26: the calls that may reach a remote, which Git Credential Manager must never answer with a window. */
const NO_GCM = new Set(['fetch', 'ls-remote']);

export const ORBIT_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Orbit Uplink',
  GIT_AUTHOR_EMAIL: 'uplink@orbit.invalid',
  GIT_COMMITTER_NAME: 'Orbit Uplink',
  GIT_COMMITTER_EMAIL: 'uplink@orbit.invalid',
};

export function git(cwd, args, { input, env, allowFail = false, maxBuffer = 256 * 1024 * 1024, timeout, platform } = {}) {
  // W6d: git's absolute path first, outside the try, so a missing git is no_git for every caller (allowFail ones too), with nothing
  // spawned; `platform` is platform.js's context (tests)
  const bin = gitBin(platform);
  try {
    const out = execFileSync(bin, args, {
      cwd,
      input,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(NO_GCM.has(args[0]) && { GCM_INTERACTIVE: '0' }), ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer,
      ...(timeout && { timeout }),
    });
    return out.replace(/\r?\n$/, '');
  } catch (e) {
    if (allowFail) return null;
    const full = (e.stderr || e.stdout || e.message || '').toString().trim();
    const msg = splitLines(full).filter((l) => !/^hint:/.test(l)).slice(-3).join(' ') || splitLines(full).slice(-3).join(' ');
    const err = new OrbitError(`git ${args.slice(0, 2).join(' ')} failed: ${msg}`, { code: 'git_failed' });
    err.stderr = full;
    throw err;
  }
}

export function isGitRepo(dir) {
  return git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }) === 'true';
}

export function repoRoot(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']);
}

export function currentBranch(dir) {
  return git(dir, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true });
}

export function isClean(dir) {
  return (git(dir, ['status', '--porcelain', '--untracked-files=no']) ?? '') === '';
}
