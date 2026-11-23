// Factory conventions on the ground side (CONTRACT §6, §14.7): names, the pre-push check, and the git bundles that replace
// every push. `in.bundle` holds refs/heads/base (a subject: one root commit with README.md; an own-repo project: the HEAD with
// its history in full mode, or one root commit of the current tree in snapshot mode) and is built in a throw-away repo under
// $ORBIT_HOME/tmp whose objects/info/alternates points at the user's repo, so no ref is created in the user's repo. `orbit pull`
// reads `out.bundle` (refs/heads/work). The device holds no factory URL and no GitHub credential; nothing here pushes anywhere,
// deletes a branch or touches the user's origin.
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, ORBIT_GIT_IDENTITY, isClean, currentBranch } from './git.js';
import { orbitHome, ensureHome } from './store.js';
import { OrbitError } from './errors.js';
import { verifyBundle, verifyBundleHeads, SHA_RE } from './bundle.js';

export const LIMITS = { blobBytes: 95 * 1024 * 1024, packBytes: 500 * 1024 * 1024 };
export const NAME_RE = /^[a-z0-9-]+$/;
export const BASE_REF = 'refs/heads/base';
export const WORK_REF = 'refs/heads/work';
export const START_REF = 'refs/heads/start';

export function checkName(name, what = 'name') {
  if (!NAME_RE.test(String(name ?? ''))) throw new OrbitError(`${what} "${name}" must be [a-z0-9-]`, { exitCode: 2 });
  return name;
}

export function baseBranchFor({ handle, stationId, name }) {
  return `orbit/${checkName(handle, 'handle')}/${checkName(stationId, 'station')}/${checkName(name)}/base`;
}

/** A fresh directory under $ORBIT_HOME/tmp (0700). Callers remove it. */
export function tmpDir(prefix) {
  const base = join(ensureHome(), 'tmp');
  if (!existsSync(base)) mkdirSync(base, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(base, `${prefix}-`));
}

/** The pre-push check (§6): any blob > 95 MB in the history of `rev`, Git LFS in use, a pack > 500 MB, or a shallow clone → snapshot. */
export function prePushCheck(repoPath, rev = 'HEAD') {
  const reasons = [];
  const objects = git(repoPath, ['rev-list', '--objects', rev]);
  const info = git(repoPath, ['cat-file', '--batch-check=%(objecttype) %(objectsize) %(objectname) %(rest)'], { input: objects + '\n' });
  let largest = { bytes: 0, path: null };
  for (const line of info.split('\n')) {
    const [type, size, , ...rest] = line.split(' ');
    if (type !== 'blob') continue;
    const bytes = Number(size);
    if (bytes > largest.bytes) largest = { bytes, path: rest.join(' ') || null };
  }
  if (largest.bytes > LIMITS.blobBytes) reasons.push(`a file over 95 MB in history (${largest.path ?? 'blob'}: ${(largest.bytes / 1048576).toFixed(0)} MB)`);
  const attrFiles = (git(repoPath, ['ls-files', '-z', '--', '.gitattributes', '**/.gitattributes', '*/.gitattributes'], { allowFail: true }) ?? '').split('\0').filter(Boolean);
  const lfs = attrFiles.some((f) => { try { return /filter=lfs/.test(readFileSync(join(repoPath, f), 'utf8')); } catch { return false; } });
  if (lfs) reasons.push('Git LFS in use (.gitattributes has filter=lfs)');
  const counts = Object.fromEntries((git(repoPath, ['count-objects', '-v']) ?? '').split('\n').map((l) => l.split(': ')).filter((p) => p.length === 2));
  const packBytes = Number(counts['size-pack'] ?? 0) * 1024;
  if (packBytes > LIMITS.packBytes) reasons.push(`pack over 500 MB (${(packBytes / 1048576).toFixed(0)} MB)`);
  const shallow = git(repoPath, ['rev-parse', '--is-shallow-repository'], { allowFail: true }) === 'true';
  if (shallow) reasons.push('a shallow clone (its history is incomplete; a full bundle would have prerequisites)');
  return { mode: reasons.length ? 'snapshot' : 'full', reasons, largestBlob: largest, lfs, packBytes, shallow };
}

