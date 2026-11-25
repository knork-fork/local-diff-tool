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

## Usage

Open a terminal in the repo you want to review and run:

```bash
review
```

This opens the review UI for that repo in your browser. You can also pass a path: `review /absolute/path/to/repo`.

## Usage with Claude

1. Run `review` in the terminal (inside the repo).
2. Leave comments in the browser window that opens.
3. Tell Claude to run `review list-comments`.

Optionally, click "Copy cmd" on a specific comment and give Claude that command instead of `review list-comments`.

`list-comments` prints the unresolved comments (as `file:line` plus the thread) as plain text. It also works with a path (`review /absolute/path/to/repo list-comments`) or piped into any assistant, e.g. `review list-comments | claude "fix these review comments"`.

Each comment is listed with its id and a ready-to-run reply command. Claude (or you) can reply to a thread from the terminal (the text must be quoted). The reply shows up in the browser under the name `Agent` by default; to use another name, pass it as a last argument (`... 'text' 'Claude'`) or set `REVIEW_AUTHOR`:

```bash
review reply <comment id> 'Fixed by extracting a helper'
review /absolute/path/to/repo reply <comment id> 'Fixed by extracting a helper'
```

The `list-comments` output ends with instructions for coding agents on using `review reply`.
