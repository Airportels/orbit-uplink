// The Mission Control HTTP client (CONTRACT §5): POST {base}/{function} with JSON, JSON back, errors as { error: { code, message } }.
// Seat calls carry `Authorization: Bearer <seatKey>`; person calls carry a Firebase ID token. The base URL comes from
// ORBIT_MC_URL, else config.json's mcUrl. Nothing here logs a header.
import { McError, OrbitError } from './errors.js';
import { readConfig } from './store.js';

export function mcBaseUrl(config = readConfig()) {
  const u = process.env.ORBIT_MC_URL || config.mcUrl;
  if (!u) {
    throw new OrbitError('no Mission Control URL', {
      code: 'no_mc_url',
      hint: 'run `orbit setup` (or copy setup/orbit-config.json to $ORBIT_HOME/config.json)',
    });
  }
  return u.replace(/\/+$/, '');
}

/**
 * The test-only misroute retry (rulings on S30 MC, 5; S30-4b item 5). Mission Control's functions emulator, in its sequential mode,
 * can answer a call with the previous target's answer, `200 {"status":"acknowledged"}` (a Firestore trigger's), and the function
 * called never runs. No Mission Control function answers that body. Only when the test helpers set ORBIT_TEST_MISROUTE_RETRY=1
 * (test/helpers.mjs baseEnv, for the CLI processes the tests spawn) is such an answer sent again, 5 times at most, as
 * test/fetch-function.mjs does for the tests' own calls. It is never on by default: a real Mission Control is called once.
 */
export const MISROUTED = '{"status":"acknowledged"}';
const MISROUTE_RETRIES = 5;
const misrouteRetry = () => process.env.ORBIT_TEST_MISROUTE_RETRY === '1';

export async function mcCall(fn, body, { token, baseUrl, timeoutMs = 15000 } = {}) {
  const base = baseUrl ?? mcBaseUrl();
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  let text;
  for (let i = 0; ; i++) {
    try {
      res = await fetch(`${base}/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const why = e.name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : e.cause?.code ?? e.message;
      throw new McError(0, 'unreachable', `Mission Control unreachable at ${base} (${why})`);
    }
    text = await res.text();
    if (!(misrouteRetry() && res.status === 200 && text === MISROUTED) || i >= MISROUTE_RETRIES) break;
    process.stderr.write(`# emulator misroute: ${fn} got the tick trigger's answer; sent again\n`);
    await new Promise((r) => setTimeout(r, 25));
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const err = json?.error ?? {};
    const msg = err.message ?? (text ? text.slice(0, 200) : res.statusText);
    throw new McError(res.status, err.code, `${fn}: ${msg}${err.code ? ` [${err.code}]` : ''} (HTTP ${res.status})`, json ?? text); // the code is in the message: hints and greps match it
  }
  // Firebase callables wrap in { result }; plain onRequest functions don't. Accept both.
  return json && typeof json === 'object' && 'result' in json && Object.keys(json).length === 1 ? json.result : json;
}

/** A client bound to one seat key. */
export function seatClient(seat, opts = {}) {
  if (!seat?.seatKey) throw new OrbitError('seat.json has no key', { code: 'not_enrolled', hint: 'run: orbit seat add --ground' });
  return {
    seatId: seat.seatId,
    call: (fn, body, o = {}) => mcCall(fn, body, { token: seat.seatKey, ...opts, ...o }),
  };
}

/** A client bound to a person's ID token (refreshed by the caller, see auth.js). */
export function personClient(idToken, opts = {}) {
  return { call: (fn, body, o = {}) => mcCall(fn, body, { token: idToken, ...opts, ...o }) };
}
