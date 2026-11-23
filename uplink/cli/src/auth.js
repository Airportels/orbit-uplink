// Person credentials: the Firebase ID token in person.json, refreshed through the Secure Token endpoint when it is
// about to expire. The Auth emulator is used when FIREBASE_AUTH_EMULATOR_HOST is set (tests).
import { readConfig, readPerson, writePerson, requirePerson } from './store.js';
import { OrbitError } from './errors.js';

export function authEmulatorHost(config = readConfig()) {
  return process.env.FIREBASE_AUTH_EMULATOR_HOST || config.emulators?.auth || null;
}

export function identityToolkitBase(config = readConfig()) {
  const emu = authEmulatorHost(config);
  return emu ? `http://${emu}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1';
}

export function secureTokenBase(config = readConfig()) {
  const emu = authEmulatorHost(config);
  return emu ? `http://${emu}/securetoken.googleapis.com/v1` : 'https://securetoken.googleapis.com/v1';
}

export function webApiKey(config = readConfig()) {
  const k = process.env.ORBIT_FIREBASE_API_KEY || config.firebase?.apiKey;
  if (!k) throw new OrbitError('no Firebase web API key', { code: 'no_firebase_config', hint: 'run `orbit setup` (or copy setup/orbit-config.json to $ORBIT_HOME/config.json)' });
  return k;
}

/** Decode a JWT payload without verifying it (we only read our own token's uid / expiry). */
export function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * §35.2 step 4: Secure Token's answers that refuse the refresh token itself (400 with one of these messages): the sign-in must be
 * done again (code `signin_expired`). Anything that says nothing about the token (a network error, a timeout, 429, 5xx) is
 * `unreachable`: no new sign-in, person.json unchanged.
 */
export const REFRESH_REFUSED = Object.freeze(['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND']);
export const UNREACHABLE_WORDS = "can't reach Orbit's sign-in: check the network and rerun";

/**
 * Returns a valid ID token for the signed-in person, refreshing (and re-writing person.json) when needed; `force` refreshes even a
 * fresh one (orbit setup: "already" means "works"). Errors (OrbitError): not_signed_in (no person.json, or no refresh token),
 * signin_expired (Secure Token refused the refresh token: REFRESH_REFUSED), unreachable (a network error, a timeout, 429 or 5xx;
 * person.json is left as it was), not_signed_in for any other refusal.
 */
export async function getIdToken({ config = readConfig(), force = false } = {}) {
  const person = requirePerson();
  const now = Date.now();
  if (!force && person.idToken && person.expiresAt && Date.parse(person.expiresAt) - now > 60_000) return person.idToken;
  if (!person.refreshToken) throw new OrbitError('the sign-in has expired', { code: 'not_signed_in', hint: 'run: orbit login' });
  let res;
  try {
    res = await fetch(`${secureTokenBase(config)}/token?key=${encodeURIComponent(webApiKey(config))}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: person.refreshToken }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no answer within 15 s' : e.cause?.code ?? e.message;
    throw new OrbitError(`${UNREACHABLE_WORDS} (${why})`, { code: 'unreachable' });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id_token) {
    const message = String(j.error?.message ?? '');
    const reason = message.split(/[\s:]/)[0];
    if (res.status === 429 || res.status >= 500) throw new OrbitError(`${UNREACHABLE_WORDS} (HTTP ${res.status})`, { code: 'unreachable' });
    if (REFRESH_REFUSED.includes(reason)) throw new OrbitError(`the sign-in has expired (${reason})`, { code: 'signin_expired', hint: 'run: orbit login' });
    throw new OrbitError(`could not refresh the sign-in (${message || res.status})`, { code: 'not_signed_in', hint: 'run: orbit login' });
  }
  const updated = {
    ...person,
    idToken: j.id_token,
    refreshToken: j.refresh_token ?? person.refreshToken,
    expiresAt: new Date(now + Number(j.expires_in ?? 3600) * 1000).toISOString(),
  };
  writePerson(updated);
  return updated.idToken;
}

export function personOrNull() {
  return readPerson();
}
