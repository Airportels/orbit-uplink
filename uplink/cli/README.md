# `orbit`: the Uplink CLI

`orbit` makes a Mac an Orbit seat: it signs you in, enrols this device, sends work to Orbiters (cloud Claude Code sessions), and
brings their results home. Node 22 or newer, ESM, one dependency (`firebase`, for the ring listener). The Claude Code plugin in
`../plugin` wraps it: the SessionStart block, `/orbit:orbit-setup`, `/orbit:orbit-send`, `/orbit:orbit-inbox`, `/orbit:orbit-pull`,
`/orbit:orbit-status` and the `orbit-watch` skill.

## Set up a Mac

Orbit is invite only: an admin invites your Google account first. Then, inside Claude Code:

```
/plugin marketplace add Airportels/orbit-uplink
/plugin install orbit@orbit
/reload-plugins
/orbit:orbit-setup
```

Start a new Claude Code session afterwards: its first block shows your seat. Without Claude Code:

```
git clone https://github.com/Airportels/orbit-uplink
node orbit-uplink/uplink/cli/bin/orbit.js setup
```

`orbit setup` runs six steps, and each says `done`, `already` (it was there and it works) or `failed`, with the fix:

1. **check:** Node 22 or newer, `git` and `npm` (`claude` is only noted: `orbit update` uses it later);
2. **cli:** installs this CLI as a copy (`npm pack`, then `npm install -g` of the `.tgz`) when `orbit` is missing, older, or can't load
   its dependencies; a newer one is kept. It goes in Node's global folder when you can write there (Homebrew's node, nvm). When that
   folder needs admin rights (the nodejs.org installer puts it in `/usr/local`), setup puts the CLI in your own folder instead,
   `~/.orbit/npm` (`$ORBIT_HOME/npm` when `ORBIT_HOME` is set), and adds one line, ending in `# added by orbit setup`, to your
   shell's startup file so new sessions find it: `~/.zshenv` for zsh; for bash, `~/.bashrc` and the login file bash reads, the
   first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists (it creates `~/.bash_profile` only when none does). The
   step's note names each file it changed; for another shell it changes no file and gives you the line to add. It never uses `sudo`
   and never changes npm's settings. In Node's global folder, the `orbit` your PATH finds must be the copy setup installed: when
   another one comes first, the step fails (`shadowed`), naming it and how to remove it, and runs after that don't install again;
3. **config:** `~/.orbit/config.json`, copied from `--config <file>` or the plugin's clone when missing; an existing one is kept;
4. **signin:** Google sign-in in the browser, kept when it still works;
5. **seat:** this device's ground seat, enrolled once and kept when it still works. A seat that no longer works, or isn't yours, is
   named, never replaced: replacing it is `orbit seat add --ground --force`, your call;
6. **status:** the same check as `orbit status`.

Running it again is safe, and it is how you repair a device. `--json` prints one JSON object (`steps`, `seatId`, `handle`,
`stationId`, and `failed: { step, code, fix }` when a step failed). It never prints a key, a token or an email address.

Two cases where the line in `~/.zshenv` isn't enough:

- **macOS `path_helper`:** a login zsh runs `/etc/zprofile` after `~/.zshenv`, and its `path_helper` puts the system folders,
  `/usr/local/bin` among them, ahead of the line. So an old `orbit` in `/usr/local/bin` (from an earlier `sudo npm install -g`, say)
  wins over the one in `~/.orbit/npm`: remove it (`sudo rm /usr/local/bin/orbit`).
- **`ZDOTDIR`:** with `ZDOTDIR` exported, zsh reads `$ZDOTDIR/.zshenv` instead of `~/.zshenv`: add the line there.

