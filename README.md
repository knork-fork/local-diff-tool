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

## Listing comments

Print the unresolved comments (as `file:line` plus the thread) from the terminal:

```bash
review /absolute/path/to/repo list-comments
# or, from inside the repo directory:
review list-comments
```

The output is plain text, so you can hand it to Claude or any other AI assistant/tool to have the review comments addressed, e.g. `review list-comments | claude "fix these review comments"`.

Each comment is listed with its id and a ready-to-run reply command. Reply to a thread from the terminal (the text must be quoted; posted as author `Agent`, override with `REVIEW_AUTHOR`):

```bash
review reply <comment id> 'Fixed by extracting a helper'
review /absolute/path/to/repo reply <comment id> 'Fixed by extracting a helper'
```

The `list-comments` output ends with instructions for coding agents on using `review reply`.
