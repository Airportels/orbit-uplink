// Git bundles on the ground side (CONTRACT §14.2, §14.5, §14.7): verify a bundle, upload one (PUT) and download one (GET) with
// the Upload / Download shapes Mission Control mints. A `file:` URL is a local copy, which only the emulators and the mock mint
// (§14.8), so it is taken only when one of them is configured (§36.4, v0.13.0: localTransfers), else refused as bad_upload /
// bad_download; an `http(s):` URL is a fetch with the headers exactly as given (a V4 signed URL on the real target). A signed URL
// is a credential: nothing here prints or logs one. Nothing here pushes anywhere.
import { copyFileSync, mkdirSync, statSync, createReadStream, createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { git } from './git.js';
import { OrbitError } from './errors.js';
import { readConfig } from './store.js';

export const SHA_RE = /^[0-9a-f]{40}$/;
export const TRANSFER_TIMEOUT_MS = 10 * 60_000; // one PUT or GET of up to 512 MiB

/** `git bundle list-heads` (runs anywhere): [{ sha, ref }]. */
export function bundleHeads(file) {
  const out = git(dirname(file), ['bundle', 'list-heads', file]);
  return out.split('\n').filter(Boolean).map((l) => { const sp = l.indexOf(' '); return { sha: l.slice(0, sp), ref: l.slice(sp + 1) }; });
}

/**
 * §14.2: `git bundle verify` passes with no prerequisite lines, and `list-heads` names exactly `ref`. `git bundle verify` refuses to
 * run outside a repository, so pass `repo` (the repo the bundle is for) or a scratch one is created and removed. Returns
 * { sha, ref, size }; throws OrbitError bad_bundle / no_bundle.
 */
export function verifyBundle(file, ref, { repo = null } = {}) {
  if (!existsSync(file)) throw new OrbitError(`bundle ${file} is missing`, { code: 'no_bundle' });
  const size = statSync(file).size;
  let heads;
  try { heads = bundleHeads(file); } catch (e) { throw new OrbitError(`not a git bundle: ${e.message}`, { code: 'bad_bundle' }); }
  if (heads.length !== 1 || heads[0].ref !== ref) {
    throw new OrbitError(`bundle must hold exactly one ref, ${ref} (it holds ${heads.map((h) => h.ref).join(', ') || 'none'})`, { code: 'bad_bundle' });
  }
  const scratch = repo ? null : mkdtempSync(join(tmpdir(), 'orbit-verify-'));
  try {
    const cwd = repo ?? scratch;
    if (scratch) git(scratch, ['init', '-q']);
    let out;
    try { out = git(cwd, ['bundle', 'verify', file]); } catch (e) { throw new OrbitError(`bundle verify failed: ${e.message}`, { code: 'bad_bundle' }); }
    // a bundle with prerequisites passes verify in a repo that holds them: the listing says so, and §14.2 wants none
    if (/requires (these|this)/i.test(out)) throw new OrbitError('bundle has prerequisites; §14.2 requires a complete history', { code: 'bad_bundle' });
    return { sha: heads[0].sha, ref, size };
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * §24.3: like verifyBundle, for a head set: list-heads names exactly `refs` (in any order), verify passes with no prerequisites.
 * → { heads: { [ref]: sha }, size }.
 */
export function verifyBundleHeads(file, refs, { repo = null } = {}) {
  if (!existsSync(file)) throw new OrbitError(`bundle ${file} is missing`, { code: 'no_bundle' });
  const size = statSync(file).size;
  let heads;
  try { heads = bundleHeads(file); } catch (e) { throw new OrbitError(`not a git bundle: ${e.message}`, { code: 'bad_bundle' }); }
  const got = heads.map((h) => h.ref).sort();
  if (JSON.stringify(got) !== JSON.stringify([...refs].sort())) throw new OrbitError(`bundle must hold exactly ${refs.join(', ')} (it holds ${got.join(', ') || 'none'})`, { code: 'bad_bundle' });
  const out = git(repo ?? dirname(file), ['bundle', 'verify', file], { allowFail: true });
  if (out === null) throw new OrbitError('bundle verify failed', { code: 'bad_bundle' });
  if (/requires (these|this)/i.test(out)) throw new OrbitError('bundle has prerequisites; §14.2 requires a complete history', { code: 'bad_bundle' });
  return { heads: Object.fromEntries(heads.map((h) => [h.ref, h.sha])), size };
}

const isFile = (u) => u.protocol === 'file:';
/**
 * §36.4: may a transfer use a `file:` URL? Only under an emulator or the mock: an emulator host in the environment
 * (FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_DATABASE_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST) or in config.json's `emulators`, or the
 * mock's test mode (ORBIT_TEST_MODE=mock). A real Mission Control never sends one.
 */
export function localTransfers({ env = process.env, config } = {}) {
  if (['FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'].some((k) => env[k])) return true;
  if (env.ORBIT_TEST_MODE === 'mock') return true;
  const emu = (config ?? readConfig()).emulators;
  return !!emu && typeof emu === 'object' && Object.values(emu).some((v) => typeof v === 'string' && v);
}
const noLocal = (what) => new OrbitError(`Mission Control sent a file: ${what} URL, which is taken only under an emulator or the mock: not from a real Mission Control`, { code: `bad_${what}` });
const assertHttp = (u, what) => { if (!/^https?:$/.test(u.protocol)) throw new OrbitError(`unsupported ${what} URL scheme ${u.protocol}`, { code: `bad_${what}` }); };
const why = (e) => (e.name === 'TimeoutError' ? `no answer within ${TRANSFER_TIMEOUT_MS / 1000} s` : e.cause?.code ?? e.cause?.message ?? e.message);

/**
 * PUT `file` to `upload` (§14.5 Upload: url, method, headers, maxBytes). The size is checked against maxBytes first. `file:` →
 * a copy; `http(s):` → fetch with a streamed body and the headers exactly as given (plus content-length, which GCS requires).
 * One retry after `remint()` (a fresh Upload) on 403 or a network error.
 */
export async function putBundle(upload, file, { remint = null } = {}) {
  const size = statSync(file).size;
  if (Number.isInteger(upload?.maxBytes) && size > upload.maxBytes) {
    throw new OrbitError(`${file} is ${size} bytes; the upload limit is ${upload.maxBytes} bytes`, { code: 'bundle_too_large', hint: 'send in snapshot mode (--mode snapshot), or send a smaller repository' });
  }
  let current = upload;
  for (let attempt = 0; ; attempt++) {
    const u = new URL(current.url);
    if (isFile(u)) {
      if (!localTransfers()) throw noLocal('upload');
      const dst = fileURLToPath(u);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(file, dst);
      return { bytes: size, via: 'file' };
    }
    assertHttp(u, 'upload');
    let res;
    try {
      res = await fetch(current.url, {
        method: current.method ?? 'PUT',
        headers: { ...(current.headers ?? {}), 'content-length': String(size) },
        body: Readable.toWeb(createReadStream(file)),
        duplex: 'half',
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt === 0 && remint) { current = await remint(); continue; }
      throw new OrbitError(`upload failed: ${why(e)}`, { code: 'upload_failed' });
    }
    if (res.ok) return { bytes: size, via: 'http', status: res.status };
    const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    if (res.status === 403 && attempt === 0 && remint) { current = await remint(); continue; }
    throw new OrbitError(`upload refused: HTTP ${res.status}${text ? ` ${text}` : ''}`, { code: 'upload_failed' });
  }
}

/** GET `download` (§14.5 Download: url, method, size) into `file`. `file:` → a copy; `http(s):` → fetch streamed to disk. One retry after `remint()` on 403 or a network error. The byte count must match `size` when given. */
export async function getBundle(download, file, { remint = null } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  let current = download;
  for (let attempt = 0; ; attempt++) {
    const u = new URL(current.url);
    if (isFile(u)) {
      if (!localTransfers()) throw noLocal('download');
      const src = fileURLToPath(u);
      if (!existsSync(src)) throw new OrbitError('the bundle is gone from the store', { code: 'bundle_gone' });
      copyFileSync(src, file);
      break;
    }
    assertHttp(u, 'download');
    let res;
    try {
      res = await fetch(current.url, { method: current.method ?? 'GET', signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) });
      if (res.ok) await pipeline(Readable.fromWeb(res.body), createWriteStream(file)); // a drop mid-stream lands below, like a failed connect
    } catch (e) {
      rmSync(file, { force: true }); // no partial file survives
      if (attempt === 0 && remint) { current = await remint(); continue; }
      throw new OrbitError(`download failed: ${why(e)}`, { code: 'download_failed' });
    }
    if (!res.ok) {
      if (res.status === 403 && attempt === 0 && remint) { current = await remint(); continue; }
      const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      throw new OrbitError(`download refused: HTTP ${res.status}${text ? ` ${text}` : ''}`, { code: res.status === 404 ? 'bundle_gone' : 'download_failed' });
    }
    break;
  }
  const bytes = statSync(file).size;
  if (Number.isInteger(download?.size) && download.size !== bytes) throw new OrbitError(`downloaded ${bytes} bytes but Mission Control said ${download.size}`, { code: 'download_failed' });
  return { bytes };
}
