---
description: Set this device up as an Orbit seat in one command (orbit setup) - checks Node and Git (and offers to install them), installs the orbit CLI, signs in with Google, enrols the seat
argument-hint: [--account <label>] [--station <s>]
allowed-tools: Bash(node --version:*), PowerShell(node --version:*), Bash(orbit status:*), PowerShell(orbit.cmd status:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup), Bash(/bin/bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.sh" check), PowerShell(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.ps1" check), Bash(powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.ps1" check)
---

Set this device up as an Orbit seat with `orbit setup`. Arguments given: `$ARGUMENTS`. The plugin comes from `Airportels/orbit-uplink` (added in the Claude app's Customize → Plugins, or as the `orbit` marketplace in a terminal). It works on macOS and on Windows 10 or 11.

When the person writes in Thai, give every text below in its Thai form (TH); otherwise in English (EN). Where a text says `{…}`, fill it in as the step says.

1. **Check Node and Git first.** Run every command here with the Bash tool, or the PowerShell tool when Claude Code uses that.
   1. **Run `node --version` alone.** Remember what it printed: a version (`v22.…` or newer is enough for Orbit), an older version, or nothing (the command isn't found).
   2. **On macOS or Windows, always run the platform's `check` next.** It only reads, and it is pre-approved:
      - **macOS:** `/bin/bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.sh" check`
      - **Windows** (the same line from the PowerShell tool or Git Bash): `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.ps1" check`

      **On any other platform** (Linux, WSL) there is no `check`: if Node is missing or older than 22, stop here and tell the person the Mac Node words of 1.5 below, exactly, and do nothing else; otherwise go on to step 2.
   3. **Act on `check`'s key lines** (`KEY=value`, one fact per line; show every other line as it is). In this order:
      - **`MANAGED=` or `MANUAL=`:** give the person the words for it (1.5), and stop. Never install, uninstall or change a version manager or Homebrew.
      - **One or more `OFFER_` keys** (`OFFER_NODE=24`, `OFFER_GIT=1`): ask once, with the question in 1.4, naming everything offered. On anything but a clear yes, give the manual words for each offered tool (1.5), and stop. On yes, run the platform's `install` (the same line as `check`, with `install` in place of `check`) with a 10-minute timeout (600000 ms); it is never pre-approved, so Claude Code asks first. Then act on `install`'s key lines:
        - **`NODE=` and `GIT=`:** go on to step 2.
        - **`FAILED=`, `PENDING=` or `BUSY=`:** the words for each (1.5), and stop.
        - **No key line after `install`:**
          - (a) Claude Code reported that the call moved to the background: the `BUSY` words (1.5). Never wait for, poll or restart a backgrounded install.
          - (b) The call was refused: the `!` line (1.6), and nothing else.
          - (c) It ran and ended with no key line: show its output, then the manual words for each offered tool (1.5), and stop.
      - **`NODE=` and `GIT=`, and nothing else to act on:** go on to step 2. Keep `NODE=`'s path, and whether `NODE_OFF_PATH=1` or `GIT_OFF_PATH=1` was printed: step 3, step 5 and step 6 use them.
      - **`check` ran and printed no key line** (for example, a Group Policy refuses the script): if 1.1's `node --version` printed v22 or newer, go on to step 2 and then step 3 with its usual line: the first one, or the one with ` $ARGUMENTS` when the person gave arguments, never a `NODE=` line (a missing git is then reported by setup's own check, in its own words); otherwise, show its output, then the manual Node words (1.5), and stop. Never change an execution policy or try another way to run the script.
      - **`check` was refused by Claude Code:** the `!` line (1.6) only.
   4. **The question** (fill `{…}` from the keys: `Node.js 24` for `OFFER_NODE=24`, `Git` for `OFFER_GIT=1`, both when both; `, replacing Node.js <v>` only with `REPLACES=<v>`; `it` for one tool, `them` for two; the source `winget, Microsoft's package manager` on Windows, `nodejs.org, and Apple for Git` on a Mac; the licence sentence only on Windows; the Git Bash sentence only when Git is offered on Windows):
      - EN: "Orbit needs {Node.js 24 | Git | Node.js 24 and Git} on this computer{, replacing Node.js <v>}. I can install {it | them} now from {winget, Microsoft's package manager | nodejs.org, and Apple for Git}. An administrator must approve: a Windows prompt, or an administrator's name and password in the Mac Installer.{ On Windows this accepts the packages' licences (Node.js: MIT; Git: GPLv2).}{ After Git is installed, Claude Code may use Git Bash for commands once you reopen the app.} Install now?"
      - TH: "Orbit ต้องใช้ {Node.js 24 | Git | Node.js 24 และ Git} บนเครื่องนี้{ (แทน Node.js <v> ที่มีอยู่)} ผมติดตั้งให้ได้เลยจาก {winget ตัวจัดการแพ็กเกจของ Microsoft | nodejs.org และ Apple สำหรับ Git} ต้องให้ผู้ดูแลเครื่องอนุมัติ: หน้าต่างยืนยันของ Windows หรือชื่อและรหัสผ่านผู้ดูแลในตัวติดตั้งของ Mac{ บน Windows เป็นการยอมรับสัญญาอนุญาตของแพ็กเกจด้วย (Node.js: MIT, Git: GPLv2)}{ หลังติดตั้ง Git เมื่อเปิดแอปใหม่ Claude Code อาจใช้ Git Bash รันคำสั่ง} ติดตั้งเลยไหม?"
   5. **The words.** Give them exactly. In a Thai reply, the default manual words below stay in English, after the Thai lead-in "ติดตั้งเองได้ตามนี้:".
      - **The manual words** (when the person says no; for `MANUAL=` without its own text; when `check` printed no key line while Node is missing or older than 22). By default, the Node or Git words for their operating system:
        - **Node, on a Mac** (or Linux): "Install Node.js 22 or newer: download the macOS installer from https://nodejs.org and open it (or, if you use Homebrew, `brew install node`). Then start a new Claude Code session and run /orbit:orbit-setup again."
        - **Node, on Windows:** "Install Node.js 22 or newer: download the Windows Installer (.msi) from https://nodejs.org and run it, keeping its default options (or, in PowerShell, `winget install OpenJS.NodeJS.LTS`). Then quit and reopen the Claude app (or your terminal), start a new Claude Code session and run /orbit:orbit-setup again."
        - **Git, on a Mac:** "Install git: run `xcode-select --install` in Terminal, or type `git` there and macOS offers to install it. If a window offers to install the command line developer tools, click Install, then run /orbit:orbit-setup again."
        - **Git, on Windows:** "Install Git for Windows from https://git-scm.com/downloads/win, keeping its recommended PATH option (or, in PowerShell, `winget install --id Git.Git -e --source winget`). Then quit and reopen the Claude app (or your terminal), start a new Claude Code session and run /orbit:orbit-setup again."
      - **`MANUAL=node22_macos`** (in place of the Node words):
        - EN: "Install Node.js 22: download the Node.js 22 macOS installer (.pkg) from https://nodejs.org/en/download and open it (Node.js 24 and newer need macOS 13.5 or later). Then start a new Claude Code session and run /orbit:orbit-setup again."
        - TH: "ติดตั้ง Node.js 22: ดาวน์โหลดตัวติดตั้ง Node.js 22 สำหรับ macOS (.pkg) จาก https://nodejs.org/en/download แล้วเปิด (Node.js 24 ขึ้นไปต้องใช้ macOS 13.5 ขึ้นไป) จากนั้นเปิดเซสชันใหม่แล้วรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANUAL=macos_too_old`,** alone:
        - EN: "Orbit needs macOS 11 or later."
        - TH: "Orbit ต้องใช้ macOS 11 ขึ้นไป"
      - **`MANUAL=no_winget` or `MANUAL=old_winget`:** this lead-in, then the Windows Node or Git words for each tool that's missing:
        - EN: "winget isn't available on this PC (update 'App Installer' from the Microsoft Store), so install it yourself:"
        - TH: "เครื่องนี้ไม่มี winget ที่ใช้ได้ (อัปเดต 'App Installer' ใน Microsoft Store) ติดตั้งเองได้ตามนี้:"
      - **`MANUAL=xcode_license`:**
        - EN: "Git on this Mac needs the Xcode licence accepted: open Xcode once and accept it (or run `sudo xcodebuild -license accept` in Terminal yourself). Then start a new session and run /orbit:orbit-setup again."
        - TH: "Git บน Mac เครื่องนี้ต้องยอมรับสัญญาอนุญาต Xcode ก่อน: เปิด Xcode หนึ่งครั้งแล้วกดยอมรับ (หรือพิมพ์ `sudo xcodebuild -license accept` ใน Terminal เอง) จากนั้นเปิดเซสชันใหม่แล้วรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANUAL=xcode_path`:**
        - EN: "This Mac is set to use developer tools from a folder that no longer exists. Run `sudo xcode-select --reset` in Terminal yourself, then start a new session and run /orbit:orbit-setup again."
        - TH: "Mac เครื่องนี้ตั้งให้ใช้เครื่องมือนักพัฒนาจากโฟลเดอร์ที่ไม่มีอยู่แล้ว ให้พิมพ์ `sudo xcode-select --reset` ใน Terminal เอง แล้วเปิดเซสชันใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANUAL=git_broken`** (git's last line is the line before the key):
        - EN: "Git on this Mac doesn't run (the line above). Run `xcode-select --install` in Terminal yourself, then start a new session and run /orbit:orbit-setup again."
        - TH: "Git บน Mac เครื่องนี้รันไม่ได้ (ดูบรรทัดด้านบน) ให้พิมพ์ `xcode-select --install` ใน Terminal เอง แล้วเปิดเซสชันใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANAGED=<tool> <version>`:** these words, filling `{version}` and `{tool}` (nvm, nvm-windows, Volta, fnm, asdf, mise, n, Homebrew, Scoop or Chocolatey), then the command for that tool:
        - EN: "Your Node.js ({version}) comes from {tool} and is older than 22, so I won't install over it. Update it there, then start a new session and run /orbit:orbit-setup again:"
        - TH: "Node.js ของคุณ ({version}) มาจาก {tool} และเก่ากว่า 22 ผมจึงไม่ติดตั้งทับ ให้อัปเดตจาก {tool} แล้วเปิดเซสชันใหม่และรัน /orbit:orbit-setup อีกครั้ง:"
        - The command, by tool:
          - nvm: `nvm install 24 && nvm alias default 24`
          - fnm: `fnm install 24 && fnm default 24`
          - asdf: `asdf install nodejs latest:24`, then `asdf set -u nodejs <the version it printed>`
          - mise: `mise use -g node@24`
          - n: `n 24`
          - Homebrew: `brew upgrade node`
          - Volta on a Mac: `volta install node@24`
          - Scoop: `scoop update nodejs-lts`
          - Chocolatey: `choco upgrade nodejs-lts`
          - nvm-windows: `nvm install 24` then `nvm use 24`
        - **On a Mac running macOS 11.0–13.4** (the OS version Claude Code reports), each command names 22 where it says 24 (for example `nvm install 22 && nvm alias default 22`), and Homebrew's, in both forms, is `brew install node@22 && brew link --overwrite --force node@22`.
      - **`MANAGED=homebrew none`:**
        - EN: "Homebrew manages /usr/local on this Mac, so the Node.js installer would clash with it. Install Node.js with Homebrew: `brew install node`, then start a new session and run /orbit:orbit-setup again."
        - TH: "Homebrew ดูแล /usr/local บน Mac เครื่องนี้ ตัวติดตั้ง Node.js จะชนกับ Homebrew ให้ติดตั้งด้วย `brew install node` แล้วเปิดเซสชันใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANAGED=nvm-windows none`:**
        - EN: "nvm-windows manages Node.js here and has no version selected. Run `nvm install 24` then `nvm use 24`, then quit and reopen the Claude app and run /orbit:orbit-setup again."
        - TH: "nvm-windows ดูแล Node.js ในเครื่องนี้แต่ยังไม่ได้เลือกเวอร์ชัน ให้รัน `nvm install 24` แล้ว `nvm use 24` จากนั้นปิดแอป Claude แล้วเปิดใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANAGED=volta …` on Windows:**
        - EN: "Orbit doesn't support Volta on Windows (its global folder isn't on a new terminal's PATH). Install Node.js 22 or newer outside Volta, then quit and reopen the Claude app and run /orbit:orbit-setup again."
        - TH: "Orbit ใช้กับ Volta บน Windows ไม่ได้ (โฟลเดอร์ global ของ Volta ไม่อยู่ใน PATH ของ terminal ใหม่) ให้ติดตั้ง Node.js 22 ขึ้นไปโดยไม่ผ่าน Volta แล้วปิดแอป Claude เปิดใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`MANAGED=other <version>`:**
        - EN: "Your Node.js ({version}) is older than 22 and wasn't installed by the Node.js installer. Update it the way it was installed, then start a new session and run /orbit:orbit-setup again."
        - TH: "Node.js ของคุณ ({version}) เก่ากว่า 22 และไม่ได้ติดตั้งด้วยตัวติดตั้งของ Node.js ให้อัปเดตด้วยวิธีเดิมที่ติดตั้งไว้ แล้วเปิดเซสชันใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`FAILED=<tool>:<code>`,** filling `{Node.js}` with `Node.js` for `node` or `Git` for `git`:
        - `declined`, EN: "{Node.js} wasn't installed: the approval was cancelled, or the installer stopped. Nothing else changed. Run /orbit:orbit-setup again when you're ready."
        - `declined`, TH: "ยังไม่ได้ติดตั้ง {Node.js}: การอนุมัติถูกยกเลิกหรือตัวติดตั้งหยุดกลางทาง ไม่มีอะไรเปลี่ยน รัน /orbit:orbit-setup อีกครั้งเมื่อพร้อม"
        - `blocked`, EN: "This computer's policy blocked installing {Node.js}. If your organisation manages it, ask IT to install it." Try nothing else.
        - `blocked`, TH: "นโยบายของเครื่องนี้บล็อกการติดตั้ง {Node.js} ถ้าองค์กรดูแลเครื่องนี้อยู่ ให้แจ้ง IT ติดตั้งให้"
        - `no_gui`, EN: "The Node.js Installer can't open here (no screen session). Run /orbit:orbit-setup from the Claude app on this Mac, or install Node.js yourself:", then the manual words.
        - `no_gui`, TH: "เปิดตัวติดตั้ง Node.js ที่นี่ไม่ได้ (ไม่มีหน้าจอ) ให้รัน /orbit:orbit-setup จากแอป Claude บน Mac เครื่องนี้ หรือติดตั้งเองตามนี้:", then the manual words.
        - `download`, EN: "The download didn't finish. Check the network and run /orbit:orbit-setup again."
        - `download`, TH: "ดาวน์โหลดไม่สำเร็จ ตรวจเน็ตแล้วรัน /orbit:orbit-setup อีกครั้ง"
        - `bad_package`, EN: "The downloaded installer failed its checks, so it wasn't opened. Install Node.js yourself:", then the manual words.
        - `bad_package`, TH: "ตัวติดตั้งที่ดาวน์โหลดมาตรวจไม่ผ่าน จึงไม่ได้เปิด ติดตั้งเองตามนี้:", then the manual words.
        - `other`, EN: "{Node.js} didn't install:" and the line before the key.
        - `other`, TH: "ติดตั้ง {Node.js} ไม่สำเร็จ:" and the line before the key.
      - **`PENDING=clt`:**
        - EN: "Finish Apple's Command Line Tools install, then start a new session and run /orbit:orbit-setup again."
        - TH: "รอให้การติดตั้ง Command Line Tools ของ Apple เสร็จ แล้วเปิดเซสชันใหม่และรัน /orbit:orbit-setup อีกครั้ง"
      - **`BUSY=1`, and no key line after an `install` that moved to the background:**
        - EN: "An install is still running (a prompt or the Installer may be waiting behind other windows). When it has finished, run /orbit:orbit-setup again."
        - TH: "ยังมีการติดตั้งค้างอยู่ (อาจมีหน้าต่างยืนยันหรือตัวติดตั้งซ่อนอยู่หลังหน้าต่างอื่น) เมื่อเสร็จแล้วรัน /orbit:orbit-setup อีกครั้ง"
   6. **If a script call (`check` or `install`) is refused** (auto mode, a sandbox), give the person the line to type in Claude Code's prompt box, with `!` first, the plugin root filled in as an absolute path (the folder `${CLAUDE_PLUGIN_ROOT}` stands for; a `!` shell has no `CLAUDE_PLUGIN_ROOT`), and the refused subcommand (`check` or `install`) at the end:
      - **macOS:** `! /bin/bash "<the plugin root>/scripts/install-deps.sh" install`
      - **Windows** (the desktop app's `!` runs PowerShell): `! powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<the plugin root>/scripts/install-deps.ps1" install`
   7. **Never, in step 1:** run `sudo`, `installer`, `msiexec`, `winget`, `brew`, `xcode-select` or a version manager yourself; edit PATH; or work around `declined` or `blocked`. Only the two scripts install anything.
2. **Say what will happen:** a browser tab opens for Google sign-in; the person signs in with the Google account they were invited at (Orbit is invite only: an admin invites the account first).
3. **Start setup with the plugin's launcher, never PATH's `orbit`** (it may be an older CLI with no `setup`). Run it with the Bash tool, or the PowerShell tool when Claude Code uses that, with a 10-minute timeout (600000 ms). When the person gave no arguments (`$ARGUMENTS` is empty), run exactly this line, which is pre-approved:

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup`

   When they gave arguments, run this line instead, passing them through as they are (it asks for permission first):

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup $ARGUMENTS`

   **When `check` or `install` printed `NODE_OFF_PATH=1`** (the Node.js it found or installed isn't on this session's PATH yet), run the launcher with `NODE=`'s path in place of `node`, with ` $ARGUMENTS` at the end when they gave arguments. These aren't pre-approved, so Claude Code asks first:
   - Bash (macOS, or Git Bash): `"<NODE>" "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup`
   - PowerShell: `& "<NODE>" "${CLAUDE_PLUGIN_ROOT}/scripts/orbit-setup.mjs" setup`

   The launcher runs Orbit's CLI at this plugin's version with this Node. On a device without one it first fetches it from github.com/Airportels/orbit-uplink and says so; if the fetch fails, show the person its message as it is. Setup installs the CLI (up to 3 minutes), waits up to 5 minutes for the sign-in, then enrols the seat and checks it: the 10 minutes cover all of it.
4. **Show setup's output as it is.** Each step says `done`, `already` or `failed`. On a failed step, tell the person the fix setup printed, in its own words. **Never run a fix on your own**: never `sudo`, never `--force` (`orbit seat add --ground --force` replaces a seat: only the person decides that), never change PATH yourself, and never read or print `~/.orbit/*.json` (on Windows, `%USERPROFILE%\.orbit\*.json`).
5. **If the call is refused or sandboxed**, tell the person to type this line in Claude Code's prompt box, with the `!` first:

   `! node "<the plugin root>/scripts/orbit-setup.mjs" setup`

   Write it out with the plugin root filled in: the folder `${CLAUDE_PLUGIN_ROOT}` stood for in step 3, as an absolute path (a `!` shell has no `CLAUDE_PLUGIN_ROOT`), and with the person's arguments at the end when they gave some. Or they can run the same line, without the `!`, in a terminal (Terminal on a Mac; PowerShell or Windows Terminal on Windows). The likeliest cause on a Mac is a sandbox refusing setup's writes to `~/.orbit` (the CLI's copy in `~/.orbit/src`, or `~/.orbit/npm` when Node's global folder needs admin rights) or to a shell startup file (`~/.zshenv`, or bash's `~/.bashrc` and `~/.bash_profile`, `~/.bash_login` or `~/.profile`: it adds one PATH line); on Windows, to npm's global folder (`%APPDATA%\npm`). Setup also needs the network and a browser.

   **When step 3 used `NODE=`'s path** (`NODE_OFF_PATH=1`):
   - **On Windows,** give no absolute-node line (no single one works in both PowerShell and Git Bash, which `!` may run). Say instead: "Quit and reopen the Claude app (or your terminal), then start a new session: Windows gives Node.js and Git to apps started after the install. Then run /orbit:orbit-setup again." In the new session `node` is on PATH, so step 3 runs its usual line (the first one, or the one with ` $ARGUMENTS` when the person gave arguments), and the `!` line above works in both shells.
   - **On macOS:** `! "<NODE>" "<the plugin root>/scripts/orbit-setup.mjs" setup`, with `NODE=`'s path and the plugin root filled in, and the person's arguments at the end.
6. **End by asking the person to start a new Claude Code session** (in the Claude app, a new session in the Code tab): the plugin's SessionStart block then shows their seat. Running `/orbit:orbit-setup` again is safe: it keeps what works and repairs what doesn't.

   **When `NODE_OFF_PATH=1` or `GIT_OFF_PATH=1` was printed this run, or anything was installed,** end with these words instead:
   - **Windows,** EN: "Quit and reopen the Claude app (or your terminal), then start a new session: Windows gives Node.js and Git to apps started after the install."
   - **Windows,** TH: "ปิดแอป Claude (หรือ terminal) แล้วเปิดใหม่ จากนั้นเปิดเซสชันใหม่ Windows จะให้ Node.js และ Git กับแอปที่เปิดหลังการติดตั้งเท่านั้น"
   - **macOS:** "Start a new session."
