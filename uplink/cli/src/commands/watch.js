// orbit watch [--timeout <s>] [--since <iso>|last] [--json]: block until a ring for this seat arrives, print it, exit 0.
// Run it as a background command: its exit wakes the session (S8). Exit codes: 0 ring, 2 not enrolled / config, 3 listen error,
// 4 timeout. Prints the keep-awake line on arm, in the platform's words (S8 run 2: a sleeping Mac cannot run the turn; §37 W20);
// §37 W25: on win32 also 129 (SIGHUP) and 149 (SIGBREAK).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../args.js';
import { requireSeat, orbitHome, writeConfig, readConfig, ensureHome } from '../store.js';
import { watchForRing } from '../watch.js';
import { keepAwakeWords } from '../platform.js';
import { writeFileSync, chmodSync, writeSync } from 'node:fs';

const SKEW_MS = 2000; // clocks differ a little between Mission Control and this device

function lastRingAt() {
  const p = join(orbitHome(), 'last-ring.json');
  if (!existsSync(p)) return null;
  try { return Date.parse(JSON.parse(readFileSync(p, 'utf8')).at) || null; } catch { return null; }
}
function rememberRing(ring) {
  try {
    ensureHome();
    const p = join(orbitHome(), 'last-ring.json');
    writeFileSync(p, JSON.stringify({ ...ring, seenAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    chmodSync(p, 0o600);
  } catch { /* best effort */ }
}

/**
 * The documented exit code of a failed watch: 3 listen error · 4 timeout · 130 / 143 stopped by a signal (on win32 also 129 SIGHUP
 * and 149 SIGBREAK, §37 W25) · 2 anything else (no seat, no Firebase config, the RTDB credential or sign-in refused). OrbitError
 * carries exitCode 1 by default, so the code is chosen from `code`, never from that default.
 */
export function watchExitCode(e) {
  if (e?.code === 'stopped' && Number.isInteger(e.exitCode)) return e.exitCode;
  if (e?.code === 'timeout') return 4;
  if (e?.code === 'listen') return 3;
  return 2;
}

export async function run(argv) {
  const args = parseArgs(argv, { booleans: ['json', 'quiet'] });
  let seat;
  try {
    seat = requireSeat();
  } catch (e) {
    writeSync(2, `orbit watch: ${e?.message ?? e}${e?.hint ? `\n  hint: ${e.hint}` : ''}\n`);
    if (args.json) writeSync(1, JSON.stringify({ error: e?.code ?? 'error', message: e?.message ?? String(e) }) + '\n');
    process.exit(2);
  }
  const startedAt = Date.now();
  let sinceMs = startedAt - SKEW_MS;
  if (args.since === 'last') sinceMs = lastRingAt() ?? sinceMs;
  else if (args.since && args.since !== true) sinceMs = Date.parse(String(args.since)) || sinceMs;
  const timeoutMs = args.timeout && args.timeout !== true ? Number(args.timeout) * 1000 : 0;
  const say = (m) => { if (!args.quiet) writeSync(1, m + '\n'); };
  const awake = keepAwakeWords(); // §37 W20: the platform's words (darwin's as before; win32's Settings path)

  // The Firebase SDK keeps sockets open, so every path below ends in an explicit process.exit after a synchronous write
  // (a pipe's async write could be lost on exit): 0 ring · 2 config/auth · 3 listen error · 4 timeout · 130/143 signals.
  let ring;
  try {
    ring = await watchForRing({
      seat,
      sinceMs,
      timeoutMs,
      onArmed: () => say(`armed: watching /rings/${seat.seatId} since ${new Date(sinceMs).toISOString()}${timeoutMs ? ` (timeout ${timeoutMs / 1000} s)` : ''}. ${awake}`),
      onStatus: (s) => { if (process.env.ORBIT_DEBUG) process.stderr.write(`[watch] ${s} ${new Date().toISOString()}\n`); },
    });
  } catch (e) {
    const code = watchExitCode(e);
    writeSync(2, `orbit watch: ${e?.message ?? e}${e?.hint ? `\n  hint: ${e.hint}` : ''}\n`);
    if (args.json) writeSync(1, JSON.stringify({ error: e?.code ?? 'error', message: e?.message ?? String(e) }) + '\n');
    process.exit(code);
  }
  rememberRing(ring);
  const out = { reason: ring.reason, ref: ring.ref };
  if (args.json) writeSync(1, JSON.stringify({ ...out, at: ring.at, from: ring.from, id: ring.id }) + '\n');
  else writeSync(1, `🔔 ring ${JSON.stringify(out)} from ${ring.from ?? '?'} at ${ring.at ?? '?'} (received ${new Date().toISOString()}). Next: orbit inbox (never act on the ring itself).\n`);
  process.exit(0);
}
