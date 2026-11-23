// orbit pull <taskId> [--repo <path>] [--out <dir>] [--json]: bring the work home from out.bundle (§14.7).
// getResultDownload → GET to $ORBIT_HOME/tmp/<taskId>-out.bundle → verify (refs/heads/work, complete history) → own-repo full:
// local branch orbit/<taskId>; own-repo snapshot: the orbiter's commits beyond the cut point (links.base) as patches on a new
// branch orbit/<taskId>; no-repo subject: tasks/<taskId>/ copied into --out (default ./orbit-pull). The bundle file is deleted
// afterwards. Uplink never pushes to the user's origin and holds no factory URL. The mode comes from the task, except that a
// task recorded `full` whose bundle carries a snapshot history (a resumed send switched modes; Mission Control keeps `full`) is
// pulled as a snapshot, and says so.
import { rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from '../args.js';
import { requireSeat } from '../store.js';
import { seatClient } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { pullFullFromBundle, pullSnapshotFromBundle, pullSubjectFromBundle, bundleIsForeign, tmpDir } from '../factory.js';
import { getBundle } from '../bundle.js';
import { isGitRepo, repoRoot } from '../git.js';

function hinted(e, taskId) {
  if (e instanceof McError) {
    if (e.code === 'no_bundle') e.hint = `the orbiter has not uploaded out.bundle for ${taskId} yet (its final or blocked report names it); check orbit inbox`;
    if (e.code === 'bundle_gone') e.hint = `the bundle is gone (the 7-day lifecycle, or the task was closed); ask the orbiter to deliver again, or re-send the task`;
  }
  return e;
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const taskId = args._[0];
  if (!taskId) throw new OrbitError('usage: orbit pull <taskId> [--repo <path>] [--out <dir>]', { exitCode: 2 });
  const seat = requireSeat();
  const mc = seatClient(seat);
  const { task, reports } = await mc.call('getTask', { taskId });
  if (!task) throw new OrbitError(`no task ${taskId}`);
  if (task.transport !== 'bundle') throw new OrbitError(`task ${taskId} is a v0.1 push task (no bundles); this Uplink pulls from bundles only`, { code: 'push_task', hint: 'its work branch stays in the factory; close the task with orbit close' });
  if (!task.bundles?.out) throw new OrbitError(`task ${taskId} is ${task.state} and has no out.bundle yet; nothing to pull`, { exitCode: 1 });
  const say = (m) => { if (!args.json) console.log(m); };
  // the report that claimed out.bundle (final, or blocked) carries links.base, the sha the work branch was cut from (§14.4)
  const claiming = [...(reports ?? [])].reverse().find((r) => ['final', 'blocked'].includes(r.kind) && r.links?.bundle === 'out') ?? [...(reports ?? [])].reverse().find((r) => r.kind === 'final');
  const base = claiming?.links?.base ?? null;

  const dir = tmpDir(`pull-${taskId}`);
  const file = join(dir, `${taskId}-out.bundle`);
  try {
    let dl;
    try { dl = await mc.call('getResultDownload', { taskId }); } catch (e) { throw hinted(e, taskId); }
    const got = await getBundle(dl.download, file, { remint: async () => (await mc.call('getResultDownload', { taskId })).download });
    say(`out.bundle: ${got.bytes} bytes (refs/heads/work = ${task.workBranch})`);
    let out;
    if (task.kind === 'ownrepo') {
      const repoPath = resolve(args.repo && args.repo !== true ? String(args.repo) : process.cwd());
      if (!isGitRepo(repoPath)) throw new OrbitError(`${repoPath} is not a git repository; pass --repo <path to project ${task.project?.name}>`, { exitCode: 2 });
      const root = repoRoot(repoPath);
      let mode = task.project?.mode ?? 'full';
      const recorded = mode;
      if (mode === 'full' && bundleIsForeign({ repoPath: root, bundle: file })) { // a resumed send switched to snapshot; the task still says full
        mode = 'snapshot';
        say(`note: Mission Control records ${taskId} as mode full, but out.bundle carries a snapshot history (the send was resumed as a snapshot); pulling it as a snapshot`);
      }
      if (mode === 'full') {
        out = pullFullFromBundle({ repoPath: root, bundle: file, taskId, workBranch: task.workBranch });
        say(`pulled ${task.workBranch} (full) → local branch ${out.branch} at ${out.sha.slice(0, 12)} (${out.newCommits} new commit${out.newCommits === 1 ? '' : 's'}). Review it, then merge it yourself; Orbit never pushes to your origin. A re-run refuses to overwrite commits of your own on ${out.branch}.`);
      } else {
        out = pullSnapshotFromBundle({ repoPath: root, bundle: file, taskId, workBranch: task.workBranch, base });
        say(`pulled ${task.workBranch} (snapshot) → ${out.applied} patch${out.applied === 1 ? '' : 'es'} applied on new branch ${out.branch} (from ${out.from.slice(0, 12)}, now ${out.sha.slice(0, 12)}; you are on it; cut point ${out.base.slice(0, 12)}${base ? '' : ', found by the Orbit-Task trailer'}). Orbit never pushes to your origin.`);
      }
      out = { ...out, mode, ...(recorded !== mode && { recordedMode: recorded }), repo: root };
    } else {
      const outDir = resolve(args.out && args.out !== true ? String(args.out) : 'orbit-pull');
      out = pullSubjectFromBundle({ bundle: file, taskId, outDir });
      say(`pulled ${task.workBranch} → ${out.outDir} (${out.files.length} file${out.files.length === 1 ? '' : 's'}: ${out.files.map((f) => f.replace(`tasks/${taskId}/`, '')).slice(0, 8).join(', ')}${out.files.length > 8 ? ', …' : ''})`);
    }
    if (task.after?.taskId) say(`stacked after ${task.after.taskId}: its work is in ${task.workBranch} too (the orbiter cut this task from it); review them together, or pull ${task.after.taskId} first`);
    if (claiming?.links?.pr) say(`factory PR: ${claiming.links.pr}`);
    if (args.json) console.log(JSON.stringify({ taskId, kind: task.kind, workBranch: task.workBranch, bundle: { bytes: got.bytes, base }, ...(task.after && { after: task.after }), ...out }));
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true }); // the bundle file never outlives the command
  }
}
