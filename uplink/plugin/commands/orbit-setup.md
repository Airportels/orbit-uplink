---
description: Set this device up as an Orbit seat in one command (orbit setup) - checks Node, installs the orbit CLI, signs in with Google, enrols the seat
argument-hint: [--account <label>] [--station <s>]
allowed-tools: Bash(node --version:*), PowerShell(node --version:*), Bash(orbit status:*), PowerShell(orbit.cmd status:*)
---

Set this device up as an Orbit seat with `orbit setup`. Arguments given: `$ARGUMENTS`. The plugin comes from the `orbit` marketplace (`Airportels/orbit-uplink`). It works on macOS and on Windows 10 or 11.

1. **Check Node first.** Run `node --version` with the Bash tool, or the PowerShell tool when Claude Code uses that. If Node is missing (the command isn't found), or older than 22, stop here and tell the person the words for their operating system, exactly, and do nothing else.
   - **On a Mac** (or Linux): "Install Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it (or, if you use Homebrew, `brew install node`). Then start a new Claude Code session and run /orbit:orbit-setup again."
   - **On Windows**: "Install Node.js 22 or newer: download the Windows Installer (.msi) from https://nodejs.org and run it, keeping its default options (or, in PowerShell, `winget install OpenJS.NodeJS.LTS`). Then close and reopen your terminal, start a new Claude Code session and run /orbit:orbit-setup again."
2. **Say what will happen:** a browser tab opens for Google sign-in; the person signs in with the Google account they were invited at (Orbit is invite only: an admin invites the account first).
3. **Start setup from the plugin's clone, never from PATH's `orbit`** (it may be an older CLI with no `setup`). Run this exact command with the Bash tool, or the PowerShell tool when Claude Code uses that, with a 10-minute timeout (600000 ms), and pass the arguments through as they are:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup $ARGUMENTS`

   It runs the marketplace clone's `orbit.js` with this Node. Setup installs the CLI (up to 3 minutes), waits up to 5 minutes for the sign-in, then enrols the seat and checks it: the 10 minutes cover all of it. If it says the clone wasn't found, show the paths it tried and its fix.
4. **Show setup's output as it is.** Each step says `done`, `already` or `failed`. On a failed step, tell the person the fix setup printed, in its own words. **Never run a fix on your own**: never `sudo`, never `--force` (`orbit seat add --ground --force` replaces a seat: only the person decides that), never change PATH yourself, and never read or print `~/.orbit/*.json` (on Windows, `%USERPROFILE%\.orbit\*.json`).
5. **If the call is refused or sandboxed**, give the person the same command to run in a terminal (Terminal on a Mac; PowerShell or Windows Terminal on Windows). The likeliest cause on a Mac is a sandbox refusing setup's writes to `~/.orbit/npm` (it installs the CLI there when Node's global folder needs admin rights) or to a shell startup file (`~/.zshenv`, or bash's `~/.bashrc` and `~/.bash_profile`, `~/.bash_login` or `~/.profile`: it adds one PATH line); on Windows, to npm's global folder (`%APPDATA%\npm`). Setup also needs the network and a browser:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup $ARGUMENTS`

6. **End by asking the person to start a new Claude Code session**: the plugin's SessionStart block then shows their seat. Running `/orbit:orbit-setup` again is safe: it keeps what works and repairs what doesn't.
