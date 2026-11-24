---
description: Set this device up as an Orbit seat in one command (orbit setup) - checks Node, installs the orbit CLI, signs in with Google, enrols the seat
argument-hint: [--account <label>] [--station <s>]
allowed-tools: Bash(node --version:*), PowerShell(node --version:*), Bash(orbit status:*), PowerShell(orbit.cmd status:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup)
---

Set this device up as an Orbit seat with `orbit setup`. Arguments given: `$ARGUMENTS`. The plugin comes from `Airportels/orbit-uplink` (added in the Claude app's Customize → Plugins, or as the `orbit` marketplace in a terminal). It works on macOS and on Windows 10 or 11.

1. **Check Node first.** Run `node --version` with the Bash tool, or the PowerShell tool when Claude Code uses that. If Node is missing (the command isn't found), or older than 22, stop here and tell the person the words for their operating system, exactly, and do nothing else.
   - **On a Mac** (or Linux): "Install Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it (or, if you use Homebrew, `brew install node`). Then start a new Claude Code session and run /orbit:orbit-setup again."
   - **On Windows**: "Install Node.js 22 or newer: download the Windows Installer (.msi) from https://nodejs.org and run it, keeping its default options (or, in PowerShell, `winget install OpenJS.NodeJS.LTS`). Then quit and reopen the Claude app (or your terminal), start a new Claude Code session and run /orbit:orbit-setup again."
2. **Say what will happen:** a browser tab opens for Google sign-in; the person signs in with the Google account they were invited at (Orbit is invite only: an admin invites the account first).
3. **Start setup with the plugin's launcher, never PATH's `orbit`** (it may be an older CLI with no `setup`). Run it with the Bash tool, or the PowerShell tool when Claude Code uses that, with a 10-minute timeout (600000 ms). When the person gave no arguments (`$ARGUMENTS` is empty), run exactly this line, which is pre-approved:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup`

   When they gave arguments, run this line instead, passing them through as they are (it asks for permission first):

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup $ARGUMENTS`

   The launcher runs Orbit's CLI at this plugin's version with this Node. On a device without one it first fetches it from github.com/Airportels/orbit-uplink and says so; if the fetch fails, show the person its message as it is. Setup installs the CLI (up to 3 minutes), waits up to 5 minutes for the sign-in, then enrols the seat and checks it: the 10 minutes cover all of it.
4. **Show setup's output as it is.** Each step says `done`, `already` or `failed`. On a failed step, tell the person the fix setup printed, in its own words. **Never run a fix on your own**: never `sudo`, never `--force` (`orbit seat add --ground --force` replaces a seat: only the person decides that), never change PATH yourself, and never read or print `~/.orbit/*.json` (on Windows, `%USERPROFILE%\.orbit\*.json`).
5. **If the call is refused or sandboxed**, tell the person to type this line in Claude Code's prompt box, with the `!` first:

   `! node "<the plugin root>/scripts/orbit-setup.mjs" setup`

   Write it out with the plugin root filled in: the folder `${CLAUDE_PLUGIN_ROOT}` stood for in step 3, as an absolute path (a `!` shell has no `CLAUDE_PLUGIN_ROOT`), and with the person's arguments at the end when they gave some. Or they can run the same line, without the `!`, in a terminal (Terminal on a Mac; PowerShell or Windows Terminal on Windows). The likeliest cause on a Mac is a sandbox refusing setup's writes to `~/.orbit` (the CLI's copy in `~/.orbit/src`, or `~/.orbit/npm` when Node's global folder needs admin rights) or to a shell startup file (`~/.zshenv`, or bash's `~/.bashrc` and `~/.bash_profile`, `~/.bash_login` or `~/.profile`: it adds one PATH line); on Windows, to npm's global folder (`%APPDATA%\npm`). Setup also needs the network and a browser.
6. **End by asking the person to start a new Claude Code session** (in the Claude app, a new session in the Code tab): the plugin's SessionStart block then shows their seat. Running `/orbit:orbit-setup` again is safe: it keeps what works and repairs what doesn't.
