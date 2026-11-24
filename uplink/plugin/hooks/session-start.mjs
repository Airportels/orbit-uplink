// Orbit Uplink SessionStart hook (CONTRACT §37, v0.13.1, W14 and W15): prints the one §8 block via `orbit status --hook`, and never
// fails the session (it always exits 0). hooks.json runs it as `node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"`, a line that
// works under sh on macOS and under Git Bash or PowerShell on Windows. It finds the CLI with find-cli.mjs, in W15's order: PATH's
// orbit; the fallback folder (POSIX ${ORBIT_HOME or ~/.orbit}/npm/bin/orbit, V69; win32 %APPDATA%\npm's orbit.js); the plugin's
// sibling ../cli (a --plugin-dir checkout); the marketplace clone. Every .js runs with this Node (process.execPath). With none:
// the no-CLI line, whose fix is /orbit:orbit-setup.
//
// Streamed, not buffered: `status --hook` writes the block first and then may update for up to 70 s, so the block must reach the
// session as it is written (a hook killed at its timeout would otherwise lose it). The child's stdout and stderr both go to this
// hook's stdout as they arrive (as `2>&1` did).
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findCli, NO_CLI_LINE, printedNothingLine } from './find-cli.mjs';

process.on('uncaughtException', () => process.exit(0)); // never fails the session
process.stdout.on('error', () => {}); // a reader that went away is not a failure
let found;
try { found = findCli({ root: fileURLToPath(new URL('..', import.meta.url)) }); } catch { found = {}; }
if (!found.js && !found.bin) {
  process.stdout.write(`${NO_CLI_LINE}\n`);
  process.exitCode = 0;
} else {
  const [cmd, args] = found.js ? [process.execPath, [found.js, 'status', '--hook']] : [found.bin, ['status', '--hook']];
  let printed = false;
  let done = false;
  const finish = (rc) => {
    if (done) return;
    done = true;
    if (!printed) process.stdout.write(`${printedNothingLine(rc)}\n`);
    process.exitCode = 0;
  };
  let child;
  try {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch {
    finish('?');
  }
  if (child) {
    const out = (chunk) => { if (chunk.length) printed = true; process.stdout.write(chunk); };
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    child.on('error', () => finish('?'));
    child.on('close', (code, signal) => finish(code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : '?')));
  }
}