To undo the install in your own folder: remove the line ending in `# added by orbit setup` from each file the `cli` step named
(`~/.zshenv`, or `~/.bashrc` and bash's login file), and remove the folder `~/.orbit/npm`.

## Commands

```
orbit setup [--station <s>] [--account <label>] [--config <file>] [--json]   set this device up, or repair it (above)
orbit login                                           Google sign-in in the browser → ~/.orbit/person.json. Any Google account an admin invited;
                                                      a refusal says why (not invited, a domain Orbit doesn't take, an unverified email),
                                                      exits 1 and leaves person.json as it was
orbit seat add --ground [--account <label>]           enrol this device's ground seat → ~/.orbit/seat.json
orbit seat add --cloud --account <label>              a 30-day orbiter seat token and the first prompt for a cloud seat (non-slot orbiters)
orbit enrol [--if-needed] [--token <t>]               enrol with ORBIT_ENROL_TOKEN (a cloud seat's session start runs it)
orbit slot add --account <label> [--station s] [--key-to-stdout]   admins: mint a pool slot; Mission Control generates its id (obt-001),
                                                      printed with its key once on this terminal, the paste block and the slot's first prompt
orbit slot rotate <seatId> [--key-to-stdout]          admins: a fresh key for a slot (the old key dies at once); seat id and doorbell kept
orbit slot list [--station s]                         admins: the station's slots: seat id, name, account, state, doorbell, lastSeenAt,
                                                      slot state, epoch, recycledAt, bound person
orbit slot recycle <seatId> [--force] [--epoch <n>]   admins: a fresh session for a slot: epoch + 1, the old session stopped; --force
                                                      releases its claimed or working tasks to ready
orbit slot prompt <seatId>                            admins: the paste instructions and the first prompt again (never the key)
orbit admin seats [--all] [--station s]               admins: every seat of the station; --all includes retired seats
orbit admin cancel <taskId> --reason "…"              admins: cancel any task but a closed or cancelled one
orbit admin retire <seatId> [--force] [--yes]         admins: retire a seat for good (its key dies at once); asks on a terminal unless --yes
orbit send <orbiterId> --title "…" [--brief-file f] (--subject <name> | --repo <path> --project <name> [--mode full|snapshot]
           [--line <branch>] [--after <taskId>] [--touches a/,b/]) [--space <id>]   send a task; `orbit send --help` lists every flag
orbit send --resume <taskId> [--repo <path>]          finish an interrupted send
orbit stations [--json]                               the stations you are in: id, name, kind, open tasks (the id is what --space takes)
orbit inbox [--json] [--all] [--fyi]                  your open items first (most urgent first), then your tasks, newest first
orbit answer <itemId> [<optionId | "text">]           answer one of your items; a note on its task, and the seat is rung
orbit clear <itemId>                                  clear one of your items (an action, wake, alert or FYI)
orbit pull <taskId> [--repo <path>] [--out <dir>]     bring the work home
orbit close <taskId> [--pr <n>] [--force]             close a task you created
orbit watch [--timeout <s>] [--since last] [--json]   wait for a ring for this seat, print it, exit (a background command)
orbit status [--hook] [--json]                        seat, station, version, update notice, pending counts
orbit update                                          update the plugin and reinstall this CLI (as a copy)
orbit heartbeat [--state s] [--doorbell <pr>]         one heartbeat (orbiters register their doorbell with it)
orbit --version [--check-deps]                        the version; --check-deps exits 1 when the CLI can't load its dependencies
```

An example: `orbit send alice-orbiter-1 --subject plan --title "Draft the plan" --brief-file brief.md` sends a no-repo task to
alice's Orbiter.

## Files and environment

`$ORBIT_HOME` (default `~/.orbit`, mode 0700) holds `config.json`, `person.json` and `seat.json`, all 0600. A key or token is never
printed. `config.json` is the web config (`mcUrl`, the Firebase web config, `marketplace`): run `orbit setup` (or copy
setup/orbit-config.json); `config.example.json` shows its shape. Nothing on the device reaches the factory repo or needs a GitHub
credential.

| Variable | Meaning |
| --- | --- |
| `ORBIT_HOME` | where the three files live |
| `ORBIT_MC_URL` | Mission Control's base URL (overrides `config.json`) |
| `ORBIT_ENROL_TOKEN` | the orbiter seat token for `orbit enrol` (an environment secret in the cloud) |
| `ORBIT_DEBUG` | stack traces and the watcher's connection log |

## Seats

`orbit seat add --ground` and `orbit enrol` store `seat.json` the moment Mission Control answers, before the seat's details are read:
the key exists nowhere else by then. If reading them fails, the key stays stored, a warning says so, and the next `orbit status` or
`orbit send` completes the record.

## The inbox: items for you

An **item** is something waiting for you, not for a seat: an Orbiter's question (`go`: pick one of 2–5 options; `decision`: an
option or, where it allows, a text answer; `action`: something to do), or Mission Control's own (`wake`: start `orbit watch` on a
ground seat whose watcher isn't running; `alert`: a ring that failed, or a task delivered with a need; `fyi`: delivered, closed,
recycled, behind on Uplink). Items need `orbit login`; a seat key can't read them.

- `orbit inbox`: your open items (FYIs only with `--fyi`) above your tasks, the most urgent first: an item whose task is blocked, then
  go and decision, then action, then wake and alert. Each item shows its id, kind, task, title, who raised it, why, what it blocks,
  and its options with the recommended one first (marked `*`), then the command that closes it.
