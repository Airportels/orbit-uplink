// orbit slot add --account <label> [--station s] [--key-to-stdout] [--json]          createSlot (§15.2, §33.4): mint a pool slot; Mission
//                                                                                   Control generates its id (obt-NNN), printed with the key once
// orbit slot rotate <seatId> [--key-to-stdout] [--json]                             rotateSlot: a fresh key (the old one dies at once), same seat id + doorbell
// orbit slot list [--station s] [--json]                                            listSlots: the station's slots as a table (no hash, no key; epoch + recycledAt, §16;
//                                                                                   the display name, Seat.name, beside the id, §33.4)
// orbit slot recycle <seatId> [--force] [--epoch <n>] [--station s] [--json]       recycleSlot (§16.3, §18): epoch + 1, the old session fenced; --force releases claimed/working
//                                                                                   tasks to ready; the epoch the admin saw goes as expectEpoch (--epoch, else read with listSlots)
// orbit slot prompt <seatId> [--json]                                               the paste instructions + the pool first prompt again (listSlots only; never a key, §16.5)
//
// §15.6, the key print rule: the key goes to the controlling terminal (/dev/tty), one marked line `SECRET  network secret value: <key>`;
// never to stdout unless --key-to-stdout; never into --json; never under $ORBIT_HOME; never to a log. The terminal is opened BEFORE
// the call that mints or rotates, so a key is never minted that nobody saw (without a terminal and without --key-to-stdout: exit 2,
// nothing called). Nothing here writes to disk.
import { openSync, writeSync, closeSync } from 'node:fs';
import { parseArgs } from '../args.js';
import { requirePerson } from '../store.js';
import { getIdToken } from '../auth.js';
import { personClient, mcBaseUrl } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { firstPrompt } from '../first-prompt.js';
import { stationFor } from './seat.js';

// §15.1 from 0.13.0 (§33.4, R8): a slot's id is generated, obt- plus 3 or more digits (obt-001); an old <word>-<n> id (orbit-1) stays
// valid as an id that already exists. Never a {handle}-{kind}-{n} seat id.
export const SLOT_NAME_RE = /^(obt-[0-9]{3,}|[a-z][a-z0-9]*-[1-9][0-9]*)$/;
const SEAT_LIKE_RE = /-(ground|orbiter)-\d+$/;
const USAGE = 'orbit slot add --account <label> [--station s] [--key-to-stdout] [--json] | orbit slot rotate <seatId> [--key-to-stdout] [--json] | orbit slot list [--station s] [--json] | orbit slot recycle <seatId> [--force] [--epoch <n>] [--station s] [--json] | orbit slot prompt <seatId> [--station s] [--json]';
const KEY_LINE = 'SECRET  network secret value: ';
const HINTS = {
  not_registered: 'run: orbit login',
  not_in_station: 'run: orbit login, or name the station with --station',
  not_admin: 'you are not an admin of this station; ask an admin', // Mission Control before 0.11.0 (not_allowed: errors.js)
  not_found: 'see: orbit slot list',
  not_a_slot: 'only pool slots rotate or recycle; a v0.2 orbiter re-enrols with its token (orbit seat add --cloud)',
  slot_busy: 'tasks are claimed or working on this slot: pass --force to release them to ready (the next session resumes them on their work branches, M9)',
  slot_retired: 'a retired slot stays retired; mint a new one: orbit slot add --account <label>',
};

/** §18.2: what `orbit slot recycle` prints when the slot moved on since the epoch it saw. */
export const epochChangedLine = (seatId, epoch) =>
  `${seatId} was already recycled (now epoch ${epoch}); nothing was done. Run the command again if you still need a fresh session.`;

/** `--epoch <n>`: an integer ≥ 0, else a usage error (exit 2). Absent → undefined. */
export function parseEpoch(v) {
  if (v === undefined) return undefined;
  const s = String(v);
  if (v === true || !/^(0|[1-9][0-9]*)$/.test(s) || !Number.isSafeInteger(Number(s))) {
    throw new OrbitError(`--epoch must be an integer ≥ 0 (the slot's epoch you saw in orbit slot list), got ${v === true ? 'nothing' : JSON.stringify(s)}\nusage: ${USAGE}`, { exitCode: 2 });
  }
  return Number(s);
}

/** §15.1's slot id (a generated obt-NNN, or an old <word>-<n> that exists): the id, else bad_slot_name. */
export function checkSlotName(name) {
  const n = String(name ?? '');
  if (n.length > 100 || !SLOT_NAME_RE.test(n) || SEAT_LIKE_RE.test(n)) {
    throw new OrbitError(`"${n}" is not a slot id: obt-<nnn> (or an existing <word>-<n>, never -ground-<n> or -orbiter-<n>)`, { exitCode: 2, code: 'bad_slot_name' });
  }
  return n;
}

