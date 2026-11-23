// Synchronous git plumbing helpers. Every call is `git -C <cwd> ...` with prompts off; nothing here pushes to a user's origin.
import { execFileSync } from 'node:child_process';
import { OrbitError } from './errors.js';

export const ORBIT_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Orbit Uplink',
  GIT_AUTHOR_EMAIL: 'uplink@orbit.invalid',
  GIT_COMMITTER_NAME: 'Orbit Uplink',
  GIT_COMMITTER_EMAIL: 'uplink@orbit.invalid',
};

export function git(cwd, args, { input, env, allowFail = false, maxBuffer = 256 * 1024 * 1024, timeout } = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      input,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer,
      ...(timeout && { timeout }),
    });
    return out.replace(/\n$/, '');
  } catch (e) {
    if (allowFail) return null;
    const full = (e.stderr || e.stdout || e.message || '').toString().trim();
    const msg = full.split('\n').filter((l) => !/^hint:/.test(l)).slice(-3).join(' ') || full.split('\n').slice(-3).join(' ');
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
