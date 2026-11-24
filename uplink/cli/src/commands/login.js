// orbit login [--handle <h>] [--port <n>] [--no-open] (D3)
// Browser flow: a loopback server serves a tiny page with a "Sign in with Google" button (signInWithPopup from the click, plus one
// automatic attempt on load; a blocked pop-up leaves the button, with the fix named); the page posts the ID + refresh token back,
// then the CLI stores person.json (0600) and calls registerPerson. The callback carries a per-login random `state` the page got
// from the loopback server: a callback without it (another page posting to localhost) is refused with 403.
// §34.3 (v0.13.0, V64): the picker isn't pinned to a domain (no `hd`; config.allowedDomain is gone): any Google account may sign in,
// and the invite is the gate. "Use another account" keeps prompt: select_account.
// Tests only (left out of the help): --emulator-user <local-part | address> uses the Auth emulator's fake Google sign-in, with no
// browser (an address outside airportels.asia for §34's refusals; ORBIT_TEST_UNVERIFIED_EMAIL=1 makes its email unverified). No
// email is stored.
// §32.1 line 12 (v0.12.0, V60) and §34.3: Orbit is invite only. On ANY refusal from registerPerson (not_invited, domain_not_allowed,
// email_not_verified, or anything else, the network included) the CLI says so in its own words (never the address), exits 1, and
// leaves person.json as it was before this sign-in: the earlier file unchanged, or no file.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { parseArgs } from '../args.js';
import { readConfig, writePerson, readPerson, readPersonRaw, restorePersonRaw, paths, fileMode } from '../store.js';
import { authEmulatorHost, identityToolkitBase, webApiKey, decodeJwt } from '../auth.js';
import { personClient } from '../mc.js';
import { OrbitError, McError } from '../errors.js';
import { cmdExe } from '../platform.js';

/** §32.1 line 12: what `orbit login` says when Orbit refuses an account with no invite (403 not_invited). Never the address. */
export const NOT_INVITED = 'Orbit is invite only: ask an admin to invite your Google account, then run orbit login again';
/** §34.3: the words for a sign-in from a domain Orbit doesn't take (403 domain_not_allowed from registerPerson). */
export const DOMAIN_NOT_ALLOWED = "This Google account can't join Orbit. Sign in with the account you were invited at";
/** §34.3: the words for a sign-in without a verified email (403 email_not_verified, registerPerson's alone). */
export const EMAIL_NOT_VERIFIED = "Your Google account's email isn't verified";
/** The words for each refusal registerPerson gives a sign-in (34.3), by code; `notInvited` is the caller's own (login's, setup's). */
export function refusalWords(code, { notInvited = NOT_INVITED } = {}) {
  return { not_invited: notInvited, domain_not_allowed: DOMAIN_NOT_ALLOWED, email_not_verified: EMAIL_NOT_VERIFIED }[code] ?? null;
}

const DEV_DOMAIN = 'airportels.asia'; // the Auth emulator's fake sign-in only
/** The Firebase JS SDK the page loads from gstatic: the same release as the `firebase` npm package (package-lock.json). */
export const FIREBASE_JS_VERSION = '13.4.0';

/** A fresh `state` for one login: 32 random bytes, base64url. */
export const newLoginState = () => randomBytes(32).toString('base64url');

/** null when the callback body is acceptable for `state`, else why not (the HTTP answer's text). Pure. */
export function checkCallback(body, state) {
  if (!body || typeof body !== 'object') return 'missing token';
  const got = typeof body.state === 'string' ? Buffer.from(body.state) : Buffer.alloc(0);
  const want = Buffer.from(String(state));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return 'state mismatch';
  if (!body.idToken || !body.uid) return 'missing token';
  return null;
}

/**
 * The sign-in page. A visible "Sign in with Google" button whose click handler calls signInWithPopup (a user gesture, so the
 * browser allows the pop-up). The page also tries once on load; when that attempt is blocked (auth/popup-blocked, the real-target
 * failure of 11-18) or fails for any other reason, the status line names the fix and the button retries. Never signInWithRedirect:
 * the page is served by a one-shot loopback server and a redirect round-trip loses it.
 */
