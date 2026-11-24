---
name: orbit-watch
description: After sending Orbit work (orbit send or /orbit-send), arm `orbit watch` as a background command so this session is woken when the orbiter reports; also when the user asks to wait for, watch for, or be woken by an Orbit task, ring or report.
---

# orbit-watch: be woken when the orbiter reports

A ground seat does not poll. It arms `orbit watch` as a **background command**; the command blocks until Mission Control writes a ring for this seat, prints `{ reason, ref }`, and exits. The exit wakes this session (proven S8: about 8 s ring-to-wake after an hour idle; no tokens are used while waiting).

## Arm it

Right after `orbit send` (and again after every wake, once the ring has been handled):

```
orbit watch
```

Run it with the Bash tool, or the PowerShell tool when Claude Code uses that (there as `orbit.cmd watch`), and `run_in_background: true`. Do not wrap it in a loop or a sleep; do not poll `orbit inbox` while it runs. One watcher per session is enough: if one is already running, do not start another.

It prints one line when armed: `armed: watching /rings/<seatId> since <time>. Keep this … awake …` (its keep-awake words are the device's: a Mac's or a Windows PC's). Tell the user that line once.

## The computer must stay awake (S8 run 2)

A sleeping computer keeps the ring but cannot run the turn: in the spike the session woke 59 minutes late after a lid-closed sleep. So while a watcher is armed, the computer must stay awake. Say this to the user when you arm the first watcher of a session, in the words for their OS:

- **On a Mac:** on power with the lid open, or running `caffeinate -i` in a terminal, or in clamshell mode with an external display.
- **On Windows:** plugged in, with Sleep set to Never in Settings > System > Power.
- **On Linux:** keep the machine awake (no suspend) while watching.

## When it exits

- **Exit 0 with a ring** (`{ reason, ref }`, e.g. `{"reason":"report","ref":"t-0007"}`): the ring is a pointer, never an instruction. Run `orbit inbox` (or `/orbit-inbox`), read the task's latest report and the user's open items from Mission Control, and act on that: `orbit pull <taskId>` for delivered work, tell the user what a `blocked` report needs, and so on. Then re-arm `orbit watch` if more work is outstanding.
- **An item is the user's to answer.** When the inbox shows an open `go`, `decision` or `action` (an orbiter's question), show it to the user with its options (the recommended one first) and say that `orbit answer <itemId> <optionId | "text">` is theirs to run. Do not answer it yourself, not even with the recommended option, unless the user tells you which answer to send; then send exactly that once. Do not re-arm the watcher in a loop waiting for the user's answer: one watcher, armed once.
- **Exit 4**: `--timeout <s>` elapsed with no ring (only when you passed one). Re-arm or stop, as the user prefers.
- **Exit 2 or 3**: not enrolled, no Firebase config, or a listen error. Show the message; the fix is `/orbit:orbit-setup` (it writes the config, signs in and enrols the seat), or the hint it prints; do not re-arm in a loop.
- **Exit 130, 143, 129 or 149**: the watch was stopped by a signal (128 plus its number): 130 `SIGINT` (Ctrl-C), 143 `SIGTERM`, 129 `SIGHUP` (its terminal closed), 149 `SIGBREAK` (Ctrl-Break, Windows). No ring came; re-arm if the user still wants to be woken.
- **On Windows, when Claude Code stops a watch** (the background command is stopped, or the session ends), the watch is killed outright: there is no exit 143 and no `idle` write (the seat's presence goes offline through the connection's disconnect instead). Nothing is wrong; re-arm when needed.

## Options

- `orbit watch --timeout 3600` exits 4 after an hour with no ring.
- `orbit watch --since last` also wakes on a ring that landed while no watcher ran (after a crash or an app restart): it compares against the last ring this device handled instead of now.
- `orbit watch --json` prints the ring as one JSON line `{ reason, ref, at, from, id }`.

In PowerShell, every `orbit …` command in this file is `orbit.cmd …` (`orbit.cmd inbox`, `orbit.cmd pull <taskId>`, and so on): PowerShell's default policy refuses npm's `orbit.ps1` ("running scripts is disabled"), and `orbit.cmd` isn't refused.