/** A throw-away repo that reads the user's objects through objects/info/alternates: refs/heads/base exists only here. */
function alternatesRepo(repoPath) {
  const dir = tmpDir('bundle');
  git(dir, ['init', '-q']);
  const objects = resolve(repoPath, git(repoPath, ['rev-parse', '--git-path', 'objects']));
  writeFileSync(join(dir, '.git', 'objects', 'info', 'alternates'), objects + '\n');
  return dir;
}

/** M1: the subject base as `in.bundle`: one orphan root commit holding README.md ("subject: <name>") under refs/heads/base. */
export function makeSubjectBundle({ name, out }) {
  const dir = tmpDir('subject');
  try {
    git(dir, ['init', '-q']);
    const blob = git(dir, ['hash-object', '-w', '--stdin'], { input: `subject: ${name}\n` });
    git(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},README.md`]);
    const tree = git(dir, ['write-tree']);
    const sha = git(dir, ['commit-tree', tree, '-m', `subject: ${name}`], { env: ORBIT_GIT_IDENTITY });
    git(dir, ['update-ref', BASE_REF, sha]);
    git(dir, ['bundle', 'create', '--quiet', out, BASE_REF]);
    const v = verifyBundle(out, BASE_REF, { repo: dir });
    return { mode: 'subject', sha, tree, size: v.size, file: out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The own-repo `in.bundle`. Built in an alternates repo, so the user's repo gets no ref and no object.
 * - §24.3 (`refs` from repo.js resolveSendRefs, a layout-2 send): full → refs/heads/base = refs.base, plus refs/heads/start =
 *   refs.start when it differs, both with full history; snapshot → refs/heads/start alone, one root commit of HEAD's tree.
 *   → { mode, sha (the tip: base, or the snapshot commit), start?, snapshotOf?, size, file }.
 * - §6, §14.2 (no `refs`: resuming a task created before §24): full → refs/heads/base = `rev` (HEAD) with its whole history;
 *   snapshot → one root commit of `rev`'s tree on refs/heads/base; the cloud seat chains it onto the remote base (M8, §14.6).
 * The snapshot root's message is `snapshot of <name> at <sha>: <subject>`, with the Orbit Uplink identity.
 */
export function makeRepoBundle({ repoPath, mode, name, out, rev = 'HEAD', refs = null }) {
  if (!['full', 'snapshot'].includes(mode)) throw new OrbitError('mode must be full or snapshot', { exitCode: 2 });
  const head = git(repoPath, ['rev-parse', `${rev}^{commit}`]);
  const dir = alternatesRepo(repoPath);
  try {
    if (refs) {
      let sha;
      let snapshotOf = null;
      const set = {};
      if (mode === 'snapshot') {
        const tree = git(repoPath, ['rev-parse', `${head}^{tree}`]);
        const subject = git(repoPath, ['log', '-1', '--format=%s', head]);
        sha = git(dir, ['commit-tree', tree, '-m', `snapshot of ${name ?? 'repo'} at ${head.slice(0, 12)}: ${subject}`], { env: ORBIT_GIT_IDENTITY });
        snapshotOf = head;
        set[START_REF] = sha;
      } else {
        sha = refs.base;
        set[BASE_REF] = refs.base;
        if (refs.start && refs.start !== refs.base) set[START_REF] = refs.start;
      }
      for (const [ref, at] of Object.entries(set)) git(dir, ['update-ref', ref, at]);
      git(dir, ['bundle', 'create', '--quiet', out, ...Object.keys(set)]);
      const v = verifyBundleHeads(out, Object.keys(set), { repo: dir });
      return { mode, sha, ...(set[START_REF] && { start: set[START_REF] }), snapshotOf, size: v.size, file: out };
    }
    let sha = head;
    let snapshotOf = null;
    if (mode === 'snapshot') {
      const tree = git(repoPath, ['rev-parse', `${rev}^{tree}`]);
      const subject = git(repoPath, ['log', '-1', '--format=%s', head]);
      sha = git(dir, ['commit-tree', tree, '-m', `snapshot of ${name ?? 'repo'} at ${head.slice(0, 12)}: ${subject}`], { env: ORBIT_GIT_IDENTITY });
      snapshotOf = head;
    }
    git(dir, ['update-ref', BASE_REF, sha]);
    git(dir, ['bundle', 'create', '--quiet', out, BASE_REF]);
    const v = verifyBundle(out, BASE_REF, { repo: dir });
    return { mode, sha, snapshotOf, size: v.size, file: out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fetchWork(repoPath, bundle) {
  git(repoPath, ['fetch', '-q', bundle, WORK_REF]);
  return git(repoPath, ['rev-parse', 'FETCH_HEAD']);
}

/**
 * §14.7: does out.bundle carry a snapshot history? True when nothing in the work branch's history is reachable from any ref of
 * the user's repo: a snapshot root (one root commit of the tree), not the repo's own commits. A full bundle, even one the orbiter
 * chained, descends from a commit the user sent. `orbit pull` asks this when Mission Control records `project.mode: full`, since a
 * resumed send may have switched to snapshot (the task keeps mode full on Mission Control) and the pull must land what was sent.
 * Should the `--not --all` count fail (it should not: an empty ref set is fine), the bundle counts as foreign and the pull falls
 * back to the snapshot path, which applies the orbiter's commits as patches rather than grafting an unknown history.
 */
export function bundleIsForeign({ repoPath, bundle }) {
  verifyBundle(bundle, WORK_REF, { repo: repoPath });
  const sha = fetchWork(repoPath, bundle);
  const total = Number(git(repoPath, ['rev-list', '--count', sha]));
  const unknown = Number(git(repoPath, ['rev-list', '--count', sha, '--not', '--all'], { allowFail: true }) ?? total);
  return unknown >= total;
}

/** full mode: local branch orbit/<taskId> = the work branch from out.bundle (its history includes the user's own commits). */
export function pullFullFromBundle({ repoPath, bundle, taskId, workBranch }) {
  verifyBundle(bundle, WORK_REF, { repo: repoPath });
  const local = `orbit/${taskId}`;
  const sha = fetchWork(repoPath, bundle);
  const newCommits = Number(git(repoPath, ['rev-list', '--count', sha, '--not', '--all'], { allowFail: true }) ?? 0);
  const localSha = git(repoPath, ['rev-parse', '--verify', '-q', `refs/heads/${local}`], { allowFail: true });
  if (localSha && localSha !== sha) {
    // a re-run must not discard commits the user made on orbit/<taskId> (M8 review item 4)
    const own = Number(git(repoPath, ['rev-list', '--count', `${sha}..${localSha}`], { allowFail: true }) ?? 0);
    if (own > 0) {
      throw new OrbitError(`local branch ${local} has ${own} commit${own === 1 ? '' : 's'} of your own that are not on ${workBranch}; orbit pull will not overwrite it`, { code: 'local_commits', hint: `rename it first (git branch -m ${local} ${local}-mine), then run orbit pull ${taskId} again` });
    }
  }
  if (currentBranch(repoPath) === local) {
    if (!isClean(repoPath)) throw new OrbitError(`${local} is checked out with local changes; commit or discard them first`, { code: 'dirty' });
    git(repoPath, ['merge', '-q', '--ff-only', sha]);
  } else {
    git(repoPath, ['branch', '-f', local, sha]);
  }
  return { branch: local, sha, newCommits };
}

/** §14.7: without links.base, the cut point is the first first-parent ancestor of work whose message lacks the `Orbit-Task: <taskId>` trailer. */
export function cutPointOf(repoPath, workSha, taskId) {
  const re = new RegExp(`^Orbit-Task:\\s*${taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  for (const sha of git(repoPath, ['rev-list', '--first-parent', workSha]).split('\n').filter(Boolean)) {
    if (!re.test(git(repoPath, ['log', '-1', '--format=%B', sha]))) return sha;
  }
  throw new OrbitError(`cannot tell where ${taskId}'s work branch was cut: the final report has no links.base and every commit carries the task trailer`, { code: 'no_base' });
}

/** snapshot mode: the orbiter's commits beyond the cut point (links.base, §14.4) applied as patches on a new branch orbit/<taskId> cut from HEAD. */
export function pullSnapshotFromBundle({ repoPath, bundle, taskId, workBranch, base = null }) {
  verifyBundle(bundle, WORK_REF, { repo: repoPath });
  const local = `orbit/${taskId}`;
  if (!isClean(repoPath)) throw new OrbitError('the working tree has uncommitted changes; commit or stash them before orbit pull', { code: 'dirty' });
  if (git(repoPath, ['rev-parse', '--verify', '-q', `refs/heads/${local}`], { allowFail: true })) {
    throw new OrbitError(`local branch ${local} already exists`, { code: 'branch_exists', hint: `switch to it, or rename it, then run orbit pull ${taskId} again` });
  }
  const workSha = fetchWork(repoPath, bundle);
  const baseSha = base && SHA_RE.test(String(base)) ? String(base) : cutPointOf(repoPath, workSha, taskId);
  if (git(repoPath, ['merge-base', '--is-ancestor', baseSha, workSha], { allowFail: true }) === null) {
    throw new OrbitError(`the reported base ${baseSha.slice(0, 12)} is not an ancestor of ${workBranch}`, { code: 'bad_base' });
  }
  const patchDir = tmpDir(`patches-${taskId}`);
  try {
    const list = git(repoPath, ['format-patch', '-q', '-o', patchDir, `${baseSha}..${workSha}`]);
    const patches = list ? list.split('\n').filter(Boolean) : readdirSync(patchDir).map((f) => join(patchDir, f)).sort();
    if (!patches.length) throw new OrbitError(`no commits on ${workBranch} beyond its base`, { code: 'nothing_to_pull' });
    const from = git(repoPath, ['rev-parse', 'HEAD']);
    git(repoPath, ['switch', '-q', '-c', local]);
    try {
      git(repoPath, ['am', '--3way', ...patches]);
    } catch (e) {
      git(repoPath, ['am', '--abort'], { allowFail: true });
      git(repoPath, ['switch', '-q', '-']);
      git(repoPath, ['branch', '-D', local], { allowFail: true });
      throw new OrbitError(`the orbiter's patches do not apply cleanly on HEAD (${e.message})`, { code: 'patch_failed', hint: `git fetch ${bundle} ${WORK_REF} and merge FETCH_HEAD by hand` });
    }
    return { branch: local, from, base: baseSha, applied: patches.length, sha: git(repoPath, ['rev-parse', 'HEAD']) };
  } finally {
    rmSync(patchDir, { recursive: true, force: true });
  }
}

/** no-repo subject: copy tasks/<taskId>/ from out.bundle's work branch into outDir (no repo on this side). */
export function pullSubjectFromBundle({ bundle, taskId, outDir }) {
  const dir = tmpDir(`subject-${taskId}`);
  try {
    git(dir, ['init', '-q']);
    verifyBundle(bundle, WORK_REF, { repo: dir });
    fetchWork(dir, bundle);
    const files = (git(dir, ['ls-tree', '-r', '--name-only', 'FETCH_HEAD', `tasks/${taskId}/`], { allowFail: true }) ?? '').split('\n').filter(Boolean);
    if (!files.length) throw new OrbitError(`the work branch has no files under tasks/${taskId}/`, { code: 'nothing_to_pull' });
    mkdirSync(outDir, { recursive: true });
    const tar = execFileSync('git', ['archive', '--format=tar', 'FETCH_HEAD', `tasks/${taskId}`], { cwd: dir, maxBuffer: 1024 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', outDir], { input: tar });
    return { outDir: join(outDir, 'tasks', taskId), files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function cleanupTmp() {
  rmSync(join(orbitHome(), 'tmp'), { recursive: true, force: true });
}