export function page({ fb, authEmu, state = '' }) {
  const cfg = JSON.stringify({ apiKey: fb.apiKey, authDomain: fb.authDomain, projectId: fb.projectId });
  return `<!doctype html><meta charset="utf-8"><title>orbit login</title>
<body style="font:16px system-ui;margin:3rem;max-width:40rem">
<h1>Orbit: sign in</h1>
<p id="s">Opening Google sign-in…</p>
<p><button id="b" type="button" style="font:inherit;padding:.6em 1.2em">Sign in with Google</button></p>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/${FIREBASE_JS_VERSION}/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/${FIREBASE_JS_VERSION}/firebase-auth.js";
const s = document.getElementById("s");
const b = document.getElementById("b");
const app = initializeApp(${cfg});
const auth = getAuth(app);
${authEmu ? `connectAuthEmulator(auth, "http://${authEmu}", { disableWarnings: true });` : ''}
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
async function signIn() {
  b.disabled = true;
  s.textContent = "Opening Google sign-in…";
  try {
    const cred = await signInWithPopup(auth, provider);
    const u = cred.user;
    const idToken = await u.getIdToken();
    const r = await fetch("/callback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uid: u.uid, idToken, refreshToken: u.refreshToken, displayName: u.displayName ?? null, state: ${JSON.stringify(String(state))} }) });
    if (r.ok) { s.textContent = "Signed in. You can close this tab and go back to the terminal."; b.hidden = true; return; }
    s.textContent = "The terminal did not accept the sign-in: " + (await r.text()) + ". Click Sign in to try again.";
  } catch (e) {
    const code = e.code ?? e.message;
    s.textContent = code === "auth/popup-blocked"
      ? "Sign-in failed: auth/popup-blocked. Allow pop-ups for localhost, then click Sign in."
      : "Sign-in failed: " + code + ". Click Sign in to try again.";
  }
  b.disabled = false;
}
b.addEventListener("click", signIn);
signIn(); // the automatic attempt; a browser that blocks it leaves the button for the click
</script></body>`;
}

// §37 W6d: on win32 cmd.exe runs by its full path (ComSpec, else <SystemRoot>\System32\cmd.exe), never a bare `cmd` a working folder
// could supply. login.js keeps its own platform check (W2's exception).
function openBrowser(url) {
  const cmd = platform() === 'darwin' ? ['open', [url]] : platform() === 'win32' ? [cmdExe(), ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); return true; } catch { return false; }
}

export async function browserSignIn({ config, port, open, onUrl = () => {}, log = (line) => console.log(line) }) {
  const fb = config.firebase ?? {};
  webApiKey(config); // throws with the hint when missing
  const authEmu = authEmulatorHost(config);
  const state = newLoginState();
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(page({ fb, authEmu, state }));
        return;
      }
      if (req.method === 'POST' && req.url === '/callback') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* ignore */ }
        const why = checkCallback(body, state);
        if (why) { res.writeHead(why === 'state mismatch' ? 403 : 400); res.end(why); return; }
        delete body.state;
        res.writeHead(200); res.end('ok');
        clearTimeout(timer);
        server.close();
        resolve(body);
        return;
      }
      res.writeHead(404); res.end();
    });
    const timer = setTimeout(() => { server.close(); reject(new OrbitError('no sign-in within 5 minutes', { code: 'login_timeout' })); }, 5 * 60_000);
    server.listen(port, '127.0.0.1', () => {
      // localhost, not 127.0.0.1: Firebase Auth authorises "localhost" by default for the popup flow
      const url = `http://localhost:${server.address().port}/`;
      log(`open this page to sign in with Google: ${url}`);
      onUrl(url);
      if (open) openBrowser(url);
    });
    server.on('error', (e) => { clearTimeout(timer); reject(new OrbitError(`loopback server failed: ${e.message}`)); });
  });
}

/**
 * The Auth emulator's fake Google sign-in (tests): no browser, uid "dev-<local-part>". A local part signs in at airportels.asia; an
 * address keeps its domain. ORBIT_TEST_UNVERIFIED_EMAIL=1 makes the email unverified. No `hd` claim (§34.3: nothing pins the domain).
 */
