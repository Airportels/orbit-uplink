// orbit clear <itemId> [--station s] [--json]: clear one of my inbox items (CONTRACT §20.4, v0.8.0: clearItem, a person call with
// the `orbit login` token). An action, wake, alert or FYI is cleared; a go or a decision is answered instead (orbit answer). No note,
// no ring: clearing tells nobody but Mission Control.
import { parseArgs } from '../args.js';
import { requirePerson } from '../store.js';
import { getIdToken } from '../auth.js';
import { personClient } from '../mc.js';
import { stationFor } from './seat.js';
import { withItemHints } from '../items.js';

const USAGE = 'orbit clear <itemId> [--station s] [--json]';

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const [itemId, ...extra] = args._;
  if (!itemId || extra.length) throw Object.assign(new Error(`${itemId ? 'one item id only' : 'missing <itemId>'}\nusage: ${USAGE}`), { exitCode: 2 });
  const person = requirePerson();
  const station = args.station && args.station !== true ? stationFor(args, person) : undefined;
  const mc = personClient(await getIdToken());
  let r;
  try { r = await mc.call('clearItem', { itemId, ...(station && { stationId: station }) }); } catch (e) { throw withItemHints(e); }
  if (args.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  console.log(`cleared ${itemId} (${r.item?.kind ?? '?'}: "${r.item?.title ?? ''}")`);
  return 0;
}
