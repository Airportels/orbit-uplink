// orbit stations [--station s] [--json]: the stations (spaces, §25) the signed-in person is in (CONTRACT §32.1 line 9, v0.12.0:
// listMySpaces, a person call with the `orbit login` token). One row each, Mission Control's order (their own space first, then team
// spaces by last move; archived ones left out): id, name, kind, open tasks. The id is what `orbit send --space <id>` takes. `--station`
// names Mission Control's station, as in the other commands; `--json` prints [{ id, name, kind, open }].
import { parseArgs } from '../args.js';
import { requirePerson } from '../store.js';
import { getIdToken } from '../auth.js';
import { personClient } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { stationFor } from './seat.js';

const USAGE = 'orbit stations [--station s] [--json]';
const HINTS = {
  not_registered: 'run: orbit login',
  not_in_station: 'run: orbit login, or name the station with --station',
};

/** The table: id, name, kind, open (one row a station). Pure. */
export function formatStations(rows) {
  if (!rows.length) return 'no stations (orbit login, then ask a lead to add you to one)';
  const cols = [['id', (r) => r.id], ['name', (r) => r.name], ['kind', (r) => r.kind], ['open', (r) => String(r.open)]];
  const width = cols.map(([h, f]) => Math.max(h.length, ...rows.map((r) => String(f(r) ?? '').length)));
  const line = (cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(width[i]))).join('  ');
  return [line(cols.map(([h]) => h)), ...rows.map((r) => line(cols.map(([, f]) => String(f(r) ?? ''))))].join('\n');
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'help'], aliases: { h: 'help' } });
  if (args.help) { console.log(`usage: ${USAGE}\n  the stations (spaces) you are in: id, name, kind, open tasks; orbit send --space <id> sends into one`); return 0; }
  if (args._.length) throw new OrbitError(`orbit stations takes no arguments\nusage: ${USAGE}`, { exitCode: 2 });
  const person = requirePerson();
  const stationId = stationFor(args, person);
  const mc = personClient(await getIdToken());
  let rows;
  try {
    rows = await mc.call('listMySpaces', { stationId });
  } catch (e) {
    if (e instanceof McError && HINTS[e.code] && !e.hint) e.hint = HINTS[e.code];
    throw e;
  }
  const out = (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, name: r.name, kind: r.kind, open: Number.isInteger(r.open) ? r.open : 0 }));
  if (args.json) { console.log(JSON.stringify(out)); return 0; }
  console.log(formatStations(out));
  return 0;
}
