// What an own-repo send carries (CONTRACT §24.3, v0.10.0), on the device:
//   base  = the line's tip on the repo's remote, once this one branch is fetched (`git fetch <remote> <branch>`); a failed fetch
//           uses the last remote-tracking ref, and the send says so;
//   start = HEAD, only when it isn't base: the sender's commits not yet pushed ride on the task branch, never on the shared base;
//   line  = HEAD's upstream branch, else the remote's default branch (<remote>/HEAD), `--line <branch>` overriding both;
//   repo  = the repo's identity (24.2): host and path from the remote's URL, lowercased, with no scheme, user info, port or `.git`.
//   A repo with no remote: base = HEAD, no start, the line is the current branch, repo = null (Mission Control names it
//   local/{handle}/{project}, P1). Snapshot mode reads no base (24.3) and fetches nothing.
// A remote URL can hold a credential (https://x-access-token:…@host/…): it is read only to compute the identity, and no message
// here ever prints it or git's own error text about it.
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { git, currentBranch } from './git.js';
import { splitLines } from './platform.js';
import { OrbitError } from './errors.js';

export const FETCH_TIMEOUT_MS = 120_000;
const LINE_MAX = 60;

/** P2, a copy of Mission Control's projects/names.js lineFor: lowercase, [a-z0-9-] (`/` and the rest → `-`), runs collapsed, ends trimmed, ≤ 60. */
export function lineFor(branch) {
  if (typeof branch !== 'string' || branch.length < 1 || branch.length > 255) throw new OrbitError('the line must be a repo branch name of 1–255 characters', { code: 'bad_line', exitCode: 2 });
  const trim = (s) => s.replace(/^-+|-+$/g, '');
  const line = trim(trim(branch.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')).slice(0, LINE_MAX));
  if (!line) throw new OrbitError(`branch "${branch}" gives an empty line once written in [a-z0-9-]`, { code: 'bad_line', exitCode: 2 });
  return line;
}

const unusable = (why) => new OrbitError(`the remote's URL cannot name this repo for Orbit (${why})`, { code: 'bad_repo', exitCode: 2, hint: 'Orbit needs a host and a path (https://host/owner/name, git@host:owner/name, ssh://host/owner/name) or a local path; send with a remote that has one' });

/**
 * The repo identity of a remote URL (24.2), the value Mission Control's checkRepo accepts: `host/path`, lowercased, with no
 * scheme, user info, port, query, trailing `/` or `.git`. A local path (or file:// URL) is its absolute path without the leading
 * `/`. User info is stripped here, so a token in the URL never leaves the device; the URL itself is never put in an error.
 * `cwd` resolves a relative local path (git keeps it as configured).
 */
export function normalizeRepo(remoteUrl, { cwd = process.cwd() } = {}) {
  const s = String(remoteUrl ?? '').trim();
  if (!s) throw unusable('it is empty');
  let host = '';
  let path;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme && scheme[1].toLowerCase() !== 'file') {
    let rest = s.slice(scheme[0].length).replace(/[?#].*$/, '');
    const slash = rest.indexOf('/');
    const authority = slash < 0 ? rest : rest.slice(0, slash);
    path = slash < 0 ? '' : rest.slice(slash);
    host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/, ''); // user info and port dropped
    if (host.startsWith('[')) throw unusable('an IPv6 host');
  } else if (scheme) { // file://[host]/abs/path
    path = s.slice(scheme[0].length).replace(/^[^/]*/, '');
  } else if (/^[^/\\]+:/.test(s) && !/^[a-z]:[\\/]/i.test(s)) { // scp-like [user@]host:path
    const colon = s.indexOf(':');
    host = s.slice(0, colon).slice(s.slice(0, colon).lastIndexOf('@') + 1);
    path = `/${s.slice(colon + 1)}`;
  } else { // a local path
    const abs = s.startsWith('~/') ? resolve(homedir(), s.slice(2)) : isAbsolute(s) ? s : resolve(cwd, s);
    path = abs;
  }
  const parts = path.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw unusable('a path with ..');
  const id = [host, ...parts].filter(Boolean).join('/').toLowerCase().replace(/\.git$/, '');
  if (!id || /[@:\s\\]/.test(id)) throw unusable(/[\\]/.test(id) ? 'a Windows path' : 'no host and path');
  if (id.split('/').length < 2) throw unusable('no host and path');
  if (id.startsWith('local/')) throw unusable("local/ is Mission Control's own prefix for a repo with no remote");
  return id;
}

/** The remote and branch the work starts from: --line, else HEAD's upstream, else <remote>/HEAD. → { remote, branch, via }. */
function lineSource(repoPath, { remotes, current, lineArg }) {
  let remote = null;
  let branch = null;
  let via = null;
  if (current) {
    const r = git(repoPath, ['config', '--get', `branch.${current}.remote`], { allowFail: true });
    const m = git(repoPath, ['config', '--get', `branch.${current}.merge`], { allowFail: true });
    if (r && remotes.includes(r) && m?.startsWith('refs/heads/')) { remote = r; branch = m.slice('refs/heads/'.length); via = 'upstream'; }
  }
  remote ??= remotes.includes('origin') ? 'origin' : remotes[0];
  if (lineArg) return { remote, branch: lineArg, via: '--line' };
  if (branch) return { remote, branch, via };
  const sym = git(repoPath, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`], { allowFail: true });
  if (sym?.startsWith(`refs/remotes/${remote}/`)) return { remote, branch: sym.slice(`refs/remotes/${remote}/`.length), via: `${remote}/HEAD` };
  const out = git(repoPath, ['ls-remote', '--symref', remote, 'HEAD'], { allowFail: true, timeout: FETCH_TIMEOUT_MS });
  const m = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(out ?? '');
  if (m) return { remote, branch: m[1], via: `${remote}/HEAD` };
  throw new OrbitError(`cannot tell which branch of ${remote} this work starts from: ${current ? `${current} has no upstream` : 'HEAD is detached'} and ${remote}/HEAD is unknown`, { code: 'no_line', exitCode: 2, hint: `pass --line <branch> (a branch on ${remote}), or set an upstream: git branch -u ${remote}/<branch>` });
}

/**
 * §24.3 for `repoPath` → { remote, repo, branch, line, via, base?, start?, fetchWarning? }. `mode` "snapshot" reads no base and
 * fetches nothing; "full" fetches only the line's branch. Throws OrbitError (exit 2) when the line cannot be told or has no tip.
 */
export function resolveSendRefs({ repoPath, line: lineArg = null, mode = 'full' }) {
  const remotes = splitLines(git(repoPath, ['remote']) ?? '').filter(Boolean);
  const current = currentBranch(repoPath);
  const head = git(repoPath, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { allowFail: true });
  if (!head) throw new OrbitError('the repo has no commit yet: commit first, then send', { code: 'no_commit', exitCode: 2 });
  if (!remotes.length) { // P1: base = HEAD, the line is the current branch
    const branch = lineArg ?? current;
    if (!branch) throw new OrbitError('HEAD is detached and the repo has no remote: pass --line <branch> to name the line', { code: 'no_line', exitCode: 2 });
    return { remote: null, repo: null, branch, line: lineFor(branch), via: lineArg ? '--line' : 'the current branch (no remote)', ...(mode === 'full' && { base: head }) };
  }
  const { remote, branch, via } = lineSource(repoPath, { remotes, current, lineArg });
  const repo = normalizeRepo(git(repoPath, ['remote', 'get-url', remote], { allowFail: true }), { cwd: repoPath });
  const out = { remote, repo, branch, line: lineFor(branch), via };
  if (mode === 'snapshot') return out;
  let base = null;
  let fetchWarning;
  // only this branch; git's own error text is never shown (it can repeat the URL)
  if (git(repoPath, ['fetch', '-q', '--no-tags', remote, `refs/heads/${branch}`], { allowFail: true, timeout: FETCH_TIMEOUT_MS }) !== null) {
    base = git(repoPath, ['rev-parse', '--verify', '-q', 'FETCH_HEAD^{commit}'], { allowFail: true });
  }
  if (!base) {
    base = git(repoPath, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}^{commit}`], { allowFail: true });
    if (!base) throw new OrbitError(`could not fetch ${branch} from ${remote}, and this clone has no ${remote}/${branch} to fall back on`, { code: 'no_base', exitCode: 2, hint: `push ${branch} first, check the network, or name a branch on ${remote} with --line` });
    fetchWarning = `could not fetch ${branch} from ${remote}; using the last known ${remote}/${branch} (${base.slice(0, 12)})`;
  }
  return { ...out, base, ...(head !== base && { start: head }), ...(fetchWarning && { fetchWarning }) };
}
