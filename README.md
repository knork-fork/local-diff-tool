# local-diff-tool

Local Review: a local-first, GitLab-MR-style code review UI for uncommitted changes in any local git repo. It runs in a single Docker container on `127.0.0.1:22222`.

## Setup

1. Start the app:

   ```bash
   docker compose up -d --build
   ```

2. Install the `review` command:

   ```bash
   ./setup.sh
   ```

   It also installs the `/start-review` agent skill. By default it goes into `~/.claude/skills`, Claude Code's global (user-level) skills folder, and the script asks you first so you can pick another location.

## Usage

Open a terminal in the repo you want to review and run:

```bash
review
```

This opens the review UI for that repo in your browser. You can also pass a path: `review /absolute/path/to/repo`.

When a file you marked as reviewed changes again, it becomes unreviewed and the lines changed since your review are labelled NEW in the diff. Lines you had seen that no longer exist are shown struck through and labelled REMOVED, until you mark the file reviewed again.

## Usage with a coding agent (/start-review)

In a coding agent session (e.g. Claude Code, in the CLI or an IDE), run `/start-review` (optionally with a directory: `/start-review /absolute/path/to/repo`; the default is the session's current directory).

1. The review opens in your browser and the agent waits in the background.
2. Leave comments, then use the **Finish review** button in the top right:
   - **Send feedback** (hover the ▾, or press Ctrl+Enter when you are not typing a comment): the agent fixes what your comments ask, replies on each thread (or asks a follow-up question there) and keeps listening for more feedback. A spinner shows while it works; replies appear on existing threads on their own.
   - **Finish review**: same, but the conversation about this review ends. Run `/start-review` again to start another one.
3. The agent tells you how many threads it fixed directly and how many remain open with follow-up questions.

It is safe to run `/start-review` while comments already exist, and if you close the tab, running it again reopens the same review. The button is disabled when the page was opened with plain `review`.

## Manual usage with any coding agent

1. Run `review` in the terminal (inside the repo).
2. Leave comments in the browser window that opens.
3. Tell your coding agent to run `review list-comments`.

Optionally, click "Copy cmd" on a specific comment and give your agent that command instead of `review list-comments`.

`list-comments` prints the unresolved comments (as `file:line` plus the thread) as plain text. It also works with a path (`review /absolute/path/to/repo list-comments`) or piped into any assistant, e.g. `review list-comments | claude "fix these review comments"`.

Each comment is listed with its id and a ready-to-run reply command. The agent (or you) can reply to a thread from the terminal (the text must be quoted). The reply shows up in the browser under the name `Agent` by default; to use another name, pass it as a last argument (`... 'text' 'MyAgent'`) or set `REVIEW_AUTHOR`:

```bash
review reply <comment id> 'Fixed by extracting a helper'
review /absolute/path/to/repo reply <comment id> 'Fixed by extracting a helper'
```

The `list-comments` output ends with instructions for coding agents on using `review reply`.
