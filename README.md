# Orbit Uplink

Orbit runs teams of Claude Code sessions across devices and accounts. A session on your Mac (a ground seat) sends a task to a
session in the cloud (an Orbiter), which does the work and rings back when it is done; Mission Control keeps every task, report and
note. Uplink is what makes your Mac a seat: a Claude Code plugin (the session-start status block, the `/orbit:*` commands and the
`orbit-watch` skill) and the `orbit` command-line tool.

**Orbit is invite only: ask an admin** to invite your Google account before you start.

## You need

- macOS.
- Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it. Or, if you use Homebrew,
  `brew install node`, or nvm.
- git: run `xcode-select --install` in Terminal, or type `git` there and macOS offers to install it.
- Claude Code.
- The Google account an admin invited.

## Set up this Mac

In Claude Code, type these four lines, one at a time:

```
/plugin marketplace add Airportels/orbit-uplink
/plugin install orbit@orbit
/reload-plugins
/orbit:orbit-setup
```

`/orbit:orbit-setup` installs the `orbit` tool, opens a browser tab for Google sign-in (use the account you were invited at), and
makes this Mac your seat. Then start a new Claude Code session: its first block shows your seat. Running `/orbit:orbit-setup`
again is safe, and it is also how a broken setup is put right.

## Other ways in

**Claude Code in a terminal.** Type the same four lines at the `claude` prompt. Or, from a shell:

```
claude plugin marketplace add Airportels/orbit-uplink
claude plugin install orbit@orbit
node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/orbit/uplink/cli/bin/orbit.js" setup
```

The next `claude` session loads Orbit.

**Without Claude Code.**

```
git clone https://github.com/Airportels/orbit-uplink
node orbit-uplink/uplink/cli/bin/orbit.js setup
```

This gives the Mac the `orbit` tool, the sign-in and a seat. Orbit's Claude side (the session-start block, the `/orbit:*` commands
and the `orbit-watch` skill) comes only with the plugin, in Claude Code. To update, from the same folder:

```
git -C orbit-uplink pull
node orbit-uplink/uplink/cli/bin/orbit.js setup
```

The automatic update comes only with the plugin install.

**Another app built on Claude Code** (one built on the Agent SDK, or one that runs `claude`) gets Orbit's Claude side only when it
loads your installed plugins and runs their SessionStart hooks. Otherwise use the `orbit` tool in a terminal: `orbit send`,
`orbit inbox`, `orbit pull` and `orbit watch` work the same.

## About this code

This repository is generated from Airportels' private source, so comments may name files that aren't here. Don't send changes
here: it is rewritten on every release.

The code is Airportels' and is not licensed for reuse.
