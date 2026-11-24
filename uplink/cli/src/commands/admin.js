// orbit admin seats [--all] [--station s] [--json]                      listSeats (§16.3): every seat of the station as a table; retired ones with --all
// orbit admin cancel <taskId> --reason "…" [--station s] [--json]       adminCancelTask: any state but closed / cancelled → cancelled, whoever created it
// orbit admin retire <seatId> [--force] [--yes] [--station s] [--json]  retireSeat: the key dies at once, the seat is offline + retired (a slot: slot.state retired)
//
// Person calls (§15.2's admin gate: not_registered / not_in_station / not_admin). Retiring cannot be undone, so `retire` asks on
// the controlling terminal (/dev/tty) unless --yes; without a terminal and without --yes it exits 2 before any call. Nothing here
// prints a key or a hash, and nothing is written to disk.
import { openSync, readSync, writeSync, closeSync } from 'node:fs';
import { parseArgs } from '../args.js';
import { requirePerson } from '../store.js';
import { getIdToken } from '../auth.js';
import { personClient } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { stationFor } from './seat.js';
import { isWindows } from '../platform.js';

/** §37 W26: Windows has no /dev/tty to ask on: exit 2 no_terminal, and say what to do instead. */
export const WIN_NO_TERMINAL = 'no terminal to confirm on: on Windows there is no /dev/tty to ask on. Retire seats from a Mac, or pass --yes to retire without a question';

const USAGE = 'orbit admin seats [--all] [--station s] [--json] | orbit admin cancel <taskId> --reason "<text>" [--station s] [--json] | orbit admin retire <seatId> [--force] [--yes] [--station s] [--json]';
const HINTS = {
  not_registered: 'run: orbit login',
  not_in_station: 'run: orbit login, or name the station with --station',
  not_admin: 'you are not an admin of this station; ask an admin', // Mission Control before 0.11.0 (not_allowed: errors.js)
  not_found: 'see: orbit admin seats --all (seats) or orbit inbox --all (tasks)',
  seat_busy: 'tasks are claimed or working on this seat: pass --force to cancel them (reason "seat retired"), or cancel them first with orbit admin cancel',
  already_retired: 'a retired seat stays retired; nothing to do',
  invalid_move: 'a closed or cancelled task stays as it is',
};

function withHints(e) {
  if (e instanceof McError && HINTS[e.code] && !e.hint) e.hint = HINTS[e.code];
  return e;
}

/** A yes/no question on the controlling terminal; exit 2 without one (pass --yes to skip the question), and always on win32 (W26). */
export function confirmOnTerminal(question, o = {}) {
  if (isWindows(o)) throw new OrbitError(WIN_NO_TERMINAL, { exitCode: 2, code: 'no_terminal' });
  let fd;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch (e) {
    throw new OrbitError(`no terminal to confirm on; pass --yes to retire without a question (/dev/tty: ${e.code ?? e.message})`, { exitCode: 2, code: 'no_terminal' });
  }
  try {
    writeSync(fd, `${question} [y/N] `);
    const buf = Buffer.alloc(64);
    let answer = '';
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      answer += buf.toString('utf8', 0, n);
      if (answer.includes('\n')) break;
    }
    return /^\s*y(es)?\s*$/i.test(answer.split('\n')[0]);
  } finally {
    closeSync(fd);
  }
}

function table(rows) {
  const cols = [
    ['id', (s) => s.id], ['kind', (s) => s.kind ?? '-'], ['account', (s) => s.accountLabel ?? '-'], ['state', (s) => s.state ?? '-'],
    ['lastSeenAt', (s) => s.lastSeenAt ?? '-'], ['slot', (s) => s.slot?.state ?? '-'], ['epoch', (s) => (s.slot ? String(s.slot.epoch ?? 0) : '-')],
    ['retired', (s) => s.retiredAt ?? '-'],
  ];
  const cells = [cols.map(([h]) => h), ...rows.map((s) => cols.map(([, f]) => String(f(s))))];
  const w = cols.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  return cells.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  ').trimEnd()).join('\n');
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['all', 'force', 'yes', 'json'] });
  const [sub, target] = args._;
  if (!['seats', 'cancel', 'retire'].includes(sub ?? '')) throw new OrbitError(`unknown subcommand "admin ${sub ?? ''}"\nusage: ${USAGE}`, { exitCode: 2 });
  if (sub !== 'seats' && !target) throw new OrbitError(`missing <${sub === 'cancel' ? 'taskId' : 'seatId'}>\nusage: ${USAGE}`, { exitCode: 2 });
  let reason = null;
  if (sub === 'cancel') {
    reason = args.reason && args.reason !== true ? String(args.reason) : '';
    if (reason.length < 1 || reason.length > 200) throw new OrbitError(`admin cancel needs --reason "<text>" (1–200 chars; it goes into the task's event)\nusage: ${USAGE}`, { exitCode: 2 });
  }
  const person = requirePerson();
  const station = args.station && args.station !== true ? String(args.station) : null; // optional: Mission Control looks in the admin's stations without it (M16)
  const say = (m) => { if (!args.json) console.log(m); };

  if (sub === 'retire' && !args.yes) {
    if (!confirmOnTerminal(`Retire seat ${target}? Its key dies at once and the id is never reused; this cannot be undone.`)) {
      say(`not retired: ${target}`);
      return 1;
    }
  }
  const mc = personClient(await getIdToken());

  if (sub === 'seats') {
    const stationId = stationFor(args, person);
    let rows;
    try { rows = await mc.call('listSeats', { stationId, ...(args.all && { includeRetired: true }) }); } catch (e) { throw withHints(e); }
    rows = (Array.isArray(rows) ? rows : rows?.seats ?? []).map(({ keyHash, ...s }) => s); // no hash, whatever the server sent
    if (args.json) { console.log(JSON.stringify(rows)); return 0; }
    if (!rows.length) { console.log(`no seats in station ${stationId}`); return 0; }
    console.log(table(rows));
    return 0;
  }
  if (sub === 'cancel') {
    const taskId = String(target);
    let t;
    try { t = await mc.call('adminCancelTask', { taskId, reason, ...(station && { stationId: station }) }); } catch (e) { throw withHints(e); }
    const task = t?.task ?? t ?? {};
    if (args.json) { console.log(JSON.stringify({ taskId, state: task.state ?? 'cancelled', reason, ...(task.ring && { ring: task.ring }) })); return 0; }
    console.log(`task ${taskId} cancelled (reason: "${reason}")${task.assignedSeatId ? `; its assignee ${task.assignedSeatId}` : ''}${task.ring ? (task.ring.ok ? ' was rung' : ` could not be rung (${task.ring.error})`) : ' was not on it'}${task.transport === 'bundle' ? '; its bundles are deleted' : ''}.`);
    return 0;
  }
  // retire
  const seatId = String(target);
  let r;
  try { r = await mc.call('retireSeat', { seatId, ...(args.force && { force: true }), ...(station && { stationId: station }) }); } catch (e) { throw withHints(e); }
  const released = Array.isArray(r?.released) ? r.released : [];
  if (args.json) { console.log(JSON.stringify({ seatId, retiredAt: r?.retiredAt ?? null, released })); return 0; }
  console.log(`seat ${seatId} retired at ${r?.retiredAt ?? 'now'}: its key is dead (401 from now), state offline, the id is never reused.`);
  console.log(released.length ? `cancelled (reason "seat retired"): ${released.join(', ')}` : 'cancelled: nothing (no task was claimed or working on it)');
  return 0;
}
