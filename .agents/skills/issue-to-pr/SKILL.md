---
name: issue-to-pr
description: Fix the bug a GitHub issue describes — find the root cause, reproduce it in a test, fix it, verify, and open a PR that references the issue; if it can't be fixed, post the investigation on the issue. Use when asked to fix, resolve, or work on an issue (a number or a link) in this repository.
---

# Issue to PR

Take a bug report and turn it into a tested fix in a pull request — or, if that isn't possible, into findings
on the issue that the next person can start from.

## Which issue

- An issue number or link, as given.
- Read it all, the conversation too: `gh issue view <number> --repo anton-bannykh/ai-workshop-start --comments`.
  Note what is reported: the steps, what was expected, what happened, the version or environment.
- If it isn't a bug (a feature request, a question) or is too vague to reproduce, [ask](#ask-in-slack) before
  going on.

## Before you start

Mark that you started working - put an eyes emoji on the issue:
`gh api repos/anton-bannykh/ai-workshop-start/issues/<number>/reactions -f content=eyes`.

Branch off a current `main`: `git switch main && git pull && git switch -c fix/<number>-<short-slug>`.

## Ask in Slack

When the issue leaves a decision open, or you need something clarified — at any step — ask in the Slack channel
`C0CAS41KRD3`, wait, take the replies into account, and go on.

1. Collect your questions into one message: the issue's link, then each question numbered, with the options you
   see and the one you would pick. Ask only what changes what you do.
2. Post it. The bot token is in `SLACK_BOT_TOKEN`; don't print it.

   ```sh
   ts=$(jq -n --arg text "$message" '{channel: "C0CAS41KRD3", text: $text}' |
     curl -s -X POST https://slack.com/api/chat.postMessage \
       -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-Type: application/json; charset=utf-8' -d @- |
     jq -er .ts)
   ```

3. Wait for replies in the message's thread for **at least 10 minutes**, even if a first reply comes sooner
   (someone else may add to it or disagree); longer while a discussion is still going. Check once a minute:

   ```sh
   curl -s -G https://slack.com/api/conversations.replies -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     --data-urlencode channel=C0CAS41KRD3 --data-urlencode ts="$ts" |
     jq -r '.messages[1:][] | "\(.user): \(.text)"'
   ```

   If `chat.postMessage` or `conversations.replies` returns `"ok": false`, say so in the report with the error,
   and go on as below without waiting.
4. Take the answers into account. A question nobody answered: go on with the option you proposed, and say so —
   in the PR description's **Uncertainty**, or in the issue comment.

## 1. Find the root cause

1. Read [spec/](../../../spec/) for the behavior the issue is about: is what was reported a bug against the spec,
   or a gap in the spec?
2. Search the code from the symptom back to its cause: where the wrong output is made, then why. Keep asking
   "why" until the answer is a decision in the code, not another symptom.
3. Check the issue's description against what you found. If they diverge in a way that matters — the bug is
   elsewhere than the reporter thought, it has a different trigger, it affects more (or fewer) cases, it's
   actually two bugs — say so in an issue comment, with `file:line` links and your evidence:
   `gh issue comment <number> --repo anton-bannykh/ai-workshop-start --body-file …`.
   Don't comment for differences of wording.

## 2. Reproduce it in a test

- Add a test that fails the way the issue says, before you change any code. Run it and see it fail for the
  reported reason, not some other one.
- Prefer a fast unit test (`tests/*.test.ts`, `npm test`) over an e2e or visual one; use the slower kind only
  when the bug can't be reached otherwise.
- Name it after the behavior, not the issue number; link the issue in a comment above it if that helps a
  reader.

## 3. Fix the root cause

- Fix where the cause is, not where the symptom shows. A guard at the symptom only hides the bug from this one
  path; if you add one anyway (defense in depth), it comes on top of the real fix.
- Look for the same mistake elsewhere — the other callers, the sibling functions — and fix those too, with
  tests.
- Follow [AGENTS.md](../../../AGENTS.md): update the spec with the code, an integration test for every new or
  changed case. Keep the change as small as the fix allows; no unrelated refactoring.

## 4. Verify

1. The new test passes now.
2. Run a relevant subset of the regression tests, then the whole of `npm run typecheck` and `npm test`. Also
   `npm run test:visual` if the web view could change, and `npm run test:e2e` if the scan of GitHub changed.
3. If the environment isn't ready (no `node_modules`, no Docker, no `GITHUB_TOKEN`…), make **one** reasonable
   attempt to set it up (`npm ci`, `GITHUB_TOKEN=$(gh auth token)`, …). If it still can't run, don't keep
   trying: note what didn't run and why, and go on.
4. Double-check: re-read the whole diff against the issue, the root cause, and the spec.

## 5. Open the PR

1. Commit with a message that says what was wrong and why, not just what changed. Push the branch.
2. Open the PR against this fork:
   `gh pr create --repo anton-bannykh/ai-workshop-start --body-file …`. The description:
   - `Fixes #<number>`, so merging closes the issue.
   - **Root cause:** what was wrong, where (`file:line`), and why it produced what was reported.
   - **Fix:** what changed, and why there.
   - **Tests:** the test that reproduces it, and what else ran — and what didn't, and why.
   - **Uncertainty:** what you're not sure of — an assumption about the reporter's setup, a case you couldn't
     reproduce, a related bug you saw but left. Leave it out only if there is none.
   - The screenshots that changed ([visual-tests](../visual-tests/SKILL.md#in-the-pr)), and a demo, as
     [record-demo](../record-demo/SKILL.md) says, when the web view is involved.
3. Wait for CI: `gh pr checks <number> --repo anton-bannykh/ai-workshop-start --watch`. It must be green.

## If you can't fix it

Can't reproduce it, can't find the cause, or the fix needs a decision that isn't yours (a change to the spec,
a breaking change) — and [asking](#ask-in-slack) didn't settle it: don't open a PR with a guess. Post the
investigation on the issue instead:

- what you tried, and what happened;
- what you found: the code involved (`file:line`), what you ruled out and how;
- your best hypothesis and how sure you are of it;
- what would unblock it: a missing detail from the reporter, a decision, an environment.

A failing test that reproduces the bug is worth keeping even without a fix: push it to a branch and link it.

## Report

To the user: the issue and the PR (or the issue comment) with links; the root cause in a sentence or two, and how
it differs from the report, if it does; what you asked in Slack and the answers; what ran and what didn't; and what
you're still unsure of.
