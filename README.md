# Orbit Uplink

Orbit runs teams of Claude Code sessions across devices and accounts. A session on your computer (a ground seat) sends a task to a
session in the cloud (an Orbiter), which does the work and rings back when it is done; Mission Control keeps every task, report and
note. Uplink is what makes your Mac or Windows PC a seat: a Claude Code plugin (the session-start status block, the `/orbit:*`
commands and the `orbit-watch` skill) and the `orbit` command-line tool.

**Orbit is invite only: ask an admin** to invite your Google account before you start.

## You need

- macOS, or Windows 10 or 11.
- Node.js 22 or newer.
  - On a Mac: download the macOS installer from https://nodejs.org and open it. Or, if you use Homebrew, `brew install node`, or
    nvm.
  - On Windows: download the Windows Installer (.msi) from https://nodejs.org and run it, keeping its default options (or, in
    PowerShell, `winget install OpenJS.NodeJS.LTS`). Volta isn't supported.
- git.
  - On a Mac: run `xcode-select --install` in Terminal, or type `git` there and macOS offers to install it. If a window offers to
    install the command line developer tools, click Install.
  - On Windows: install Git for Windows from https://git-scm.com/downloads/win, keeping its recommended PATH option (or, in
    PowerShell, `winget install --id Git.Git -e --source winget`).
- The Claude desktop app (its **Code** tab), or Claude Code in a terminal.
- The Google account an admin invited.

After installing Node.js or git, quit and reopen the Claude app (or your terminal) and start a new Claude Code session before you go
on.

## Set up this computer

1. In the Claude desktop app: **Customize → Plugins → Add marketplace → Add from a repository**, enter `Airportels/orbit-uplink`,
   and install **Orbit**. On claude.ai the steps are the same.
2. In the desktop app's **Code** tab, or Claude Code in a terminal: type `/orbit:orbit-setup`, then sign in with Google (use the
   account you were invited at). If Claude asks, click **Allow**.

`/orbit:orbit-setup` fetches and installs the `orbit` tool, opens a browser tab for the Google sign-in, and makes this computer your
seat. Then start a new Claude Code session: its first block shows your seat. Running `/orbit:orbit-setup` again is safe, and it is
also how a broken setup is put right.

- **The Chat tab can't run Orbit.** Use the Code tab, or Claude Code in a terminal.
- **Install Orbit from one place only:** the click path above, or the terminal marketplace below, not both.

## Other ways in

**Claude Code in a terminal** (Claude Code 2.1.275 or later):

```
/plugin install orbit --marketplace Airportels/orbit-uplink
/reload-plugins
/orbit:orbit-setup
```

**Older Claude Code.** Type these four lines, one at a time:

```
/plugin marketplace add Airportels/orbit-uplink
/plugin install orbit@orbit
/reload-plugins
/orbit:orbit-setup
```

**From a shell:**

```
claude plugin marketplace add Airportels/orbit-uplink
claude plugin install orbit@orbit
node "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/orbit/uplink/cli/bin/orbit.js" setup
```

On Windows, in PowerShell, the last line is:

```
node "$env:USERPROFILE\.claude\plugins\marketplaces\orbit\uplink\cli\bin\orbit.js" setup
```

The next `claude` session loads Orbit.

**Without Claude Code.**

```
git clone https://github.com/Airportels/orbit-uplink
node orbit-uplink/uplink/cli/bin/orbit.js setup
```

This gives the computer the `orbit` tool, the sign-in and a seat. Orbit's Claude side (the session-start block, the `/orbit:*` commands
and the `orbit-watch` skill) comes only with the plugin, in Claude Code. To update, from the same folder:

```
git -C orbit-uplink pull
node orbit-uplink/uplink/cli/bin/orbit.js setup
```

The automatic update comes only with the plugin install.

**Another app built on Claude Code** (one built on the Agent SDK, or one that runs `claude`) gets Orbit's Claude side only when it
loads your installed plugins and runs their SessionStart hooks. Otherwise use the `orbit` tool in a terminal: `orbit send`,
`orbit inbox`, `orbit pull` and `orbit watch` work the same.

## If it says…

**"… checkout … not found … /plugin marketplace add".** Your Orbit plugin is older than 0.13.2. Remove it in **Customize → Plugins**,
and add it again (the click path above).

**`not_on_path` (Windows).** npm's global folder isn't on your PATH. Press Win+R and run
`rundll32 sysdm.cpl,EditEnvironmentVariables`. Under your user variables select Path, click Edit, then New, paste the folder setup
named (skip this if it's already listed), and click OK twice. Then close every terminal window and Claude Code, open a new terminal
and run /orbit:orbit-setup again.

**"running scripts is disabled" (Windows, in PowerShell).** PowerShell's default policy refuses the `orbit.ps1` that npm makes. Type
`orbit.cmd` instead of `orbit` (for example `orbit.cmd status`), or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

**The marketplace add is refused because a marketplace named `orbit` is already declared.** Your user settings declare an older
one. Open your user settings file (`%USERPROFILE%\.claude\settings.json` on Windows, `~/.claude/settings.json` on a Mac) and find
`extraKnownMarketplaces` → `orbit`. Change its `repo` to `Airportels/orbit-uplink`, or delete that entry. Then run the add again.

## About this code

This repository is generated from Airportels' private source, so comments may name files that aren't here. Don't send changes
here: it is rewritten on every release.

The code is Airportels' and is not licensed for reuse.
