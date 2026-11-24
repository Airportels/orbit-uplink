---
description: Orbit seat status (station, seat, role, Uplink version, update notice, pending counts)
allowed-tools: Bash(orbit status:*), PowerShell(orbit.cmd status:*)
---

Run `orbit status` with the Bash tool, or the PowerShell tool when Claude Code uses that (there as `orbit.cmd status`), and show its output to the user verbatim, then one line on what to do next: pending tasks assigned to me → work them; reports waiting on me → `/orbit-inbox`; an update notice → follow it (STOP means update before any other Orbit action).

If the command fails because the device has no seat or is not signed in, or `orbit` isn't installed, say so and give the fix: `/orbit:orbit-setup` (it installs the CLI, signs in and enrols the seat; in a terminal, `orbit setup`). Never print the contents of `~/.orbit/seat.json` or `person.json`.

In PowerShell, every `orbit …` command in this file is `orbit.cmd …` (`orbit.cmd inbox`, `orbit.cmd pull <taskId>`, and so on): PowerShell's default policy refuses npm's `orbit.ps1` ("running scripts is disabled"), and `orbit.cmd` isn't refused.
