// ~/.orbit/{config.json, person.json, seat.json}: the device's Orbit state. Every file is 0600, the directory 0700.
// ORBIT_HOME overrides the directory (tests and cloud seats use it). Nothing here ever prints a key or a token.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OrbitError } from './errors.js';
import { hasFileModes } from './platform.js';

export function orbitHome() {
  return process.env.ORBIT_HOME || join(homedir(), '.orbit');
}

export function ensureHome() {
  const h = orbitHome();
  if (!existsSync(h)) mkdirSync(h, { recursive: true, mode: 0o700 });
  return h;
}

function readJson(name) {
  const p = join(orbitHome(), name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new OrbitError(`${p} is not valid JSON (${e.message})`, { code: 'bad_store_file' });
  }
}

function writeJson(name, value) {
  const h = ensureHome();
  const p = join(h, name);
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
  chmodSync(p, 0o600);
  return p;
}

export const paths = {
  config: () => join(orbitHome(), 'config.json'),
  person: () => join(orbitHome(), 'person.json'),
  seat: () => join(orbitHome(), 'seat.json'),
};

/** config.json: { mcUrl, firebase: { apiKey, authDomain, projectId, databaseURL }, marketplace }; no factory keys (§14.7) */
export function readConfig() {
  return readJson('config.json') ?? {};
}
export function writeConfig(cfg) {
  return writeJson('config.json', cfg);
}

/** person.json: { uid, handle, displayName, stationIds, idToken, refreshToken, expiresAt, signedInAt }. Never the email. */
export function readPerson() {
  return readJson('person.json');
}
export function writePerson(p) {
  return writeJson('person.json', p);
}
/** person.json's bytes as they are, or null when there is none: what `orbit login` puts back when Orbit refuses the sign-in (§32.1 line 12). */
export function readPersonRaw() {
  const p = paths.person();
  return existsSync(p) ? readFileSync(p) : null;
}
/** Put person.json back to `raw` (bytes from readPersonRaw: 0600, written atomically), or remove it when `raw` is null. */
export function restorePersonRaw(raw) {
  const p = paths.person();
  if (raw === null) { if (existsSync(p)) unlinkSync(p); return; }
  ensureHome();
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, raw, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
  chmodSync(p, 0o600);
}
export function requirePerson() {
  const p = readPerson();
  if (!p) throw new OrbitError('not signed in', { code: 'not_signed_in', hint: 'run: orbit login' });
  return p;
}

/** seat.json: { seatId, seatKey, stationId, kind, role, accountLabel, handle, doorbell?, enrolledAt }. The key is never printed. */
export function readSeat() {
  return readJson('seat.json');
}
export function writeSeat(s) {
  return writeJson('seat.json', s);
}
export function requireSeat() {
  const s = readSeat();
  if (!s) throw new OrbitError('this device has no seat', { code: 'not_enrolled', hint: 'run: orbit seat add --ground (or, in the cloud, orbit enrol)' });
  return s;
}
export function deleteSeat() {
  const p = paths.seat();
  if (existsSync(p)) unlinkSync(p);
}

/**
 * mode of a store file as an octal string like "600", or null when missing. §37 W21: null on win32 (no POSIX modes there; the chmod
 * calls above stay, since they don't throw). `o` is platform.js's context (a test's platform).
 */
export function fileMode(p, o = {}) {
  if (!hasFileModes(o)) return null;
  if (!existsSync(p)) return null;
  return (statSync(p).mode & 0o777).toString(8);
}

/** The Orbit handle ({user} in §6): person.json first, then derived from the seat id "{handle}-{kind}-{n}". */
export function handleFor(seat, person = readPerson()) {
  if (person?.handle) return person.handle;
  const m = /^(.+)-(ground|orbiter)-\d+$/.exec(seat?.seatId ?? '');
  if (m) return m[1];
  throw new OrbitError('cannot tell the Orbit handle', { code: 'no_handle', hint: 'run: orbit login' });
}
