---
name: start-review
description: Start a Local Review session for the current repo (or a given directory), wait until the user finishes reviewing in the browser, then fix the review comments and reply to each thread. Use when the user runs /start-review.
disable-model-invocation: true
argument-hint: "[directory]"
---

# start-review

Runs a human code review of the uncommitted changes in the Local Review web UI, then addresses the comments.
Requires the `review` CLI on PATH and the Local Review app running (`docker compose up -d` in the app repo).

## 1. Pick the directory

Use the directory the user passed as the argument (any path inside the git repo), otherwise the current working directory.
Every `review` command below takes the directory as an optional first argument, before the command:

```
review [dir] <command>
```

Use the same `[dir]` for all commands in this skill. Omit it for the current directory.
## 2. Start (or resume) the session

```
review [dir] session-start
```

This opens the browser on the review with the review buttons enabled and prints `Session token: <token>`.
It is safe to run when comments already exist and when a session is already open: the repo's token is reused,
so if the user closed the tab, running `/start-review` again reopens it with the same token.
If the command fails (app not reachable, not a git repo), show the error to the user and stop.

## 3. Wait for the user (loop)

Tell the user the review is open. In the UI they can click **Send feedback** (keep talking) or **Finish review** (end it).
Wait in the background, without blocking the conversation:

```
review [dir] session-wait <token>
```

Run it as a background command (e.g. Bash with `run_in_background`) and do nothing else until it exits; do not poll it.
It prints one word and exits:

- `feedback`: the user left comments and expects you to continue. Do step 4, then run `session-wait` again (step 3) so you keep listening.
- `finished`: the user is done. Do step 4 if there are unresolved comments (if there are none, just wrap up), then run `review [dir] session-end <token>` to clear the token, then step 5. Do NOT wait again; the conversation about this review is over until the user runs `/start-review` again.

While you handle a `feedback` or `finished` round the review buttons are inert in the browser, so the user cannot send overlapping rounds.

If it exits with an error (unknown token), run `session-start` again.
If the user tells you in chat to stop the review, stop the background wait and end the loop.
(`review [dir] session-status <token>` prints `pending`, `feedback` or `finished` for a one-off, read-only check.)

## 4. Address the comments

```
review [dir] list-comments
```

This prints unresolved comment threads as `file:line`, the thread, and an `(id: ...)`. For each thread:

- Skip threads where the last message is already from the agent and the user has not answered since.
- If the comment asks for a change, make it in the code, then reply:
  `review [dir] reply <id> '<markdown text: what you changed>' '<your agent name>'`
- If it is unclear or a decision is needed, do not guess: reply on the thread with a follow-up question instead of changing code.
- If you disagree or decline, explain why in a reply.

Do not resolve or delete comments (the user resolves them). Quote reply text carefully (single quotes; escape embedded `'`).
Use `review [dir] list-comment <id>` to re-read one thread in full.

## 5. Report back

After each round, tell the user the comments were addressed with a short summary, for example:

> Addressed the review comments: 5 threads fixed directly, 2 still open with follow-up questions (see the replies in the review UI).

Count each unresolved thread you handled as either *fixed directly* (you changed code and replied) or *open with a follow-up question* (you asked a question or explained why not).
After `feedback`, add that you are still listening for more feedback; after `finished`, say the review is closed.
