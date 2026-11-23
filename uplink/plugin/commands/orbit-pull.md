---
description: Bring an Orbit task's work home from its out.bundle (own-repo → a local branch orbit/<taskId>; subject → ./orbit-pull/tasks/<taskId>)
argument-hint: <taskId> [--repo <path>] [--out <dir>]
allowed-tools: Bash(orbit pull:*), Bash(orbit inbox:*), Bash(orbit close:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*)
---

Run `orbit pull $ARGUMENTS` with the Bash tool (if no taskId was given, run `orbit inbox` first and ask which delivered task). It downloads the orbiter's `out.bundle` from Mission Control, verifies it and brings the work in; nothing on this Mac touches the factory. Show the output.

Then:
- **own-repo, full mode**: the work is on local branch `orbit/<taskId>`. Show `git log --oneline <current>..orbit/<taskId>` and offer to review the diff. Merging into the user's branch, and any push to their origin, is the user's own git action; Orbit never pushes to their origin.
- **own-repo, snapshot mode**: the orbiter's commits beyond the cut point were applied as patches on a new branch `orbit/<taskId>` cut from HEAD, and the repo is now on it. Show `git log --oneline -<n>` and `git status`.
- **subject**: the files are under the printed directory. List them and summarise `result.md` (or the main file) for the user.

When the user accepts the work, close the task with `orbit close <taskId>` (Mission Control merges a subject's factory PR into the subject's base server-side, so later tasks build on it, then deletes the task's bundles; it refuses to close a task whose result was never pulled unless `--force` is given).
