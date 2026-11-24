#!/usr/bin/env node
// orbit: the Uplink CLI (CONTRACT v0.5.2 §8, §14, §15, §16, §18; §20 (v0.8.0); §24 (v0.10.0); §32.1 lines 9 and 12 (v0.12.0); §33.4, §34.3,
// §35.2 and §36.4 (v0.13.0): generated slot ids, sign-in from any invited account, orbit setup, --version --check-deps). Node 22, ESM.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UPLINK_VERSION, CONTRACT_VERSION, CLI_ROOT } from '../src/version.js';
import { isWindows } from '../src/platform.js';

// §37 W20: on win32 the help names the real folder (%USERPROFILE%\.orbit), never ~/
const HOME_WORDS = isWindows() ? join(homedir(), '.orbit') : '~/.orbit';

const COMMANDS = {
  setup: () => import('../src/commands/setup.js'),
  login: () => import('../src/commands/login.js'),
  seat: () => import('../src/commands/seat.js'),
  enrol: () => import('../src/commands/enrol.js'),
  slot: () => import('../src/commands/slot.js'),
  admin: () => import('../src/commands/admin.js'),
  send: () => import('../src/commands/send.js'),
  stations: () => import('../src/commands/stations.js'),
  inbox: () => import('../src/commands/inbox.js'),
  answer: () => import('../src/commands/answer.js'),
  clear: () => import('../src/commands/clear.js'),
  pull: () => import('../src/commands/pull.js'),
  close: () => import('../src/commands/close.js'),
  watch: () => import('../src/commands/watch.js'),
  status: () => import('../src/commands/status.js'),
  update: () => import('../src/commands/update.js'),
  heartbeat: () => import('../src/commands/heartbeat.js'),
};

const HELP = `orbit ${UPLINK_VERSION} (contract ${CONTRACT_VERSION}): Orbit Uplink

  orbit setup [--station <s>] [--account <label>] [--config <file>] [--json]
                                                       set this device up in one go: checks Node 22+, git and npm, installs this CLI (a copy),
                                                       the config, the Google sign-in, the ground seat and its status; safe to run again
                                                       (it repairs what is broken). In Claude Code: /orbit:orbit-setup
  orbit login                                          person Google sign-in (browser); stores ${join(HOME_WORDS, 'person.json')} (Orbit is invite only:
                                                       an admin invites your Google account first)
  orbit seat add --ground [--account <label>]          enrol this device's ground seat
  orbit seat add --cloud --account <label>             print the preset first prompt for a new cloud seat (non-slot orbiters)
  orbit enrol [--if-needed] [--token <t>]              enrol with ORBIT_ENROL_TOKEN (cloud seats)
  orbit slot add --account <label> [--station s] [--key-to-stdout]
                                                       mint a pool slot (createSlot): Mission Control generates its id (obt-NNN), printed with
                                                       the key once on this terminal; paste instructions + the pool first prompt
  orbit slot rotate <seatId> [--key-to-stdout]         a fresh key for a slot (the old one dies at once); same seat id and doorbell
  orbit slot list [--station s]                        the station's slots: seat id, name, account, state, doorbell, lastSeenAt, slot state, epoch,
                                                       recycledAt, bound person
  orbit slot recycle <seatId> [--force]                a fresh session for a slot (recycleSlot, §16): epoch + 1, the old session fenced; --force releases its claimed/working tasks to ready
  orbit slot prompt <seatId>                           reprint the paste instructions and the pool first prompt for a slot (no key: it stays the network secret)
  orbit admin seats [--all] [--station s]              every seat of the station (listSeats): id, kind, account, state, lastSeenAt, slot state, epoch, retired; --all includes retired seats
  orbit admin cancel <taskId> --reason "..."           cancel any task but a closed or cancelled one (adminCancelTask); the reason is required
  orbit admin retire <seatId> [--force] [--yes]        retire a seat for good (retireSeat): its key dies at once; asks on a terminal unless --yes; --force cancels its claimed/working tasks
  orbit send <orbiterId> --title "..." [--brief-file f] (--subject <name> | --repo <path> --project <name> [--mode full|snapshot])
             [--space <id>]                            build in.bundle, create the task, upload, confirm (the orbiter is rung);
                                                       --space <id>: the station (a space) the task lives in (orbit send --help)
  orbit stations [--json]                              the stations (spaces) you are in: id, name, kind, open tasks
  orbit send --resume <taskId> [--repo <path>]         finish an interrupted send (rebuild, re-mint the upload, upload, confirm)
  orbit inbox [--json] [--all] [--fyi]                 my open items first (most urgent first; FYIs with --fyi), then my tasks, newest first, with their latest report
  orbit answer <itemId> [<optionId | "text">]          answer one of my items (answerItem, §20): a go's option, a decision's option or text, an action done;
                                                       a note on its task, and the seat is rung. Yours to run: a session answers only when you tell it to
  orbit clear <itemId>                                 clear one of my items (clearItem, §20): an action, wake, alert or fyi
  orbit pull <taskId> [--repo <path>] [--out <dir>]    bring the work home from out.bundle
  orbit close <taskId> [--pr <n>] [--force]            close a task I created (Mission Control merges a subject's factory PR server-side)
  orbit watch [--timeout <s>] [--json]                 block until a ring for this seat, print it, exit (background command)
  orbit status [--hook] [--json]                       seat, station, version, pending counts
  orbit update                                         update Uplink now
  orbit heartbeat [--state s] [--doorbell <pr>]        seat heartbeat; orbiters register their doorbell with it
  orbit --version [--check-deps]                       the version; --check-deps exits 1 when the CLI can't load its dependencies

Files: $ORBIT_HOME (default ${HOME_WORDS}): config.json, person.json, seat.json (all 0600); tmp/ for bundles in flight. Env: ORBIT_MC_URL.
A slot key is shown once on the terminal (never stdout unless --key-to-stdout, never in --json, never on disk); paste it into the
cloud environment's network secret for the Mission Control host (§15.6).
The device never touches the factory: code travels as git bundles through Mission Control (no gh, no GitHub credential).
`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    console.log(UPLINK_VERSION);
    // §35.2 step 2: --check-deps proves this installed copy can load its npm dependency (orbit watch needs firebase): exit 1 when not
    if (rest.includes('--check-deps')) {
      try {
        await import('firebase/app');
      } catch (e) {
        process.stderr.write(`orbit: firebase/app can't be loaded from ${CLI_ROOT} (${e.code ?? e.message}): reinstall the CLI (orbit setup)\n`);
        return 1;
      }
    }
    return 0;
  }
  const load = COMMANDS[cmd];
  if (!load) {
    process.stderr.write(`orbit: unknown command "${cmd}"\n${HELP}`);
    return 2;
  }
  const mod = await load();
  const code = await mod.run(rest);
  return typeof code === 'number' ? code : 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    const msg = err?.message ?? String(err);
    process.stderr.write(`orbit: ${msg}\n`);
    if (err?.hint) process.stderr.write(`  hint: ${err.hint}\n`);
    if (process.env.ORBIT_DEBUG) process.stderr.write((err?.stack ?? '') + '\n');
    process.exitCode = err?.exitCode ?? 1;
  },
);