/** §15.6: where the key will go, decided before the call. --key-to-stdout → stdout; else /dev/tty; else exit 2 (nothing is called). */
export function openKeySink({ keyToStdout = false } = {}) {
  if (keyToStdout) return { where: 'stdout', write: (s) => process.stdout.write(s), close: () => {} };
  let fd;
  try {
    fd = openSync('/dev/tty', 'w');
  } catch (e) {
    throw new OrbitError(`no terminal: the key is shown only on a terminal; use --key-to-stdout to override (/dev/tty: ${e.code ?? e.message})`, { exitCode: 2, code: 'no_terminal' });
  }
  return { where: 'terminal', write: (s) => writeSync(fd, s), close: () => closeSync(fd) };
}

/** One marked line, then the sink is closed. The key is never kept. */
export function writeKeyOnce(sink, key) {
  sink.write(`${KEY_LINE}${key}\n`);
  sink.close();
}

/** The §15.4 paste instructions (stdout). `prompt` is the pool first prompt (slot add); a rotate names only the secret to update. */
export function pasteBlock({ name, stationId, accountLabel, mcUrl, host, where, prompt = null, rotated = false, reprint = null }) {
  const shown = where === 'stdout' ? 'the SECRET line above' : 'the SECRET line on your terminal';
  const lines = [];
  if (reprint) lines.push(`Slot ${name} in station ${stationId} (pool account "${accountLabel}", slot ${reprint.slotState}, epoch ${reprint.epoch}): the paste instructions and the pool first prompt again. No key is shown: the key stays the environment's network secret (\`orbit slot rotate ${name}\` mints a new one).`);
  else if (rotated) lines.push(`Slot ${name}: a fresh key (the old key is dead as of now; seat id and doorbell kept). Nothing was written to this device.`);
  else lines.push(`Slot ${name} minted in station ${stationId} for the pool account "${accountLabel}" (seat id ${name}). Mission Control generated its id: name the cloud environment exactly ${name}. Nothing was written to this device.`);
  lines.push('');
  lines.push(reprint ? `The cloud environment "${name}" holds (the pool account's Claude Code › Cloud environments › ${name}):` : `Paste into the cloud environment "${name}" (the pool account's Claude Code › Cloud environments › ${name}${rotated ? ': replace the network secret\'s value' : ''}):`);
  lines.push('  Network secret (one; the proxy attaches it to every request to this host, the VM never sees it):');
  lines.push(`    Hosts:   ${host}   (exact; no wildcard)`);
  lines.push('    Header:  Authorization');
  lines.push('    Prefix:  "Bearer " (with the trailing space)');
  lines.push(`    Value:   ${reprint ? 'already set (the key was shown once at mint or rotate; unchanged)' : `the key shown once, ${shown}`}`);
  lines.push('  Environment variables:');
  lines.push(`    ORBIT_MC_URL=${mcUrl}`);
  lines.push('    (no ORBIT_ENROL_TOKEN: a slot has no token; the key never enters the VM)');
  lines.push('  Who can use it: only you (the admin signs in to the pool account; users never do).');
  if (reprint) lines.push(`Nothing to paste for the secret. After a recycle: archive the old session, start a new one in "${name}" with the three repos attached, then paste the first prompt below into it.`);
  else lines.push(`Paste, save, then clear this terminal's scrollback: the key exists nowhere else (Mission Control keeps its SHA-256 only); \`orbit slot rotate ${name}\` mints a new one and kills this one.`);
  if (prompt) {
    lines.push('');
    lines.push('----- preset A first prompt (pool slot): paste it into the new cloud session -----');
    lines.push(prompt);
    lines.push('----- end of first prompt -----');
  }
  return lines.join('\n');
}

function withHints(e) {
  if (e instanceof McError && HINTS[e.code] && !e.hint) e.hint = HINTS[e.code];
  return e;
}

