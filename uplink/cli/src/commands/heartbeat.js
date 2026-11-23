// orbit heartbeat [--state idle|working|offline] [--doorbell <pr>] [--usage <0..1>] [--five-hour <0..1>] [--weekly-resets <iso>]
//                 [--five-hour-resets <iso>] [--json]   (§8 plumbing, M8; §26.1 usage, CONTRACT 0.11.0)
// One heartbeat for this seat; orbiters register their doorbell with it (§10 step 4). The doorbell repo is always the beacon.
// Usage (§26.1): --usage is the weekly figure (weeklyUtilization), --five-hour the 5-hour window's (fiveHourUtilization), both 0–1;
// --weekly-resets and --five-hour-resets are ISO-8601 times (weeklyResetsAt, fiveHourResetsAt). Checked here first (exit 2), as
// Mission Control checks them (400). An orbiter's figures then feed its cloud account (§26.1).
import { parseArgs } from '../args.js';
import { requireSeat, readSeat, writeSeat } from '../store.js';
import { seatClient } from '../mc.js';
import { UPLINK_VERSION } from '../version.js';
import { OrbitError } from '../errors.js';

const USAGE = 'orbit heartbeat [--state idle|working|offline] [--doorbell <pr>] [--usage <0..1>] [--five-hour <0..1>] [--weekly-resets <iso>] [--five-hour-resets <iso>] [--json]';
const given = (v) => v !== undefined && v !== true;

/** A 0–1 figure from a flag, or undefined when the flag is absent. */
export function figureFlag(v, flag) {
  if (v === undefined) return undefined;
  const n = v === true ? NaN : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1 || String(v).trim() === '') throw new OrbitError(`--${flag} needs a figure from 0 to 1 (got ${v === true ? 'nothing' : JSON.stringify(String(v))})\nusage: ${USAGE}`, { exitCode: 2 });
  return n;
}
/** An ISO-8601 time from a flag (sent as given), or undefined when the flag is absent. */
export function isoFlag(v, flag) {
  if (v === undefined) return undefined;
  const s = v === true ? '' : String(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s)) || s.length > 40) throw new OrbitError(`--${flag} needs an ISO-8601 time such as 2026-11-29T00:00:00Z (got ${JSON.stringify(s)})\nusage: ${USAGE}`, { exitCode: 2 });
  return s;
}
/** heartbeat.usage (§26.1) from the flags, or undefined when none is given. */
export function usageFrom(args) {
  const u = {
    weeklyUtilization: figureFlag(args.usage, 'usage'), fiveHourUtilization: figureFlag(args['five-hour'], 'five-hour'),
    weeklyResetsAt: isoFlag(args['weekly-resets'], 'weekly-resets'), fiveHourResetsAt: isoFlag(args['five-hour-resets'], 'five-hour-resets'),
  };
  const out = Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined));
  return Object.keys(out).length ? out : undefined;
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const seat = requireSeat();
  const body = { uplinkVersion: UPLINK_VERSION, state: given(args.state) ? String(args.state) : 'idle' };
  const usage = usageFrom(args);
  if (usage) body.usage = usage;
  if (args.doorbell !== undefined && args.doorbell !== true) {
    const pr = Number(args.doorbell);
    if (!Number.isInteger(pr) || pr <= 0) throw new OrbitError('--doorbell needs the PR number', { exitCode: 2 });
    body.doorbell = { repo: 'Airportels/orbit-beacon', pr };
  }
  const r = await seatClient(seat).call('heartbeat', body);
  if (body.doorbell) writeSeat({ ...readSeat(), doorbell: body.doorbell });
  if (args.json) console.log(JSON.stringify({ sent: { ...body }, received: r }));
  else console.log(`heartbeat ok: ${seat.seatId} ${body.state}${body.doorbell ? ` · doorbell ${body.doorbell.repo}#${body.doorbell.pr} registered` : ''}${usage ? ` · usage ${Object.entries(usage).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''} · Uplink min ${r?.minVersion ?? '?'} latest ${r?.latestVersion ?? '?'}${r?.notes ? ` · ${r.notes}` : ''}`);
  return 0;
}
