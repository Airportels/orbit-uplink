// The RTDB ring listener (CONTRACT §7, proven S8). Trades the seat key for a custom token (mintRtdbToken), signs in with
// the Firebase JS SDK (so token refresh and reconnects are handled), watches /rings/{seatId}, resolves on the first ring
// newer than `since`, and writes /presence/{seatId}. Emulators: FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_DATABASE_EMULATOR_HOST.
import { readConfig } from './store.js';
import { seatClient } from './mc.js';
import { OrbitError } from './errors.js';
import { UPLINK_VERSION } from './version.js';

const DEFAULT_NS = 'airportels-orbit-default-rtdb';
/** How long leaving waits for the `idle` presence write before the process exits anyway. */
export const PRESENCE_WRITE_MS = 1500;

export function firebaseConfig(config = readConfig()) {
  const fb = { ...(config.firebase ?? {}) };
  const authEmu = process.env.FIREBASE_AUTH_EMULATOR_HOST || config.emulators?.auth || null;
  const dbEmu = process.env.FIREBASE_DATABASE_EMULATOR_HOST || config.emulators?.database || null;
  fb.projectId ||= process.env.GCLOUD_PROJECT || 'airportels-orbit';
  if (dbEmu) {
    const ns = process.env.ORBIT_RTDB_NS || config.emulators?.databaseNs || `${fb.projectId}-default-rtdb`;
    fb.databaseURL = `http://${dbEmu}?ns=${ns}`;
    fb.apiKey ||= 'emulator';
  }
  if (authEmu) fb.apiKey ||= 'emulator';
  if (!fb.apiKey || !fb.databaseURL) {
    throw new OrbitError('no Firebase web config', { code: 'no_firebase_config', hint: 'put "firebase": { apiKey, authDomain, projectId, databaseURL } in $ORBIT_HOME/config.json (see config.example.json)' });
  }
  fb.authDomain ||= `${fb.projectId}.firebaseapp.com`;
  return { fb, authEmu, dbEmu };
}

export function ringTime(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? Number(v) : n;
}

/**
 * Resolves with { id, at, reason, ref, from } on the first ring newer than `sinceMs`. Rejects on auth/listen errors,
 * or with code 'timeout' after timeoutMs (when given). `onArmed` runs once the listener is attached.
 */
export async function watchForRing({ seat, config = readConfig(), sinceMs, timeoutMs = 0, onArmed = () => {}, onStatus = () => {} }) {
  const { fb, authEmu, dbEmu } = firebaseConfig(config);
  const mc = seatClient(seat);
  // MC's seat call for the RTDB credential (MC README, "Seats' RTDB credential"): {} → { uid, token, expiresAt }
  const minted = await mc.call('mintRtdbToken', {});
  const customToken = minted?.token ?? minted?.customToken;
  if (!customToken) throw new OrbitError('mintRtdbToken returned no token', { code: 'no_rtdb_token' });

  const [{ initializeApp, deleteApp }, auth, dbm] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/database')]);
  const app = initializeApp(fb, `orbit-watch-${process.pid}`);
  const a = auth.getAuth(app);
  const db = dbm.getDatabase(app);
  if (authEmu) auth.connectAuthEmulator(a, `http://${authEmu}`, { disableWarnings: true });
  if (dbEmu) { const [h, p] = dbEmu.split(':'); dbm.connectDatabaseEmulator(db, h, Number(p || 80)); }
  try {
    await auth.signInWithCustomToken(a, customToken);
  } catch (e) {
    await deleteApp(app).catch(() => {});
    throw new OrbitError(`RTDB sign-in failed: ${e.code ?? e.message}`, { code: 'rtdb_auth' });
  }

  const presenceRef = dbm.ref(db, `presence/${seat.seatId}`);
  dbm.set(presenceRef, { state: 'watching', at: new Date().toISOString(), uplinkVersion: UPLINK_VERSION }).catch(() => {});
  dbm.onDisconnect(presenceRef).set({ state: 'offline', at: dbm.serverTimestamp() }).catch(() => {});
  dbm.onValue(dbm.ref(db, '.info/connected'), (s) => onStatus(s.val() ? 'connected' : 'disconnected'));

  return new Promise((resolve, reject) => {
    let done = false;
    // Leaving: presence goes `idle` and stays so. The caller exits the process right after, so the write is awaited (capped, a
    // dead connection must not hold the exit), and the onDisconnect `offline` is cancelled first: otherwise the socket closing
    // on exit would overwrite `idle` at once.
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const leave = (async () => {
        await dbm.onDisconnect(presenceRef).cancel().catch(() => {});
        await dbm.set(presenceRef, { state: 'idle', at: new Date().toISOString(), uplinkVersion: UPLINK_VERSION }).catch(() => {});
      })();
      Promise.race([leave, new Promise((r) => setTimeout(r, PRESENCE_WRITE_MS))]).then(() => {
        deleteApp(app).catch(() => {});
        fn(v);
      });
    };
    const timer = timeoutMs > 0 ? setTimeout(() => finish(reject, new OrbitError(`no ring within ${Math.round(timeoutMs / 1000)} s`, { code: 'timeout', exitCode: 4 })), timeoutMs) : null;
    // a stopped background command: leave presence idle, then exit 130/143 so the session sees it was interrupted
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      process.once(sig, () => finish(reject, new OrbitError(`watch stopped (${sig})`, { code: 'stopped', exitCode: code })));
    }
    const q = dbm.query(dbm.ref(db, `rings/${seat.seatId}`), dbm.limitToLast(20));
    dbm.onChildAdded(
      q,
      (snap) => {
        const v = snap.val() ?? {};
        const at = ringTime(v.at);
        if (!(at > sinceMs)) return; // older than our start (or malformed): already acted on, ignore
        finish(resolve, { id: snap.key, at: v.at, reason: v.reason, ref: v.ref, from: v.from });
      },
      (err) => finish(reject, new OrbitError(`listen error: ${err.message}`, { code: 'listen', exitCode: 3 })),
    );
    onArmed();
  });
}
