// orbit seat add --ground [--account <label>]      enrol this device's ground seat (person token → enrol token → enrolSeat)
// orbit seat add --cloud --account <label>         create a reusable orbiter seat token and print the preset first prompt (§10)
// orbit seat                                        show this device's seat (no key)
import { parseArgs } from '../args.js';
import { requirePerson, readSeat, writeSeat, paths, fileMode } from '../store.js';
import { getIdToken } from '../auth.js';
import { personClient, mcCall } from '../mc.js';
import { UPLINK_VERSION } from '../version.js';
import { OrbitError } from '../errors.js';
import { firstPrompt } from '../first-prompt.js';

export function stationFor(args, person) {
  const st = args.station || person.stationIds?.[0] || 'orbit';
  if (!person.stationIds?.includes(st)) throw new OrbitError(`you are not in station "${st}"`, { code: 'not_in_station', hint: 'run: orbit login' });
  return st;
}

/** The seat record from a whoami answer merged over what we know (station, role, account, doorbell, server contract). */
function mergeWhoami(seat, who) {
  const rec = who?.seat ?? {};
  if (!rec.stationId) throw new OrbitError('whoami returned no seat record for this key', { code: 'bad_whoami' });
  return {
    ...seat,
    stationId: rec.stationId,
    kind: rec.kind ?? seat.kind,
    role: rec.role ?? seat.role ?? 'worker',
    accountLabel: rec.accountLabel ?? seat.accountLabel ?? null,
    doorbell: seat.doorbell ?? rec.doorbell ?? null,
    serverContract: who?.contract ?? seat.serverContract ?? null,
  };
}

/**
 * enrolSeat (§5: { seatId, seatKey, doorbell? }), then whoami with the new key for the rest of the record (station, role, …).
 * The key exists nowhere else once enrolSeat answers (a ground token is spent, an orbiter key rotated), so seat.json is
 * written BEFORE whoami; a whoami failure keeps the stored key and comes back as `warning` (the next command that reaches
 * Mission Control completes the record, see completeSeat). `stationId` is the caller's fallback when it already knows it.
 */
export async function enrolWithToken({ token, kind, accountLabel, handle, stationId = null }) {
  const r = await mcCall('enrolSeat', { token, kind, accountLabel, uplinkVersion: UPLINK_VERSION });
  if (!r?.seatId || !r?.seatKey) throw new OrbitError('enrolSeat returned no seat', { code: 'bad_enrol' });
  const m = /^(.+)-(ground|orbiter)-\d+$/.exec(r.seatId);
  let seat = {
    seatId: r.seatId,
    seatKey: r.seatKey,
    stationId: stationId ?? null,
    kind,
    role: 'worker',
    accountLabel: accountLabel ?? null,
    handle: handle ?? (m ? m[1] : null),
    doorbell: r.doorbell ?? null,
    uplinkVersion: UPLINK_VERSION,
    serverContract: null,
    enrolledAt: new Date().toISOString(),
  };
  let p = writeSeat(seat);
  let warning = null;
  try {
    seat = mergeWhoami(seat, await mcCall('whoami', {}, { token: r.seatKey }));
    p = writeSeat(seat);
  } catch (e) {
    warning = `whoami after enrolment failed (${e.message}); the key is stored in ${p}${seat.stationId ? '' : ', station unknown until the next orbit command that reaches Mission Control'}`;
  }
  return { seat, path: p, doorbell: seat.doorbell, warning };
}

/** A stored seat whose enrolment never got its whoami answer (no stationId): ask once more and persist. Otherwise as is. */
export async function completeSeat(seat, { timeoutMs } = {}) {
  if (seat?.stationId) return seat;
  const full = mergeWhoami(seat, await mcCall('whoami', {}, { token: seat.seatKey, timeoutMs }));
  writeSeat(full);
  return full;
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['ground', 'cloud', 'token-in-prompt', 'force', 'json'] });
  const sub = args._[0];
  if (!sub) {
    const s = readSeat();
    if (!s) { console.log('no seat on this device (run: orbit seat add --ground)'); return 1; }
    console.log(`seat ${s.seatId} (${s.kind}, ${s.role}) · station ${s.stationId} · account ${s.accountLabel ?? '-'} · ${paths.seat()}${fileMode(paths.seat()) ? ` (mode ${fileMode(paths.seat())})` : ''}`); // §37 W21: no "(mode …)" on win32
    return 0;
  }
  if (sub !== 'add') throw new OrbitError(`unknown subcommand "seat ${sub}"`, { exitCode: 2, hint: 'orbit seat add --ground | --cloud --account <label>' });
  if (!args.ground && !args.cloud) throw new OrbitError('say which seat: --ground or --cloud', { exitCode: 2 });
  const person = requirePerson();
  const idToken = await getIdToken();
  const mc = personClient(idToken);
  const stationId = stationFor(args, person);

  if (args.ground) {
    const existing = readSeat();
    if (existing && !args.force) {
      console.log(`this device already has seat ${existing.seatId} (station ${existing.stationId}); use --force to enrol a new one`);
      return 0;
    }
    const accountLabel = String(args.account || 'ground');
    const t = await mc.call('createEnrolToken', { stationId, kind: 'ground' });
    if (!t?.token) throw new OrbitError('createEnrolToken returned no token', { code: 'bad_token' });
    const { seat, path, warning } = await enrolWithToken({ token: t.token, kind: 'ground', accountLabel, handle: person.handle, stationId });
    console.log(`enrolled ground seat ${seat.seatId} in station ${seat.stationId} (key stored in ${path}${fileMode(path) ? `, mode ${fileMode(path)}` : ''}, never shown)`); // §37 W21
    if (warning) console.error(`warning: ${warning}`);
    return 0;
  }

  // --cloud: a reusable 30-day orbiter seat token (M5). Nothing is written to disk for it.
  const accountLabel = args.account;
  if (!accountLabel || accountLabel === true) throw new OrbitError('--cloud needs --account <label> (which Claude account runs the orbiter)', { exitCode: 2 });
  const t = await mc.call('createEnrolToken', { stationId, kind: 'orbiter' });
  if (!t?.token) throw new OrbitError('createEnrolToken returned no token', { code: 'bad_token' });
  const mcUrl = process.env.ORBIT_MC_URL || (await import('../store.js')).readConfig().mcUrl || '<Mission Control base URL>';
  const inPrompt = Boolean(args['token-in-prompt']);
  const prompt = firstPrompt({ stationId, accountLabel, mcUrl, handle: person.handle, token: inPrompt ? t.token : null, expiresAt: t.expiresAt });
  const out = [];
  out.push(`Orbiter seat token for station ${stationId}, account "${accountLabel}" (reusable, expires ${t.expiresAt ?? 'in 30 days'}). Not written to disk.`);
  if (!inPrompt) {
    out.push(`Put it in the personal cloud environment's variables as ORBIT_ENROL_TOKEN (and ORBIT_MC_URL=${mcUrl}); the SessionStart hook enrols with it at session start (M10).`);
    out.push('');
    out.push(`  SECRET  ORBIT_ENROL_TOKEN=${t.token}`);
    out.push('');
  } else {
    out.push('The token is embedded in the prompt below (you chose --token-in-prompt); treat the whole prompt as a secret.');
    out.push('');
  }
  out.push('----- preset A first prompt: paste it into the new cloud session -----');
  out.push(prompt);
  out.push('----- end of first prompt -----');
  console.log(out.join('\n'));
  return 0;
}
