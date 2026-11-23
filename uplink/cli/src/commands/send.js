// orbit send <orbiterId> --title "…" [--brief-file f | --brief "…"] (--subject <name> | --repo <path> --project <name>
//            [--mode full|snapshot] [--line <branch>] [--after <taskId>] [--touches a/,b/] [--install-cmd c] [--test-cmd c])
//            [--space <spaceId>] [--review-by x] [--json]
// orbit send --resume <taskId> [--repo <path>] [--json]
// orbit send --help
// §32.1 line 9 (v0.12.0, the manager's R1): `--space <spaceId>` names the station (a space, §25) the task lives in: createTask takes
// `spaceId` (§25.3), and without it Mission Control files the task in the sender's personal space. Its refusals read: 404 "you
// aren't in that station", 409 station_archived and too_many_open_here in words. `--json` carries the task's spaceId. The flag
// isn't `--station`, which names Mission Control's station elsewhere in the CLI (seat, slot, admin, answer, clear).
// §24 (v0.10.0): Mission Control builds every name. An own-repo send carries `base` (the line's tip on the repo's remote, after
// fetching that one branch) plus `start` (HEAD, when it isn't base: commits not yet pushed), or `start` alone in snapshot mode
// (one root commit of HEAD's tree); a subject carries its root commit as `base` (24.3, src/repo.js). The input is project
// { name, branch, repo, mode, installCmd?, testCmd? } or subject { name }, without baseBranch; the answer names baseBranch, line and
// workBranch, which are printed. The repo identity never holds a credential: user info is stripped from the remote's URL and the
// URL is never printed.
// §14.7: in.bundle is built in a throw-away repo under $ORBIT_HOME/tmp → createTask { transport: "bundle" } (the task is `sending`;
// the upload comes back minted) → PUT → confirmUpload (→ ready; Mission Control rings the assignee). The device never touches the
// factory. A failure after createTask says `orbit send --resume <taskId>`, which rebuilds the bundle, re-mints the upload
// (createUpload), PUTs and confirms; a task created before §24 (no `layout`) resumes with its §6 bundle, as before.
// §24.5: `--after <taskId>` stacks the task on one of your own tasks in the same project; `--touches a/,b/` (one comma-separated
// value: a repeated flag keeps only the last) names the folders it writes (absent: the whole repo). Mission Control's folder check
// may stack it by itself (after, auto) or refuse it (folder_busy: the ids, and both ways out). A waiting send says so.
import { readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from '../args.js';
import { requireSeat } from '../store.js';
import { seatClient } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { makeSubjectBundle, makeRepoBundle, prePushCheck, checkName, tmpDir } from '../factory.js';
import { resolveSendRefs } from '../repo.js';
import { putBundle } from '../bundle.js';
import { isGitRepo, repoRoot, isClean } from '../git.js';
import { completeSeat } from './seat.js';

const USAGE = 'orbit send <orbiterId> --title "…" [--brief-file f | --brief "…"] (--subject <name> | --repo <path> --project <name> [--mode full|snapshot] [--line <branch>] [--after <taskId>] [--touches a/,b/]) [--space <id>] | orbit send --resume <taskId> [--repo <path>]';
export const SEND_HELP = `usage: orbit send <orbiterId> --title "…" (--subject <name> | --repo <path> --project <name>) [options]
       orbit send --resume <taskId> [--repo <path>]

  --title "…"           the task's title (≤ 120 characters)
  --brief-file <f>      the brief, from a file (or --brief "…"; default: the title)
  --subject <name>      a no-repo task: its result lands in the factory under the subject
  --repo <path>         an own-repo task: the repo it works on (with --project <name>)
  --project <name>      the project's name in the station
  --mode full|snapshot  how the repo's history travels (default: the pre-push check decides)
  --line <branch>       the repo branch whose shared base the task starts from (default: the current branch)
  --after <taskId>      stack on one of your own tasks in the same project (§24.5)
  --touches a/,b/       the folders the task writes (default: the whole repo)
  --space <id>          the station (a space) the task lives in (default: your own; see orbit stations)
  --install-cmd <c>, --test-cmd <c>, --review-by <x>
  --resume <taskId>     finish an interrupted send
  --json                one JSON line: the task, its branches, its spaceId and the bundle
`;
const s12 = (sha) => String(sha).slice(0, 12);

/** in.bundle for a spec: { kind: "norepo", subject: { name } } or { kind: "ownrepo", project: { name, mode }, repoPath, refs? }. */
function buildBundle(spec, out, say) {
  if (spec.kind === 'norepo') {
    const b = makeSubjectBundle({ name: spec.subject.name, out });
    say(`subject ${spec.subject.name}: in.bundle holds one root commit (README.md, ${s12(b.sha)}, ${b.size} bytes)`);
    return b;
  }
  const b = makeRepoBundle({ repoPath: spec.repoPath, mode: spec.project.mode, name: spec.project.name, out, refs: spec.refs ?? null });
  if (!spec.refs) say(`project ${spec.project.name}: in.bundle in ${b.mode} mode (${s12(b.sha)}${b.snapshotOf ? `, snapshot of ${s12(b.snapshotOf)}` : ''}, ${b.size} bytes)`);
  else if (b.mode === 'snapshot') say(`project ${spec.project.name}: in.bundle in snapshot mode (start ${s12(b.sha)}, snapshot of ${s12(b.snapshotOf)}, ${b.size} bytes; the shared base is not read)`);
  else {
    const r = spec.refs;
    const from = r.remote ? `${r.remote}/${r.branch}` : `${r.branch} (no remote: base is HEAD)`;
    say(`project ${spec.project.name}: in.bundle in full mode (base ${s12(b.sha)} from ${from}${b.start ? `, start ${s12(b.start)} = HEAD, ahead of it` : ''}; ${b.size} bytes)`);
  }
  return b;
}

/** --line, the pre-push check and §24.3's refs for an own-repo send → { mode, refs }. */
function ownRepoRefs({ root, args, say, line = null, mode: given = null, resumed = false }) {
  const check = prePushCheck(root, 'HEAD');
  const mode = given ?? (args.mode && args.mode !== true ? String(args.mode) : check.mode);
  if (!['full', 'snapshot'].includes(mode)) throw new OrbitError('--mode must be full or snapshot', { exitCode: 2 });
  if (mode === 'full' && check.mode === 'snapshot') {
    if (resumed) throw new OrbitError(`this task was sent in full mode, but the repo now fails the pre-push check (${check.reasons.join('; ')})`, { exitCode: 2, hint: 'cancel it and send again (it then goes in snapshot mode)' });
    throw new OrbitError(`--mode full refused: ${check.reasons.join('; ')}`, { exitCode: 2, hint: 'use --mode snapshot (or leave --mode out)' });
  }
  if (check.mode === 'snapshot' && mode === 'snapshot' && !args.mode && !given) say(`pre-push check: switching to snapshot mode (${check.reasons.join('; ')})`);
  const refs = resolveSendRefs({ repoPath: root, line: line ?? (args.line && args.line !== true ? String(args.line) : null), mode });
  if (refs.fetchWarning) say(`note: ${refs.fetchWarning}`);
  return { mode, refs };
}

async function uploadAndConfirm({ mc, taskId, upload, file, say }) {
  const remint = async () => {
    say('the upload URL was refused or the network failed once; minting a fresh one');
    return (await mc.call('createUpload', { taskId })).upload;
  };
  const put = await putBundle(upload, file, { remint });
  say(`in.bundle uploaded (${put.bytes} bytes); confirming…`);
  const conf = await mc.call('confirmUpload', { taskId });
  return { put, conf };
}

function print(result, args) {
  if (args.json) { const { task, ...rest } = result; console.log(JSON.stringify({ ...rest, ...(task?.after && { after: task.after }) })); return; }
  console.log(`task ${result.taskId} ${result.resumed ? 'resumed and ' : ''}sent to ${result.orbiterId}: "${result.title}"`);
  if (result.spaceId) console.log(`station (space): ${result.spaceId}`);
  console.log(`bundle: ${result.bundle.mode}, ${result.bundle.size} bytes, tip ${s12(result.bundle.tip)}${result.bundle.start && result.bundle.start !== result.bundle.tip ? `, start ${s12(result.bundle.start)}` : ''} (confirmed; the orbiter lands it on ${result.base.branch})`);
  if (result.layout === 2) {
    console.log(`baseBranch: ${result.baseBranch}`);
    console.log(`line: ${result.line}`);
  }
  for (const l of stackLines(result.task)) console.log(l);
  console.log(`taskId: ${result.taskId}`);
  console.log(`workBranch: ${result.workBranch}`);
  if (result.ring) console.log(result.ring.ok ? `ring: ok (${result.ring.target}${result.ring.mode ? `, ${result.ring.mode}` : ''})` : `ring: failed (${result.ring.error}); the orbiter will see the task on its next poll`);
  console.log('next: arm `orbit watch` as a background command (skill orbit-watch); it exits when the orbiter reports.');
}

/** §25.3's refusals of `--space` (§32.1 line 9), in words: → an OrbitError, or null when `e` isn't one of them. */
function spaceRefusal(e, { space, after }) {
  if (!(e instanceof McError) || !space) return null;
  const words = {
    not_found: [`you aren't in that station: ${space} isn't a station (a space) of yours`, 'see orbit stations for the ones you are in'],
    station_archived: [`that station is archived: ${space} takes no new tasks`, 'send it to another station (orbit stations), or leave --space out for your own'],
    too_many_open_here: [`you have too many open tasks in that station: ${space} is at its limit (maxOpen)`, 'close or cancel one of your tasks there first, or send it to another station'],
  }[e.code];
  if (!words) return null;
  if (e.code === 'not_found' && after && !/space/i.test(e.message)) return null; // --after's 404 (a task of yours), not the space's
  return new OrbitError(words[0], { code: e.code, exitCode: 1, hint: words[1] });
}

/** createTask's §24 refusals, with what to do next (the codes and details are Mission Control's, §24.2, 24.5, 24.6). */
function withSendHints(e, { after, space }) {
  const words = spaceRefusal(e, { space, after });
  if (words) return words;
  if (!(e instanceof McError)) return e;
  const d = (e.body && typeof e.body === 'object' ? e.body.error?.details : null) ?? {};
  const ids = Array.isArray(d.taskIds) ? d.taskIds : [];
  switch (e.code) {
    case 'folder_busy':
      e.hint = `your busy task${ids.length === 1 ? '' : 's'} ${ids.join(', ')} write${ids.length === 1 ? 's' : ''} the same folders on this line. Stack on one with --after <id> (${ids.join(' or ')}), or narrow --touches to folders ${ids.length === 1 ? 'it does' : 'they do'} not write`;
      break;
    case 'repo_registered': e.hint = `this repo is the station's project "${d.project}": send with --project ${d.project}`; break;
    case 'project_taken': e.hint = `"${d.project}" already names another repo (or a no-repo subject) in this station: pick another --project`; break;
    case 'line_clash': e.hint = `line "${d.line}" of this project already comes from another branch of the repo: send from that branch, or name another with --line`; break;
    case 'orbiter_too_old': e.hint = 'that orbiter runs an Uplink below 0.10.0 and cannot take a task on a shared base: it updates at its next session start; send to another orbiter meanwhile'; break;
    case 'bad_after': e.hint = '--after names one of your own full-mode own-repo tasks in the same project, not cancelled'; break;
    case 'not_found': if (after) e.hint = `--after ${after}: no such task of yours`; break;
    case 'bad_touches': e.hint = 'one comma-separated value of folder prefixes relative to the repo root, each ending in /, like --touches console/,docs/'; break;
    default: break;
  }
  return e;
}

/** --after and --touches for a --repo send (§24.5) → { after?, touches? }. */
function stacking(args, hasSubject) {
  const out = {};
  for (const flag of ['after', 'touches']) {
    if (args[flag] === undefined) continue;
    if (hasSubject) throw new OrbitError(`--${flag} is for --repo sends (a subject's tasks never stack and share no folders)`, { exitCode: 2 });
    if (args[flag] === true || String(args[flag]).trim() === '') throw new OrbitError(`--${flag} needs a value\nusage: ${USAGE}`, { exitCode: 2 });
  }
  if (args.after !== undefined) out.after = String(args.after).trim();
  if (args.touches !== undefined) out.touches = String(args.touches).split(',').map((x) => x.trim()).filter(Boolean);
  return out;
}

/** The lines a send prints about its stacking: waiting, auto-stacked, or blocked at once. */
function stackLines(task) {
  const lines = [];
  if (task?.state === 'waiting' && task.after?.taskId) {
    lines.push(`waiting on ${task.after.taskId}; it starts when that task delivers`);
    if (task.after.auto) lines.push(`(stacked by Mission Control: it writes the same folders as your busy ${task.after.taskId}; --touches can let tasks run side by side)`);
  } else if (task?.state === 'blocked') {
    lines.push('blocked: the task it was to wait for was cancelled (see orbit inbox); re-ready it to start from your own sent code, or cancel it');
  } else if (task?.after?.taskId) {
    lines.push(`stacked after ${task.after.taskId} (delivered): the orbiter starts from its work`);
  }
  return lines;
}

const bundleOf = (b) => ({ size: b.size, tip: b.sha, mode: b.mode, ...(b.start && { start: b.start }), ...(b.snapshotOf && { snapshotOf: b.snapshotOf }) });

async function resume({ args, seat, mc, say }) {
  const taskId = String(args.resume);
  const { task } = await mc.call('getTask', { taskId });
  if (task.createdBy?.seatId !== seat.seatId) throw new OrbitError(`task ${taskId} was created by ${task.createdBy?.seatId}, not by this seat`, { exitCode: 1 });
  if (task.transport !== 'bundle') throw new OrbitError(`task ${taskId} is a v0.1 push task; nothing to resume`, { exitCode: 1 });
  const layout2 = task.layout === 2;
  const baseBranch = task.subject?.baseBranch ?? task.project?.baseBranch;
  if (['ready', 'waiting'].includes(task.state) && task.bundles?.in) {
    say(`task ${taskId} is already ${task.state} (in.bundle ${task.bundles.in.size} bytes, tip ${s12(task.bundles.in.tip)}, confirmed ${task.bundles.in.uploadedAt}); nothing to resume`);
    if (args.json) console.log(JSON.stringify({ orbiterId: task.assignedSeatId, title: task.title, stationId: task.stationId, spaceId: task.spaceId ?? null, taskId, workBranch: task.workBranch, state: task.state, resumed: false, already: true, bundle: { size: task.bundles.in.size, tip: task.bundles.in.tip } }));
    return 0;
  }
  if (task.state !== 'sending') throw new OrbitError(`task ${taskId} is ${task.state}, not sending; only an interrupted send resumes`, { exitCode: 1 });
  let spec;
  if (task.kind === 'norepo') spec = { kind: 'norepo', subject: { name: task.subject.name } };
  else {
    const repoPath = resolve(args.repo && args.repo !== true ? String(args.repo) : process.cwd());
    if (!isGitRepo(repoPath)) throw new OrbitError(`${repoPath} is not a git repository; pass --repo <path to project ${task.project.name}>`, { exitCode: 2 });
    const root = repoRoot(repoPath);
    if (layout2) { // §24.3 again, on the line the task was registered with
      const { mode, refs } = ownRepoRefs({ root, args, say, line: task.project.branch, mode: task.project.mode ?? 'full', resumed: true });
      spec = { kind: 'ownrepo', project: { name: task.project.name, mode }, repoPath: root, refs };
    } else {
      let mode = task.project.mode ?? 'full';
      const check = prePushCheck(root, 'HEAD'); // the repo may have changed since createTask (a clone made shallow, a big blob)
      if (mode === 'full' && check.mode === 'snapshot') {
        say(`pre-push check: switching to snapshot mode (${check.reasons.join('; ')}); the task keeps mode full on Mission Control`);
        mode = 'snapshot';
      }
      spec = { kind: 'ownrepo', project: { name: task.project.name, mode }, repoPath: root };
    }
  }
  const dir = tmpDir('send');
  const file = join(dir, 'in.bundle');
  try {
    const bundle = buildBundle(spec, file, say);
    const { upload } = await mc.call('createUpload', { taskId });
    const { conf } = await uploadAndConfirm({ mc, taskId, upload, file, say });
    const result = { orbiterId: task.assignedSeatId, title: task.title, stationId: task.stationId, spaceId: conf.task?.spaceId ?? task.spaceId ?? null, taskId, workBranch: task.workBranch, ...(layout2 && { layout: 2, baseBranch, line: task.project?.line ?? 'main' }), state: conf.task?.state ?? 'ready', resumed: true, bundle: bundleOf(bundle), base: { branch: baseBranch, sha: bundle.sha, mode: bundle.mode }, ring: conf.ring ?? null, ...(spec.refs?.fetchWarning && { fetchWarning: spec.refs.fetchWarning }), ...(conf.already && { already: true }), task: conf.task };
    print(result, args);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'allow-dirty', 'help'], aliases: { h: 'help' } });
  if (args.help) { process.stdout.write(SEND_HELP); return 0; } // before the seat: help needs none
  const say = (m) => { if (!args.json) console.log(m); };
  if (args.space !== undefined && (args.space === true || String(args.space).trim() === '')) throw new OrbitError(`--space needs a station (a space) id\nusage: ${USAGE}`, { exitCode: 2 });
  if (args.space !== undefined && args.resume) throw new OrbitError('--space is for a new send: a resumed task keeps the station it was sent to', { exitCode: 2 });
  const space = args.space !== undefined ? String(args.space).trim() : undefined;
  const seat = await completeSeat(requireSeat()); // a seat enrolled while whoami was down has no station yet
  const mc = seatClient(seat);
  if (args.resume && args.resume !== true) return resume({ args, seat, mc, say });

  const orbiterId = args._[0];
  if (!orbiterId) throw new OrbitError(`missing <orbiterId>\nusage: ${USAGE}`, { exitCode: 2 });
  const title = args.title && args.title !== true ? String(args.title) : null;
  if (!title) throw new OrbitError(`missing --title\nusage: ${USAGE}`, { exitCode: 2 });
  if (title.length > 120) throw new OrbitError(`title is ${title.length} chars; the limit is 120`, { exitCode: 2 });
  let brief;
  if (args['brief-file'] && args['brief-file'] !== true) brief = readFileSync(String(args['brief-file']), 'utf8');
  else if (args.brief && args.brief !== true) brief = String(args.brief);
  else brief = title;
  if (brief.length > 20000) throw new OrbitError(`brief is ${brief.length} chars; the limit is 20,000`, { exitCode: 2 });
  const hasSubject = args.subject && args.subject !== true;
  const hasRepo = args.repo && args.repo !== true;
  if (hasSubject === hasRepo) throw new OrbitError(`say one of --subject <name> or --repo <path> --project <name>\nusage: ${USAGE}`, { exitCode: 2 });
  if (hasSubject && args.line !== undefined) throw new OrbitError('--line is for --repo sends (a subject\'s line is always main)', { exitCode: 2 });
  const stack = stacking(args, hasSubject);

  const stationId = seat.stationId;
  let spec, body, root = null, refs = null;
  if (hasSubject) {
    const name = checkName(String(args.subject), 'subject');
    spec = { kind: 'norepo', subject: { name } };
    body = { kind: 'norepo', subject: { name } };
  } else {
    const name = checkName(String(args.project), 'project');
    const repoPath = resolve(String(args.repo));
    if (!isGitRepo(repoPath)) throw new OrbitError(`${repoPath} is not a git repository`, { exitCode: 2 });
    root = repoRoot(repoPath);
    if (!isClean(root) && !args['allow-dirty']) say('note: the working tree has uncommitted changes; only committed work (HEAD) is sent');
    let mode;
    ({ mode, refs } = ownRepoRefs({ root, args, say }));
    const project = { name, branch: refs.branch, repo: refs.repo, mode };
    if (args['install-cmd'] && args['install-cmd'] !== true) project.installCmd = String(args['install-cmd']);
    if (args['test-cmd'] && args['test-cmd'] !== true) project.testCmd = String(args['test-cmd']);
    spec = { kind: 'ownrepo', project: { name, mode }, repoPath: root, refs };
    body = { kind: 'ownrepo', project };
  }

  const dir = tmpDir('send');
  const file = join(dir, 'in.bundle');
  try {
    const bundle = buildBundle(spec, file, say);
    let created;
    try {
      created = await mc.call('createTask', {
        transport: 'bundle',
        stationId,
        title,
        brief,
        ...body,
        ...stack,
        ...(space !== undefined && { spaceId: space }), // §32.1 line 9: createTask takes it (§25.3)
        assignedSeatId: orbiterId,
        reviewBy: args['review-by'] && args['review-by'] !== true ? String(args['review-by']) : null,
      });
    } catch (e) { throw withSendHints(e, { ...stack, space }); }
    if (!created?.taskId) throw new OrbitError('createTask returned no task', { code: 'bad_answer' });
    const taskId = created.taskId;
    if (!created.upload?.url) throw new OrbitError(`Mission Control created ${taskId} but minted no upload: it speaks a contract below 0.2`, { code: 'mc_too_old', hint: 'Mission Control must run contract 0.2.0 for the bundle transport (§14)' });
    if (!created.baseBranch) throw new OrbitError(`Mission Control created ${taskId} without naming its base: it speaks a contract below 0.10.0`, { code: 'mc_too_old', hint: 'cancel it (it is "sending"), and update Mission Control to contract 0.10.0 (§24) before this Uplink sends' });
    say(`task ${taskId} created (sending); uploading in.bundle…`);
    let conf;
    try {
      ({ conf } = await uploadAndConfirm({ mc, taskId, upload: created.upload, file, say }));
    } catch (e) {
      e.hint = `${e.hint ? `${e.hint}. ` : ''}Task ${taskId} is still "sending": run orbit send --resume ${taskId}${root ? ` --repo ${root}` : ''} to upload again`;
      throw e;
    }
    const result = { orbiterId, title, stationId, spaceId: conf.task?.spaceId ?? space ?? null, taskId, workBranch: created.workBranch, layout: 2, baseBranch: created.baseBranch, line: created.line, state: conf.task?.state ?? 'ready', bundle: bundleOf(bundle), base: { branch: created.baseBranch, sha: bundle.sha, mode: bundle.mode }, ring: conf.ring ?? null, ...(refs?.fetchWarning && { fetchWarning: refs.fetchWarning }), ...(stack.touches && { touches: stack.touches }), ...(conf.already && { already: true }), task: conf.task };
    print(result, args);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
