# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local Review: a local-first, GitLab-MR-style code review UI for uncommitted changes in any local git repo. React+Vite frontend (`web/`) and a Fastify+TypeScript backend (`server/`) served from ONE Docker container on `127.0.0.1:22222` (UI at `/`, REST at `/api/*`; no second port). ALL review data (discussions, reviewed files, settings) lives in this app's `data/<repo>-<hash>/branches/<branch>-<hash>/review.json` (one file per repo per branch) (bind-mounted to `/data`, git-ignored). Reviewed repos are never written to (home is mounted read-only).

## Commands

- Start app (user does this themselves; do not run it unasked): `HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose up -d --build`
- `./setup.sh` only symlinks `bin/review` to `~/.local/bin/review` (no docker). The `review` launcher does NOT start Compose. Keep `usage()` in `bin/review` in sync when adding commands. `reply` author = 4th arg, else `REVIEW_AUTHOR`, else `Agent`. The CLI comment commands use `Repo.cliComments`, which refreshes/re-anchors first so `line` = endLine on its side, as the UI shows it. Fastify `maxParamLength` is raised because repo ids (base64url of the path) exceed the 100 default for deep paths.
- `npm install` (root workspaces), `npm test` (vitest, server+web), `npm run typecheck`, `npm run build`.
- Dev without Docker: `APP_PORT=22299 ALLOWED_ROOTS=$HOME WEB_DIR=$PWD/web/dist node server/dist/index.js` after build (host Node is 18; image uses 22).

## Definition of done

A task is done only when:

1. Tests/linters (once they exist) pass, with new or changed behavior covered by tests.
2. The feature works in the running app (check it, don't just assume).
3. `CLAUDE.md` is updated for anything a future session needs to know (see "Keeping this file current"). Do not touch `README.md`.
4. No secrets committed, and never create, read or reference `.env.local`. If a secret is needed, ask the user where it should live.

## Architecture

- **Gotcha**: snap Docker rewrites `$HOME` for compose, so compose uses `HOST_HOME` (default `/home/$USER`), never `$HOME`.
- **Path mapping**: The home dir is bind-mounted read-only at the *same absolute path* inside the container so repo paths, symlinks and worktree `.git` pointers resolve identically. Other roots need an extra read-only volume + `ALLOWED_ROOTS` in `docker-compose.yml`. Repo id = base64url(repo root path) so the API is stateless across restarts.
- `server/src/git.ts`: ALL git access (native CLI, argv arrays, `--no-optional-locks`, `--literal-pathspecs`, no fsmonitor/ext-diff). Read-only by design. Listing = one `--raw -z` + one `-U0` patch, fingerprint = sha256 of the file's patch (untracked: content hash). Per-file diff is always full context (`-U1000000`); the frontend collapses/expands and reconstructs both file sides from it for Shiki highlighting. Unborn repos use the empty-tree hash as base.
- `server/src/store.ts`: only writer of `DATA_DIR` (lock file + temp file + atomic rename; malformed file => 500 `review_file_malformed`, never overwritten; `schemaVersion` + migrations map). `repo.ts`: business logic (scopes, reviewed invalidation, discussions, refresh; `Repo.store()` resolves the store for the current branch on every call). `anchor.ts`: comment relocation by content+context; unmatched/ambiguous => `outdated`. `app.ts`: routes + Host/Origin checks (localhost only, DNS-rebinding guard) + SPA fallback.
- Review state is keyed by `branch::scope` for reviewed files; discussions are keyed by branch and re-anchored by content against the current scope's file side on refresh. Scopes are `all` (default, = uncommitted incl. untracked), `staged`, `unstaged` (incl. untracked). There is no submit/export feature. `store.ts` seeds a new branch file from the legacy single `<repo>/review.json` if one exists (read-only).
- Frontend: `web/src/App.tsx` (state, only the selected file's diff is fetched), `DiffView.tsx` (custom unified/split renderer, drag on gutter "+" for multi-line comments), `rows.ts` (row building + gap collapsing), `Sidebar.tsx` (tree), `Thread.tsx`, (root comment has Copy URL / Copy ID + cmd buttons; the command uses the repo id from the URL as `<repo ref>`, and the command works), `Dialogs.tsx`. Custom renderer + Shiki instead of Pierre/react-diff-view. Theme is a localStorage pref; view mode/scope/context live in repo settings.
- Docker image is not verified by an automated test; Docker was not run during initial implementation (only `node server/dist/index.js` + the launcher were smoke-tested).

## Keeping this file current

**This file is a jumpstart for future sessions, not documentation or version control.** Update it in the same change whenever you add or change a feature, so the next session doesn't have to re-explore. Specifically:

- Add or adjust the entry in "Architecture" with the key files/classes, routes, env vars, and non-obvious decisions (the *why*, not a file listing).
- Record new commands, scripts, services/ports, env vars (never use `.env.local`), and data/schema conventions (how it is managed and where).
- Remove or correct anything that is no longer true. Replace the "nothing yet" placeholders above as they get filled in.
- Keep it concise; don't duplicate what the code makes obvious, and don't log history, changelogs or per-task details (that's what git is for). If an entry just restates what a quick look at the code would tell you, leave it out. Prefer a pointer to a file over a description of its contents.
- **Default to adding nothing.** Most features (UI behavior, thresholds, prompts, labels, copy, styling) need no entry: a session finds them by reading the code. Only add what a fresh session would get wrong or waste time rediscovering: gotchas, cross-file invariants, env/infra quirks, non-obvious *why*. Before adding a line, ask "would reading the relevant file make this obvious?"; if yes, skip it. Before finishing, also re-read the lines you added this task and delete any that fail that test.
- Before finishing any task, re-read this file and ask: would a fresh session be misled by anything here, or missing something it can't cheaply discover? Fix it.
- **Never edit `README.md`**; the user maintains it themselves. Put anything a future session needs in this file instead.
