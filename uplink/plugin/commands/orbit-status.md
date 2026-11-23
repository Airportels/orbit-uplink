---
description: Orbit seat status (station, seat, role, Uplink version, update notice, pending counts)
allowed-tools: Bash(orbit status:*)
---

Run `orbit status` with the Bash tool and show its output to the user verbatim, then one line on what to do next: pending tasks assigned to me → work them; reports waiting on me → `/orbit-inbox`; an update notice → follow it (STOP means update before any other Orbit action).

If the command fails because the device has no seat or is not signed in, or `orbit` isn't installed, say so and give the fix: `/orbit:orbit-setup` (it installs the CLI, signs in and enrols the seat; in a terminal, `orbit setup`). Never print the contents of `~/.orbit/seat.json` or `person.json`.