async function emulatorSignIn({ config, localPart }) {
  if (!authEmulatorHost(config)) throw new OrbitError('--emulator-user needs FIREBASE_AUTH_EMULATOR_HOST (the Auth emulator)', { exitCode: 2 });
  const given = String(localPart).toLowerCase();
  const lp = given.includes('@') ? given.slice(0, given.indexOf('@')) : given;
  const email = given.includes('@') ? given : `${lp}@${DEV_DOMAIN}`;
  const claims = { sub: `dev-${lp}`, email, email_verified: process.env.ORBIT_TEST_UNVERIFIED_EMAIL !== '1', name: lp };
  const res = await fetch(`${identityToolkitBase(config)}/accounts:signInWithIdp?key=${encodeURIComponent(config.firebase?.apiKey ?? 'emulator')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(JSON.stringify(claims))}&providerId=google.com`, requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.idToken) throw new OrbitError(`emulator sign-in failed: ${j.error?.message ?? res.status}`, { code: 'login_failed' });
  return { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, displayName: j.displayName ?? lp, expiresIn: Number(j.expiresIn ?? 3600) };
}

/**
 * A fresh sign-in (the browser, or the Auth emulator's with `emulatorUser`), then registerPerson: → the person, written to
 * person.json (0600; never the email). On any refusal from registerPerson, person.json is put back as it was before the sign-in
 * (§32.1 line 12, §34.3) and an OrbitError carries the refusal's code and its words (`notInvited`: the caller's own for not_invited).
 */
export async function signInAndRegister({ config = readConfig(), emulatorUser = null, port = 0, open = true, handle = null, log, notInvited = NOT_INVITED } = {}) {
  const cred = emulatorUser ? await emulatorSignIn({ config, localPart: emulatorUser }) : await browserSignIn({ config, port, open, ...(log && { log }) });
  const payload = decodeJwt(cred.idToken);
  const expiresAt = new Date((payload.exp ? payload.exp * 1000 : Date.now() + (cred.expiresIn ?? 3600) * 1000)).toISOString();
  const before = readPersonRaw(); // put back as it was if Orbit refuses this sign-in
  const previous = readPerson() ?? {};
  const person = { uid: cred.uid, handle: previous.uid === cred.uid ? previous.handle ?? null : null, displayName: cred.displayName ?? null, stationIds: previous.uid === cred.uid ? previous.stationIds ?? [] : [], idToken: cred.idToken, refreshToken: cred.refreshToken, expiresAt, signedInAt: new Date().toISOString() };
  writePerson(person);
  let reg;
  try {
    reg = await personClient(cred.idToken).call('registerPerson', handle ? { handle } : {});
  } catch (e) {
    restorePersonRaw(before); // §34.3: every refusal, and a Mission Control that can't be reached
    if (e instanceof McError && e.code === 'unreachable') throw new OrbitError(`can't reach Orbit's sign-in: check the network and rerun (${e.message})`, { code: 'unreachable', exitCode: 1 });
    const words = e instanceof McError ? refusalWords(e.code, { notInvited }) : null;
    if (words) throw new OrbitError(words, { code: e.code, exitCode: 1 });
    throw e;
  }
  const merged = { ...person, handle: reg?.handle ?? person.handle, displayName: reg?.displayName ?? person.displayName, stationIds: reg?.stationIds ?? person.stationIds };
  const path = writePerson(merged);
  return { person: merged, path };
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['open', 'json'] });
  const config = readConfig();
  const { person: merged, path: p } = await signInAndRegister({
    config, emulatorUser: args['emulator-user'] && args['emulator-user'] !== true ? args['emulator-user'] : null,
    port: args.port && args.port !== true ? Number(args.port) : 0, open: args.open !== false, handle: args.handle && args.handle !== true ? String(args.handle) : null,
  });
  const mode = fileMode(p); // §37 W21: null on win32, and the words drop "(mode …)"
  if (args.json) console.log(JSON.stringify({ uid: merged.uid, handle: merged.handle, stationIds: merged.stationIds, path: p, mode }));
  else console.log(`signed in as ${merged.handle ?? merged.uid} (station${merged.stationIds.length === 1 ? '' : 's'} ${merged.stationIds.join(', ') || 'none'}); stored in ${p}${mode ? ` (mode ${mode})` : ''}. Next: orbit seat add --ground`);
  return 0;
}