function table(rows) {
  const cols = [
    ['seat id', (s) => s.id], ['name', (s) => (typeof s.name === 'string' && s.name ? s.name : '-')], // §33.4: Seat.name, the display name (slot.name stays the id)
    ['account', (s) => s.accountLabel ?? '-'], ['state', (s) => s.state ?? '-'],
    ['doorbell', (s) => (s.doorbell ? `${s.doorbell.repo}#${s.doorbell.pr}` : '-')], ['lastSeenAt', (s) => s.lastSeenAt ?? '-'],
    ['slot', (s) => s.slot?.state ?? '-'], ['epoch', (s) => String(s.slot?.epoch ?? 0)], ['recycledAt', (s) => s.slot?.recycledAt ?? '-'], ['bound', (s) => s.slot?.boundPersonUid ?? '-'],
  ];
  const cells = [cols.map(([h]) => h), ...rows.map((s) => cols.map(([, f]) => String(f(s))))];
  const w = cols.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  return cells.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  ').trimEnd()).join('\n');
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['key-to-stdout', 'json'] });
  const [sub, target] = args._;
  if (!['add', 'rotate', 'list', 'recycle', 'prompt'].includes(sub ?? '')) throw new OrbitError(`unknown subcommand "slot ${sub ?? ''}"\nusage: ${USAGE}`, { exitCode: 2 });
  const keyToStdout = Boolean(args['key-to-stdout']);
  let accountLabel = null;
  if (sub === 'add') {
    // §33.4 (v0.13.0): Mission Control generates the id; a name is refused before any call (Mission Control 0.13.0 refuses one too)
    if (target !== undefined) throw new OrbitError(`orbit slot add takes no name: Mission Control generates the slot's id (obt-NNN) and this command prints it\nusage: ${USAGE}`, { exitCode: 2 });
    accountLabel = args.account && args.account !== true ? String(args.account) : null;
    if (!accountLabel) throw new OrbitError('slot add needs --account <label> (which pool account the environment runs on)', { exitCode: 2 });
  }
  if (['rotate', 'recycle', 'prompt'].includes(sub) && !target) throw new OrbitError(`missing <seatId>\nusage: ${USAGE}`, { exitCode: 2 });
  const expectEpoch = sub === 'recycle' ? parseEpoch(args.epoch) : undefined;
  if (sub === 'rotate' && args.station !== undefined) throw new OrbitError(`orbit slot rotate takes no --station: it sends { seatId } and Mission Control looks the seat up in your stations (§15.4, M16)\nusage: ${USAGE}`, { exitCode: 2 });

  const person = requirePerson();
  const mcUrl = mcBaseUrl();
  const host = new URL(mcUrl).host;
  const mc = personClient(await getIdToken());

  if (sub === 'list') {
    const stationId = stationFor(args, person);
    let rows;
    try { rows = await mc.call('listSlots', { stationId }); } catch (e) { throw withHints(e); }
    rows = (Array.isArray(rows) ? rows : rows?.seats ?? []).map(({ keyHash, ...s }) => s); // no hash, whatever the server sent
    if (args.json) { console.log(JSON.stringify(rows)); return 0; }
    if (!rows.length) { console.log(`no slots in station ${stationId} (mint one: orbit slot add --account <label>)`); return 0; }
    console.log(table(rows));
    return 0;
  }

  if (sub === 'recycle') { // §16.3 / §16.5: no key involved (V25: recycling keeps the key; rotate is the leak path)
    const seatId = String(target);
    // §18.2: send the epoch the admin saw, so a recycle that someone else (or another terminal) already made is not repeated:
    // --epoch <n> as given; without it, the slot's epoch as listSlots shows it right now.
    let epoch = expectEpoch;
    if (epoch === undefined) {
      const stationId = stationFor(args, person);
      let rows;
      try { rows = await mc.call('listSlots', { stationId }); } catch (e) { throw withHints(e); }
      const s = (Array.isArray(rows) ? rows : rows?.seats ?? []).find((x) => x.id === seatId);
      if (!s) throw new OrbitError(`no slot ${seatId} in station ${stationId}`, { code: 'not_found', hint: 'see: orbit slot list' });
      epoch = Number.isInteger(s.slot?.epoch) ? s.slot.epoch : 0; // §16.1: absent reads as 0
    }
    let r;
    try {
      r = await mc.call('recycleSlot', { seatId, ...(args.force && { force: true }), expectEpoch: epoch });
    } catch (e) {
      if (e instanceof McError && e.code === 'epoch_changed') {
        const now = e.body?.error?.details?.epoch;
        if (args.json) console.log(JSON.stringify({ seatId, code: 'epoch_changed', expectEpoch: epoch, epoch: Number.isInteger(now) ? now : null }));
        else console.error(epochChangedLine(seatId, Number.isInteger(now) ? now : '?'));
        return 1;
      }
      throw withHints(e);
    }
    const released = Array.isArray(r?.released) ? r.released : [];
    if (args.json) { console.log(JSON.stringify({ seatId, epoch: r?.epoch ?? null, released, recycledAt: r?.slot?.recycledAt ?? null })); return 0; }
    console.log(`Slot ${seatId} recycled: epoch ${r?.epoch} (the old session is fenced: its next call is refused as stale_session); key and doorbell unchanged.`);
    console.log(released.length ? `released to ready: ${released.join(', ')} (the next session resumes them on their work branches)` : 'released to ready: nothing (no task was claimed or working)');
    console.log('Next:');
    console.log(`  1. Archive the old session in the pool account (Claude Code › Cloud › ${seatId}); it must not keep working.`);
    console.log(`  2. Start a new session in environment "${seatId}" with the three repos attached (Airportels/orbit-beacon, Airportels/orbit-factory, Airportels/orbit).`);
    console.log(`  3. Paste the pool first prompt into it: orbit slot prompt ${seatId}`);
    return 0;
  }
  if (sub === 'prompt') { // §16.5: listSlots only; the key is never shown again
    const seatId = String(target);
    const stationId = stationFor(args, person);
    let rows;
    try { rows = await mc.call('listSlots', { stationId }); } catch (e) { throw withHints(e); }
    const s = (Array.isArray(rows) ? rows : rows?.seats ?? []).find((x) => x.id === seatId);
    if (!s) throw new OrbitError(`no slot ${seatId} in station ${stationId}`, { code: 'not_found', hint: 'see: orbit slot list' });
    if (s.retiredAt || s.slot?.state === 'retired') throw new OrbitError(`slot ${seatId} is retired${s.retiredAt ? ` (${s.retiredAt})` : ''}; mint a new one: orbit slot add --account <label>`, { code: 'slot_retired' });
    const prompt = firstPrompt({ stationId, accountLabel: s.accountLabel ?? '', mcUrl, handle: person.handle, pool: true });
    if (args.json) { console.log(JSON.stringify({ seatId, stationId, accountLabel: s.accountLabel ?? null, host, epoch: s.slot?.epoch ?? 0, slot: s.slot?.state ?? null, prompt })); return 0; }
    console.log(pasteBlock({ name: seatId, stationId, accountLabel: s.accountLabel ?? '-', mcUrl, host, where: null, prompt, reprint: { epoch: s.slot?.epoch ?? 0, slotState: s.slot?.state ?? '-' } }));
    return 0;
  }

  const sink = openKeySink({ keyToStdout }); // before the call: a key nobody sees is never minted
  try {
    if (sub === 'add') {
      const stationId = stationFor(args, person);
      let r;
      try { r = await mc.call('createSlot', { stationId, accountLabel }); } catch (e) { throw withHints(e); } // §33.4: no slot
      if (!r?.seatId || !r?.seatKey) throw new OrbitError('createSlot returned no seat key', { code: 'bad_slot' });
      if (!SLOT_NAME_RE.test(String(r.seatId)) || SEAT_LIKE_RE.test(String(r.seatId))) throw new OrbitError(`createSlot returned "${String(r.seatId).slice(0, 100)}", which is not a slot id`, { code: 'bad_slot' });
      const name = r.seatId; // the generated id: the admin names the cloud environment exactly that
      writeKeyOnce(sink, r.seatKey);
      r = null; // the key is gone from here on
      if (args.json) { console.log(JSON.stringify({ seatId: name, slot: name, stationId, accountLabel, host })); return 0; }
      const prompt = firstPrompt({ stationId, accountLabel, mcUrl, handle: person.handle, pool: true });
      console.log(pasteBlock({ name, stationId, accountLabel, mcUrl, host, where: sink.where, prompt }));
      return 0;
    }
    // rotate
    const seatId = String(target);
    let r;
    try { r = await mc.call('rotateSlot', { seatId }); } catch (e) { throw withHints(e); } // { seatId } only (M16): Mission Control looks in the admin's stations
    if (!r?.seatId || !r?.seatKey) throw new OrbitError('rotateSlot returned no seat key', { code: 'bad_slot' });
    writeKeyOnce(sink, r.seatKey);
    const doorbell = r.doorbell ?? null;
    r = null;
    if (args.json) { console.log(JSON.stringify({ seatId, slot: seatId, host, doorbell, rotated: true })); return 0; }
    console.log(pasteBlock({ name: seatId, mcUrl, host, where: sink.where, rotated: true }));
    if (doorbell) console.log(`doorbell kept: ${doorbell.repo}#${doorbell.pr}; start a fresh session in the environment after the paste (the running one has no key any more).`);
    return 0;
  } catch (e) {
    try { sink.close(); } catch { /* already closed */ }
    throw e;
  }
}
