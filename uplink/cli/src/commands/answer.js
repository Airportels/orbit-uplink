// orbit answer <itemId> [<optionId | "text">] [--option <id> | --text "<text>"] [--station s] [--json]: answer one of my inbox items
// (CONTRACT §20.4, v0.8.0: answerItem, a person call with the `orbit login` token). A go takes one of its options; a decision one
// of its options or, where it allows text, a text answer; an action takes nothing (it is done). Mission Control writes the answer,
// adds a Note `answer: <label or text>` to the item's task (re-readying it when it was blocked and the task is mine) and rings the
// assignee; this prints what was sent and that ring. The answer is the person's own: a ground session runs this only when its person
// says so (the plugin's guidance).
import { parseArgs } from '../args.js';
import { requirePerson } from '../store.js';
import { getIdToken } from '../auth.js';
import { personClient } from '../mc.js';
import { stationFor } from './seat.js';
import { answerBody, findOpenItem, withItemHints } from '../items.js';

const USAGE = 'orbit answer <itemId> [<optionId | "text">] [--option <id> | --text "<text>"] [--station s] [--json]';
const usage = (m) => Object.assign(new Error(`${m}\nusage: ${USAGE}`), { exitCode: 2 });

/** One line about the ring answerItem reports (§5's shape), or about there being none. */
export function ringLine(item, ring) {
  if (!ring) return item.taskId ? `no ring: ${item.taskId} is closed or has no assignee (a note is written only on an open task)` : 'no note and no ring: the item has no task';
  if (ring.ok) return `rang ${ring.target === 'rtdb' ? 'the ground seat' : 'the orbiter'} on ${item.taskId} (${ring.target}${ring.pr ? `, doorbell #${ring.pr}` : ''}${ring.ringId ? `, ring ${ring.ringId}` : ''})`;
  return `the ring failed (${ring.target}: ${ring.error}); the answer and its note stand, and the seat sees them on its next look at Mission Control`;
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json'] });
  const [itemId, positional, ...extra] = args._;
  if (!itemId) throw usage('missing <itemId>');
  if (extra.length) throw usage(`one answer only (quote a text answer): got ${[positional, ...extra].map((x) => JSON.stringify(x)).join(' ')}`);
  const opt = args.option !== undefined && args.option !== true ? String(args.option) : undefined;
  const txt = args.text !== undefined && args.text !== true ? String(args.text) : undefined;
  if (args.option === true || args.text === true) throw usage(`--${args.option === true ? 'option' : 'text'} needs a value`);
  if ([positional, opt, txt].filter((x) => x !== undefined).length > 1) throw usage('give the answer once: a positional, --option or --text');
  const answer = positional ?? opt ?? txt;
  const force = opt !== undefined ? 'option' : txt !== undefined ? 'text' : undefined;
  if (answer !== undefined && answer.trim() === '') throw usage('the answer is empty');

  const person = requirePerson();
  const stationId = stationFor(args, person);
  const mc = personClient(await getIdToken());
  let item = null;
  try { item = await findOpenItem(mc, stationId, itemId); } catch (e) { throw withItemHints(e); }
  const body = answerBody(item, answer, force); // exit 2 for an answer this item cannot take; MC decides the rest
  let r;
  try { r = await mc.call('answerItem', { itemId, ...body, ...(args.station && args.station !== true && { stationId }) }); } catch (e) { throw withItemHints(e); }
  if (args.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  const it = r.item ?? {};
  const optLabel = body.optionId !== undefined ? (it.options ?? []).find((o) => o.id === body.optionId)?.label ?? body.optionId : undefined;
  const sent = body.optionId !== undefined ? `option ${body.optionId} ("${optLabel}")` : body.text !== undefined ? `text "${body.text}"` : 'done';
  console.log(`answered ${itemId} (${it.kind ?? '?'}: "${it.title ?? ''}") with ${sent}`);
  if (r.ring) console.log(`note on ${it.taskId}: "answer: ${optLabel ?? body.text ?? 'done'}"`);
  console.log(ringLine(it, r.ring));
  return 0;
}
