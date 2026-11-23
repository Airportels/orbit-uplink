// orbit inbox [--json] [--limit N] [--all] [--fyi] [--items-limit N] [--station s]: my open items first (CONTRACT §20, v0.8.0:
// listItems with the person token, in Mission Control's order: a blocked task's item, then go and decision, then action, then wake
// and alert; FYIs only with --fyi), then the tasks I created and the tasks assigned to me, newest first, with their latest report.
// Without a sign-in (orbit login) the tasks still show and the items line says why they could not be read. `--json` prints
// { items, handles, more?, tasks } (`items` null and `itemsError` when they could not be read); `tasks` is what `--json` printed
// before §20 (an array).
import { parseArgs } from '../args.js';
import { requireSeat, readPerson } from '../store.js';
import { seatClient, personClient } from '../mc.js';
import { getIdToken } from '../auth.js';
import { stationFor } from './seat.js';
import { formatItems, listMyItems, withItemHints } from '../items.js';

const tasksOf = (x) => (Array.isArray(x) ? x : x?.tasks ?? []);
const latest = (reports) => [...(reports ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
const when = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) + 'Z' : '');

export async function fetchInbox(seat, { limit = 50, all = false } = {}) {
  const mc = seatClient(seat);
  const [mine, created] = await Promise.all([mc.call('listTasks', { assignedTo: 'me' }), mc.call('listTasks', { createdBy: 'me' })]);
  const byId = new Map();
  for (const t of [...tasksOf(mine), ...tasksOf(created)]) byId.set(t.id, t);
  let tasks = [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : -1));
  if (!all) tasks = tasks.filter((t) => !['closed', 'cancelled'].includes(t.state));
  tasks = tasks.slice(0, limit);
  const details = await Promise.all(tasks.map((t) => mc.call('getTask', { taskId: t.id }).catch(() => null)));
  return tasks.map((t, i) => {
    const d = details[i];
    return { task: d?.task ?? t, latestReport: latest(d?.reports), notes: d?.notes?.length ?? 0, side: t.createdBy?.seatId === seat.seatId ? 'created' : 'assigned' };
  });
}

/**
 * The person's open items (one page, Mission Control's order) → { items, handles, more }, or { items: null, error } when there is
 * no sign-in or the call failed: the tasks still show.
 */
export async function fetchItems(args, { fyi = false, limit = 50 } = {}) {
  const person = readPerson();
  if (!person) return { items: null, error: { code: 'not_signed_in', message: 'no person sign-in on this device', hint: 'run: orbit login' } };
  try {
    const stationId = stationFor(args, person);
    const mc = personClient(await getIdToken());
    const r = await listMyItems(mc, stationId, { fyi, limit });
    return { items: r.items ?? [], handles: r.handles ?? {}, more: Boolean(r.next) };
  } catch (e) {
    withItemHints(e);
    return { items: null, error: { code: e.code ?? 'error', message: e.message, ...(e.hint && { hint: e.hint }) } };
  }
}

export function formatInbox(items, seat) {
  if (!items.length) return `inbox empty for ${seat.seatId} (no open tasks created by or assigned to me)`;
  const lines = [];
  for (const { task: t, latestReport: r, notes, side } of items) {
    const who = side === 'created' ? `→ ${t.assignedSeatId}` : `← ${t.createdBy?.seatId ?? '?'}`;
    const what = t.kind === 'norepo' ? `subject ${t.subject?.name}` : `project ${t.project?.name} (${t.project?.mode ?? 'full'})`;
    lines.push(`${t.id}  ${t.state.padEnd(9)}  ${who}  ${what}  "${t.title}"  ${when(t.updatedAt)}${notes ? `  ${notes} note${notes === 1 ? '' : 's'}` : ''}${t.after?.taskId && t.state !== 'waiting' ? `  after ${t.after.taskId}` : ''}`);
    if (t.state === 'waiting') lines.push(`        waiting on ${t.after?.taskId ?? '?'}; it starts when that task delivers${t.after?.auto ? ' (stacked by Mission Control: the same folders)' : ''}`);
    else if (t.state === 'sending') lines.push(`        in.bundle not confirmed (an interrupted send): orbit send --resume ${t.id}${t.kind === 'ownrepo' ? ' --repo <path>' : ''}`);
    else if (r) {
      const did = (r.did ?? []).slice(-2).join('; ');
      lines.push(`        ${r.kind} by ${r.seatId} ${when(r.createdAt)}${r.state ? ` · state: ${r.state}` : ''}${did ? ` · did: ${did}` : ''}${r.need ? ` · need: ${r.need}` : ''}${r.next ? ` · next: ${r.next}` : ''}${r.links?.pr ? ` · pr ${r.links.pr}` : ''}${r.links?.branch ? ` · branch ${r.links.branch}` : ''}`);
    } else lines.push('        (no report yet)');
  }
  return lines.join('\n');
}

const num = (v, dflt) => (v !== undefined && v !== true ? Number(v) : dflt);

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'all', 'fyi'] });
  const seat = requireSeat();
  const itemsLimit = num(args['items-limit'], 50);
  if (!Number.isInteger(itemsLimit) || itemsLimit < 1 || itemsLimit > 100) throw Object.assign(new Error('--items-limit must be an integer from 1 to 100'), { exitCode: 2 });
  const [tasks, items] = await Promise.all([
    fetchInbox(seat, { limit: num(args.limit, 50), all: Boolean(args.all) }),
    fetchItems(args, { fyi: Boolean(args.fyi), limit: itemsLimit }),
  ]);
  if (args.json) {
    console.log(JSON.stringify({
      items: items.items,
      ...(items.items ? { handles: items.handles, ...(items.more && { more: true }) } : { itemsError: items.error }),
      tasks: tasks.map((i) => ({ ...i.task, latestReport: i.latestReport, side: i.side, notes: i.notes })),
    }, null, 2));
    return 0;
  }
  const out = items.items
    ? formatItems(items.items, { more: items.more, fyi: Boolean(args.fyi) })
    : [`items: not shown (${items.error.message})${items.error.hint ? `; ${items.error.hint}` : ''}`];
  out.push('', 'tasks:', formatInbox(tasks, seat));
  console.log(out.join('\n'));
  return 0;
}
