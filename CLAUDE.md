# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A new project with no name, purpose or stack decided yet, currently an empty repo (only `README.md`, `.env`, `.gitignore`, an empty `docker-compose.yml`). The folder name is not the app's name.

When the first real code lands, replace this paragraph with a 2-3 line summary: stack, how it runs (e.g. via `docker-compose.yml`), ports, and the current scope.

## Commands

None yet. Add build/run/test/lint commands here as they appear, including any wrapper scripts and what environment they run in.

## Definition of done

A task is done only when:

1. Tests/linters (once they exist) pass, with new or changed behavior covered by tests.
2. The feature works in the running app (check it, don't just assume).
3. `CLAUDE.md` is updated for anything a future session needs to know (see "Keeping this file current"). Do not touch `README.md`.
4. No secrets committed, and never create, read or reference `.env.local`. If a secret is needed, ask the user where it should live.

## Architecture

Nothing yet. As structure emerges, add short entries here: key files/classes, routes, env vars, data/storage conventions, and non-obvious decisions (the *why*).

## Keeping this file current

**This file is a jumpstart for future sessions, not documentation or version control.** Update it in the same change whenever you add or change a feature, so the next session doesn't have to re-explore. Specifically:

- Add or adjust the entry in "Architecture" with the key files/classes, routes, env vars, and non-obvious decisions (the *why*, not a file listing).
- Record new commands, scripts, services/ports, env vars (never use `.env.local`), and data/schema conventions (how it is managed and where).
- Remove or correct anything that is no longer true. Replace the "nothing yet" placeholders above as they get filled in.
- Keep it concise; don't duplicate what the code makes obvious, and don't log history, changelogs or per-task details (that's what git is for). If an entry just restates what a quick look at the code would tell you, leave it out. Prefer a pointer to a file over a description of its contents.
- Before finishing any task, re-read this file and ask: would a fresh session be misled by anything here, or missing something it can't cheaply discover? Fix it.
- **Never edit `README.md`**; the user maintains it themselves. Put anything a future session needs in this file instead.
