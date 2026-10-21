---
name: review
description: Short, common-sense code review of the current changes (or a given PR, branch, or path) — what the change does, its pros and cons, and concrete suggestions. Use when asked to review code, a diff, or a PR in this repository.
---

# Code review

Give a short, honest review. Aim for something a busy teammate reads in a minute.

## What to review

- Default: the current branch against `main` (`git diff main...HEAD`) plus uncommitted changes (`git diff HEAD`).
- If a PR number is given: `gh pr diff <number> --repo anton-bannykh/ai-workshop-start`.
- If a branch or path is given: review that instead.

## How

1. Read the diff, then open the touched files where context is needed.
2. Check the change against [spec/](../../../spec/): does the code match it, and was the spec updated with the code?
3. Check that every new or changed case in the spec has an integration test in `tests/`.
4. Run `npm test`; mention failures.
5. Look for the usual suspects: bugs and edge cases, unclear naming, dead or duplicated code, missing error handling, code that doesn't read like its surroundings.

## Output

```
**Summary** — one or two sentences: what the change does.

**Pros**
- what is good about it

**Cons**
- problems, most important first; reference `file:line`

**Suggestions**
- concrete, actionable fixes

**Verdict** — Approve / Approve with nits / Request changes
```

Keep it brief: skip empty sections, don't pad with praise, don't nitpick style the codebase doesn't care about. Don't edit code unless asked.

## Notify

When the review of a PR is done, tell the Slack channel `C0CAS41KRD3`, with `slack_post` as
[issue-to-pr](../issue-to-pr/SKILL.md#slack) says: the PR, the verdict and the main points in a few lines, and
a link to the full review.

The link: if the review isn't on the PR yet, post it (`gh pr comment <number> --repo anton-bannykh/ai-workshop-start
--body-file …` prints the comment's link). If whoever ran you posts it for you, link the PR.
