// orbit enrol [--if-needed] [--token <t>] [--kind orbiter|ground] [--account <label>]
// The cloud seat's path (§10): the SessionStart hook enrols with ORBIT_ENROL_TOKEN at session start (M10: the setup script only
// installs tools), a reusable orbiter seat token (M5). --if-needed does
// nothing when seat.json already exists. The token is never printed.
import { parseArgs } from '../args.js';
import { readSeat, paths, fileMode } from '../store.js';
import { OrbitError } from '../errors.js';
import { enrolWithToken } from './seat.js';

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['if-needed', 'ground', 'orbiter'] });
  const existing = readSeat();
  if (existing && args['if-needed']) {
    console.log(`seat ${existing.seatId} already enrolled on this device (${paths.seat()}); nothing to do`);
    return 0;
  }
  const token = (args.token && args.token !== true ? String(args.token) : process.env.ORBIT_ENROL_TOKEN || '').trim();
  if (!token) throw new OrbitError('no enrol token', { code: 'no_token', exitCode: 2, hint: 'set ORBIT_ENROL_TOKEN (an environment secret) or pass --token' });
  const kind = args.ground ? 'ground' : args.kind && args.kind !== true ? String(args.kind) : 'orbiter';
  const accountLabel = String(args.account || process.env.ORBIT_ACCOUNT_LABEL || (kind === 'orbiter' ? 'cloud' : 'ground'));
  const { seat, path, doorbell, warning } = await enrolWithToken({ token, kind, accountLabel });
  console.log(`enrolled ${kind} seat ${seat.seatId} in station ${seat.stationId ?? 'unknown'} (key stored in ${path}${fileMode(path) ? `, mode ${fileMode(path)}` : ''}, never shown)`); // §37 W21: no mode on win32
  if (warning) console.error(`warning: ${warning}`);
  if (doorbell) console.log(`doorbell already registered: ${doorbell.repo}#${doorbell.pr} (a re-enrolment; the key was rotated)`);
  else if (kind === 'orbiter') console.log('no doorbell yet: open your draft PR in Airportels/orbit-beacon and register it through heartbeat (first prompt, §10)');
  return 0;
}
