---
description: Set this device up as an Orbit seat in one command (orbit setup) - checks Node, installs the orbit CLI, signs in with Google, enrols the seat
argument-hint: [--account <label>] [--station <s>]
allowed-tools: Bash(command -v node:*), Bash(node --version:*), Bash(orbit status:*)
---

Set this device up as an Orbit seat with `orbit setup`. Arguments given: `$ARGUMENTS`. The plugin comes from the `orbit` marketplace (`Airportels/orbit-uplink`).

1. **Check Node first.** Run `command -v node`, then `node --version`. If Node is missing, or older than 22, stop here and tell the person, in these words: "Install Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it (or, if you use Homebrew, `brew install node`). Then start a new Claude Code session and run /orbit:orbit-setup again." Do nothing else.
2. **Say what will happen:** a browser tab opens for Google sign-in; the person signs in with the Google account they were invited at (Orbit is invite only: an admin invites the account first).
3. **Start setup from the plugin's clone, never from PATH's `orbit`** (it may be an older CLI with no `setup`). Run this exact command with the Bash tool, with a 10-minute timeout (600000 ms), and pass the arguments through as they are:

   `node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/orbit/uplink/cli/bin/orbit.js" setup $ARGUMENTS`

   Setup installs the CLI (up to 3 minutes), waits up to 5 minutes for the sign-in, then enrols the seat and checks it: the 10 minutes cover all of it.
4. **Show setup's output as it is.** Each step says `done`, `already` or `failed`. On a failed step, tell the person the fix setup printed, in its own words. **Never run a fix on your own**: never `sudo`, never `--force` (`orbit seat add --ground --force` replaces a seat: only the person decides that), and never read or print `~/.orbit/*.json`.
5. **If the Bash call is refused or sandboxed**, give the person the same command to run in Terminal. The likeliest cause is a sandbox refusing setup's writes to `~/.orbit/npm` (it installs the CLI there when Node's global folder needs admin rights) or to a shell startup file (`~/.zshenv`, or bash's `~/.bashrc` and `~/.bash_profile`, `~/.bash_login` or `~/.profile`: it adds one PATH line); setup also needs the network and a browser:

   `node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/orbit/uplink/cli/bin/orbit.js" setup $ARGUMENTS`

6. **End by asking the person to start a new Claude Code session**: the plugin's SessionStart block then shows their seat. Running `/orbit:orbit-setup` again is safe: it keeps what works and repairs what doesn't.
