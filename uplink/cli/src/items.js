// The person's inbox items (CONTRACT §20, v0.8.0, M23): shared by `orbit inbox`, `orbit answer` and `orbit clear`.
// Items are person calls (`listItems`, `answerItem`, `clearItem`) with the ID token from `orbit login`; a seat key cannot read them.
// Nothing here answers anything on its own: `orbit answer` is the person's (§20.4, the plugin's guidance).
import { McError } from './errors.js';

export const ITEM_KINDS = ['go', 'decision', 'action', 'wake', 'alert', 'fyi'];
const ID_RE = /^[a-z0-9-]+$/;

/** Hints for the §20 error codes (and the §17.1 gate), attached to an McError that has none. */
export const ITEM_HINTS = {
  not_registered: 'run: orbit login',
  not_in_station: 'run: orbit login, or name the station with --station',
  not_found: 'that id is not one of your items: see orbit inbox',
  already_answered: 'it was answered already (by you, in the Console, or by your seat\'s note): see orbit inbox',
  item_closed: 'it is no longer open (answered, cleared or expired): see orbit inbox',
  not_answerable: 'a wake, alert or fyi is cleared, not answered: orbit clear <itemId>',
  not_clearable: 'a go or a decision is answered, not cleared: orbit answer <itemId> <optionId | "text">',
  bad_answer: 'see the item\'s options in orbit inbox; a text answer only where it says "or answer in text"',
};

export function withItemHints(e) {
  if (e instanceof McError && ITEM_HINTS[e.code] && !e.hint) e.hint = ITEM_HINTS[e.code];
  return e;
}

/** An item's options with the recommended one first (MC already requires that; kept here so the display never depends on it). */
export const orderedOptions = (item) => {
  const opts = item.options ?? [];
  return [...opts.filter((o) => o.recommended), ...opts.filter((o) => !o.recommended)];
};

const when = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) + 'Z' : '');
const fromOf = (item) => (item.from?.system ? 'Mission Control' : item.from?.seatId ?? item.from?.personUid ?? '?');

/** One item as lines: the header, then why / blocks / effect, then the options (recommended first, marked) or how to close it. */
export function formatItem(item) {
  const lines = [`${item.id}  ${item.kind.padEnd(8)}  ${item.taskId ?? '-'}  "${item.title}"  from ${fromOf(item)}  ${when(item.createdAt)}${item.state !== 'open' ? `  [${item.state}]` : ''}`];
  if (item.why) lines.push(`        why: ${item.why}`);
  if (item.blocks) lines.push(`        blocks: ${item.blocks}`);
  if (item.effect) lines.push(`        effect: ${item.effect}`);
  const opts = orderedOptions(item);
  if (opts.length) {
    const w = Math.max(...opts.map((o) => o.id.length));
    lines.push('        options:');
    for (const o of opts) lines.push(`          ${o.recommended ? '*' : ' '} ${o.id.padEnd(w)}  ${o.label}${o.recommended ? ' (recommended)' : ''}${o.effect ? ` · ${o.effect}` : ''}`);
  }
  if (item.state === 'open') {
    if (item.kind === 'go' || item.kind === 'decision') {
      const how = [opts.length ? '<optionId>' : null, item.allowText ? '"text"' : null].filter(Boolean).join(' | ');
      lines.push(`        answer: orbit answer ${item.id} ${how}${item.allowText && opts.length ? '   (or answer in text)' : ''}`);
    } else if (item.kind === 'action') lines.push(`        when done: orbit answer ${item.id}   (or orbit clear ${item.id})`);
    else lines.push(`        clear: orbit clear ${item.id}`);
  }
  return lines;
}

export function formatItems(items, { more = false, fyi = false } = {}) {
  if (!items.length) return [`no open items${fyi ? '' : ' (FYIs: orbit inbox --fyi)'}`];
  const lines = [`open items (${items.length}${more ? '+' : ''}), most urgent first${fyi ? ', FYIs last' : ''}:`];
  for (const it of items) lines.push(...formatItem(it));
  if (more) lines.push('… more open items than shown: orbit inbox --items-limit 100, or the Console\'s Inbox');
  return lines;
}

/** One page of the caller's items (listItems: open, no FYI unless `fyi`). → { items, handles, next? } */
export async function listMyItems(mc, stationId, { fyi = false, limit = 50, cursor } = {}) {
  return mc.call('listItems', { stationId, ...(fyi && { kinds: ITEM_KINDS }), limit, ...(cursor && { cursor }) });
}

/** The caller's open item `itemId`, looked up through listItems (every kind, every page), or null. */
export async function findOpenItem(mc, stationId, itemId) {
  let cursor;
  for (let page = 0; page < 20; page++) {
    const r = await mc.call('listItems', { stationId, kinds: ITEM_KINDS, limit: 100, ...(cursor && { cursor }) });
    const hit = (r.items ?? []).find((i) => i.id === itemId);
    if (hit) return hit;
    if (!r.next) return null;
    cursor = r.next;
  }
  return null;
}

/**
 * What `orbit answer <itemId> [answer]` sends (answerItem's body without itemId), from the item when it is known (open), else from
 * the answer's shape (an id-like word is an optionId, anything else text; Mission Control then decides: 404, already_answered, …).
 * `force` = 'option' | 'text' from --option / --text. Throws { usage } for an answer the item cannot take.
 */
export function answerBody(item, answer, force) {
  const usage = (m) => Object.assign(new Error(m), { exitCode: 2 });
  if (force === 'option') return { optionId: answer };
  if (force === 'text') return { text: answer };
  if (!item) {
    if (answer === undefined) return {};
    return ID_RE.test(answer) && answer.length <= 40 ? { optionId: answer } : { text: answer };
  }
  const ids = (item.options ?? []).map((o) => o.id);
  if (item.kind === 'action') {
    if (answer === undefined || answer === 'done') return {};
    throw usage(`${item.id} is an action: it takes no answer. When it is done: orbit answer ${item.id}`);
  }
  if (item.kind !== 'go' && item.kind !== 'decision') throw usage(`${item.id} is a ${item.kind}: it is cleared, not answered. Run: orbit clear ${item.id}`);
  if (answer === undefined) throw usage(`${item.id} needs an answer: ${[ids.length ? `one of ${ids.join(', ')}` : null, item.allowText ? 'a "text" answer' : null].filter(Boolean).join(', or ')}`);
  if (ids.includes(answer)) return { optionId: answer };
  if (item.allowText) return { text: answer };
  throw usage(`"${answer}" is not an option of ${item.id}: one of ${ids.join(', ')}`);
}
