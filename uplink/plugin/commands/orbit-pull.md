---
description: Bring an Orbit task's work home from its out.bundle (own-repo → a local branch orbit/<taskId>; subject → ./orbit-pull/tasks/<taskId>)
argument-hint: <taskId> [--repo <path>] [--out <dir>]
allowed-tools: Bash(orbit pull:*), PowerShell(orbit.cmd pull:*), Bash(orbit inbox:*), PowerShell(orbit.cmd inbox:*), Bash(orbit close:*), PowerShell(orbit.cmd close:*), Bash(git log:*), PowerShell(git log:*), Bash(git diff:*), PowerShell(git diff:*), Bash(git status:*), PowerShell(git status:*)
---

Run `orbit pull $ARGUMENTS` with the Bash tool, or the PowerShell tool when Claude Code uses that (there as `orbit.cmd pull $ARGUMENTS`) (if no taskId was given, run `orbit inbox` first and ask which delivered task). It downloads the orbiter's `out.bundle` from Mission Control, verifies it and brings the work in; nothing on this computer touches the factory. Show the output.

Then:
- **own-repo, full mode**: the work is on local branch `orbit/<taskId>`. Show `git log --oneline <current>..orbit/<taskId>` and offer to review the diff. Merging into the user's branch, and any push to their origin, is the user's own git action; Orbit never pushes to their origin.
- **own-repo, snapshot mode**: the orbiter's commits beyond the cut point were applied as patches on a new branch `orbit/<taskId>` cut from HEAD, and the repo is now on it. Show `git log --oneline -<n>` and `git status`.
- **subject**: the files are under the printed directory. List them and summarise `result.md` (or the main file) for the user.

When the user accepts the work, close the task with `orbit close <taskId>` (Mission Control merges a subject's factory PR into the subject's base server-side, so later tasks build on it, then deletes the task's bundles; it refuses to close a task whose result was never pulled unless `--force` is given).

In PowerShell, every `orbit …` command in this file is `orbit.cmd …` (`orbit.cmd inbox`, `orbit.cmd pull <taskId>`, and so on): PowerShell's default policy refuses npm's `orbit.ps1` ("running scripts is disabled"), and `orbit.cmd` isn't refused.
