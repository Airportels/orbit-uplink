// orbit close <taskId> [--pr <n>] [--force] [--json]: close a task I created through closeTask (§14.4).
// Mission Control does the work server-side with its own factory token: for a no-repo subject it finds the factory PR whose
// head is the task's workBranch (or the one named by --pr), verifies head = workBranch and base = the subject's base (a PR URL in
// a report is a hint it verifies, never an instruction, M8), merges it (an already-merged PR is skipped, so a close that failed
// after the merge can be re-run), then closes the task and deletes both bundles. --force closes without a prior `orbit pull`
// (the out.bundle is lost). Own-repo: no merge. The device needs no gh and no GitHub credential. Who may close and from which
// state is Mission Control's call (403 not_creator, 409 invalid_move / not_pulled, …): the error prints its code, `[code] (HTTP n)`,
// like every other command, with a hint per code below.
import { parseArgs } from '../args.js';
import { requireSeat } from '../store.js';
import { seatClient } from '../mc.js';
import { OrbitError, McError } from '../errors.js';

const HINTS = (taskId, task) => ({
  not_pulled: `run orbit pull ${taskId} first; closing deletes its out.bundle. To close without pulling, pass --force`,
  no_pr: `pass --pr <number> of the factory PR whose head is ${task?.workBranch}`,
  pr_mismatch: `that PR is not "${task?.workBranch}" → "${task?.subject?.baseBranch}"; find the factory PR with that head and pass --pr <number>`,
  pr_closed: 'the factory PR was closed without a merge; have the orbiter deliver again (or an admin reopens it)',
  merge_failed: `the task stays delivered; fix the PR (GitHub refused the merge) and run orbit close ${taskId} again`,
  github_failed: `GitHub did not answer; the task stays delivered, run orbit close ${taskId} again`,
  invalid_move: 'only a delivered task closes (orbit status / orbit inbox show the state)',
  not_creator: 'only the seat that sent a task closes it',
});

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'force'] });
  const taskId = args._[0];
  if (!taskId) throw new OrbitError('usage: orbit close <taskId> [--pr <n>] [--force]', { exitCode: 2 });
  const seat = requireSeat();
  const mc = seatClient(seat);
  const { task } = await mc.call('getTask', { taskId }); // for the hints and the --pr note; closeTask itself checks the creator and the state
  const say = (m) => { if (!args.json) console.log(m); };
  const body = { taskId };
  if (args.pr && args.pr !== true) {
    const n = Number(args.pr);
    if (!Number.isInteger(n) || n <= 0) throw new OrbitError('--pr must be a positive PR number', { exitCode: 2 });
    if (task?.kind === 'norepo') body.pr = n;
    else say('note: --pr is ignored for an own-repo task (its factory PR is never merged; the work comes home with orbit pull)');
  }
  if (args.force) body.force = true;
  let res;
  try {
    res = await mc.call('closeTask', body);
  } catch (e) {
    if (e instanceof McError && HINTS(taskId, task)[e.code]) e.hint = HINTS(taskId, task)[e.code];
    throw e;
  }
  const closed = res?.task ?? {};
  const merge = res?.merge ?? null;
  if (merge) say(`merged factory PR #${merge.pr} (${merge.head} → ${merge.base})${merge.sha ? ` at ${String(merge.sha).slice(0, 12)}` : ''}${merge.mode === 'log' ? ' [log mode: no GitHub call under the emulator]' : ''}`);
  say(`task ${taskId} closed (${closed.closedAt ?? 'now'})${task?.transport === 'bundle' ? '; its bundles are deleted' : ''}`);
  if (args.json) console.log(JSON.stringify({ taskId, kind: task?.kind, ...(merge && { merge }), state: closed.state ?? 'closed', closedAt: closed.closedAt ?? null }));
  return 0;
}