- `orbit answer <itemId> <optionId | "text">`: a word that is one of the item's option ids is sent as the option, anything else as
  text (only where the item allows text). `--option` / `--text` force one. An action takes no answer (`orbit answer <itemId>` =
  done). Your answer becomes a note on the task, a blocked task of yours is readied again, and its Orbiter is rung.
- `orbit clear <itemId>`: an action, wake, alert or FYI. A go or decision is answered, not cleared.
- A Claude session on this Mac **never answers an item on its own**: it shows the item and leaves `orbit answer` to you, unless you
  tell it which answer to send.

## Pool slots (admins): the key once, on the terminal

- `orbit slot add --account <label>` takes no name: Mission Control generates the slot's id (`obt-001`, `obt-002` …) and the command
  prints it. Name the cloud environment exactly that. The key is written **once to the terminal** (one line
  `SECRET  network secret value: <key>`), never to stdout unless `--key-to-stdout`, never into `--json`, never under `$ORBIT_HOME`.
  Without a terminal and without `--key-to-stdout` the command stops before anything is minted. stdout gets the paste block: the
  environment's name, the network secret (the host of Mission Control's URL, exactly; header `Authorization`; prefix `Bearer `), the
  variable `ORBIT_MC_URL`, and the slot's first prompt.
- `orbit slot rotate <seatId>`: the same print rule; the old key dies the moment the call answers (seat id and doorbell kept); paste
  the new value, then start a fresh session.
- `orbit slot list`: a table without hashes or keys, with each slot's display name (`-` while it has none) beside its id.
- `orbit slot recycle <seatId> [--force] [--epoch <n>]`: a fresh session for the slot. The old session is stopped on its next call to
  Mission Control; key and doorbell are kept. Claimed or working tasks refuse it unless `--force`, which releases them to `ready`. It
  prints the new epoch, the released tasks and the three steps (archive the old session, start a new one in the environment, paste
  the first prompt: `orbit slot prompt`). It sends the epoch you saw (`--epoch`, else the one `orbit slot list` shows just before):
  when someone recycled the slot meanwhile, nothing is done, it says so and exits 1.
- `orbit admin seats`, `orbit admin cancel <taskId> --reason "…"` and `orbit admin retire <seatId>`: every seat; cancelling any task
  but a closed or cancelled one (the reason is required); retiring a seat for good (its key dies at once, its id is never reused;
  claimed or working tasks refuse it unless `--force`). Retiring can't be undone, so the command asks on a terminal unless `--yes`.
  Without the permission, Mission Control answers `not_allowed` and the hint names what your role lacks.

## Bundles: this Mac never touches the factory

- `orbit send` builds a git bundle of your work in a throw-away repo under `$ORBIT_HOME/tmp` (nothing lands in your repo), creates
  the task, uploads the bundle to the signed URL Mission Control gives, and confirms it (the Orbiter is rung). `--subject <name>`
  is no-repo work; `--repo <path> --project <name>` sends your repo: the line's tip on its remote as the shared base, plus your
  `HEAD` when it differs (your unpushed commits ride on the task, never on the shared base). A file over 95 MB in history, Git LFS,
  a pack over 500 MB or a shallow clone switch it to snapshot mode (one commit of the current tree), and it says so.
- Stacking your own tasks: `--after <taskId>` waits on one of your own tasks and starts from its work; `--touches a/,b/` names the
  folders a task writes, and a send that overlaps one of your busy tasks stacks after it (`waiting on t-NNNN`).
- A send that fails after the task is created leaves it `sending`: `orbit send --resume <taskId>` finishes it. `orbit status` and
  `orbit inbox` list such tasks with that command.
- `orbit pull <taskId>`: own-repo work arrives as a local branch `orbit/<taskId>` (snapshot work as patches on it); no-repo work as
  files under `--out`. Uplink never pushes to your origin.
- `orbit close <taskId>`: Mission Control merges a no-repo task's result and closes the task; it refuses before `orbit pull` unless
  `--force`.

## Rings and updates

`orbit watch` listens for a ring for this seat and exits on the first one: 0 a ring, 2 no seat or a config, credential or sign-in
error, 3 a listen error, 4 `--timeout`, 130 / 143 stopped. `--since last` wakes on a ring that landed while no watcher ran.

`orbit login` serves its page on a one-shot local server; the page's callback must carry the login's random state, so no other page
can post a token to it.

`orbit update` updates the marketplace and the plugin, reinstalls this CLI as a copy from the plugin's clone, where the running
`orbit` lives (your own folder, `~/.orbit/npm`, when it runs from there; else Node's global folder), and checks `orbit --version`,
all within 60 seconds; the SessionStart hook runs it when a newer Uplink is out.
