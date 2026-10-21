---
name: red-agent
description: Hunt for bugs in the web view — launch `./skill-atlas serve`, explore it like a hostile user for a few minutes, then file a GitHub issue for each of the two or three most severe bugs found, with a description and a recorded video that shows the bug. Use when asked to find bugs, break, attack, red-team, or test the web view, or to file bugs about it.
---

# Red agent

Try to break the web view, then report the worst of what broke. A few real, severe, well-shown bugs are worth
more than a long list: each issue you file is something a person, or [issue-to-pr](../issue-to-pr/SKILL.md),
will have to read and act on.

## 1. Prepare

- Read [spec/web.md](../../../spec/web.md), and skim [spec/](../../../spec/) for the rest: a bug is the page doing
  something other than the spec says, or something no user would want even where the spec is silent.
- `npm ci` if there are no `node_modules`; `npx playwright install chromium` the first time.
- `export GITHUB_TOKEN=$(gh auth token)`, for GitHub's rate limit.
- Start the server: `./skill-atlas serve 0`, in the background; it prints its address.
- Read the open issues, so you don't file one twice:
  `gh issue list --repo anton-bannykh/ai-workshop-start --state all --label bug --limit 50`.

Put the scripts you explore with in a scratch directory outside the repository, or in `.demo/red-agent/`
(ignored). Never commit them.

## 2. Explore — about five minutes

Drive the page with throwaway Playwright scripts (`import { chromium } from 'playwright'`), screenshots to see what
happened, and `curl` for the API. Note every suspect as you go: what you did, what you expected, what happened.
Don't stop at the first bug, and don't polish anything yet.

Where bugs tend to be:

- **What a repository's files can do.** The spec says nothing in them runs. Make a directory under `/tmp` with
  skills whose SKILL.md has `<script>`, `<img onerror>`, `javascript:` links, HTML in the front matter, in the
  name and description, a huge file, odd encodings — and scan it. Check the list, both tabs, the hover, the filter.
- **The server.** `Host` other than the local address, methods other than `GET`, unknown paths, `..` in paths,
  a `repo` that is a local path outside what you meant, a missing or empty `repo`.
- **Input.** Links with a trailing slash, `.git`, `/tree/<branch>`, a query string, whitespace, upper case; a
  repository that doesn't exist, a private one, an empty one, an organization; `/?repo=…` with odd values.
- **Timing.** Scan again before the first scan ends, scan another link while an organization is being scanned,
  filter while scanning, press Enter twice, Back and Forward.
- **The page.** Filter text with regex characters or spaces; the counts while filtering against the list;
  Expand all / Collapse all with a filter; choosing a skill, then filtering it away; very long names and
  descriptions; a narrow window; the keyboard alone.
- **Consistency.** The same skill in the list, the formatted tab and the raw tab; the counts in the heading and
  in the summary; the page against the CLI's `./skill-atlas scan` for the same repository.

## 3. Pick the most severe

Confirm each suspect: reproduce it from a fresh page, twice. Drop what you can't reproduce, what the spec says on
purpose, and what an open issue already covers. Then rank them, most severe first:

1. **Security**: something from a repository runs in the page, the server answers another host or serves files it
   shouldn't.
2. **Wrong or lost data**: skills missing, shown under the wrong repository, wrong counts, the wrong SKILL.md shown.
3. **Broken flows**: a scan that hangs, crashes the server, or leaves the page stuck; a feature that doesn't work.
4. **Inconsistencies with the spec** a user would notice.
5. **Cosmetic**: layout, wording. File these only if nothing above was found.

File the top **two or three**, no more. Two symptoms of one cause are one bug, one issue.

## 4. Record each bug

A video, as [record-demo](../record-demo/SKILL.md) records one: the web view with the mouse visible, doing the
shortest thing that shows the bug, ending on the bug, on screen, with a pause to see it.

Write a scenario in `.demo/red-agent/<slug>.ts`:

```ts
import type { Demo } from '../../scripts/demo.ts';

export default async function unescapedName({ page, click, type, pause }: Demo) {
  await type(page.locator('#repo'), '/tmp/red-agent/html-in-name');
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await click(page.locator('#skills li.skill .name').first());
  await pause(2500); // the bug: here, for long enough to see it
}
```

```sh
npm run demo -- .demo/red-agent/<slug>.ts   # → .demo/<slug>.webp, .demo/<slug>-sheet.png
```

- Reproduce it on a GitHub repository when you can (JetBrains/kotlin, JetBrains/MPS…). When it takes files of
  your own, scan a directory under `/tmp/red-agent/` with a neutral name: its path shows in the video.
- Look at the sheet: the bug must be visible in it. If it isn't, fix the scenario — zoom in on it with a hover,
  a pause, a scroll — and record again.
- A bug only the API shows (a status code, a header): record what a user sees of it if anything does; the issue
  carries the `curl` that shows the rest.

## 5. File the issues

For each bug, most severe first:

1. Write the issue to a file, then create it with the `bug` label:
   `gh issue create --repo anton-bannykh/ai-workshop-start --label bug --title "…" --body-file …`. It prints
   the issue's link. The body:
   - One or two sentences: what is wrong, and why it matters (who it hurts, how badly).
   - **Steps to reproduce:** numbered, from `./skill-atlas serve`; the files to create, if any, inline, in full.
   - **Expected:** what should happen, with a link to the line of the spec when there is one.
   - **Actual:** what happens.
   - **Severity:** its rank from [step 3](#3-pick-the-most-severe), and why.
   - **Environment:** the commit (`git rev-parse --short HEAD`), the OS, the browser Playwright ran.
   - What you think the cause is, with `file:line`, only if you looked and are fairly sure; say how sure.
2. Publish the video for it: `npm run -s demo:publish -- --issue <number> .demo/<slug>.webp`. It prints the
   Markdown that shows it.
3. Add a `## Video` section at the end of the body, with that Markdown and one line on what it shows:
   `gh issue edit <number> --repo anton-bannykh/ai-workshop-start --body-file …`.
4. Open the issue in GitHub (`gh issue view <number> --repo anton-bannykh/ai-workshop-start`) and check it reads
   right and the video is there.
5. If you think an agent could fix it alone, add the `ai-go` label, which [issue-to-pr](../issue-to-pr/SKILL.md)
   picks up: `gh issue edit <number> --repo anton-bannykh/ai-workshop-start --add-label ai-go`. It can when all of
   these hold:
   - the expected behavior is clear, from the spec or beyond doubt, with no product decision to make;
   - the cause is in this repository's code, found and fairly sure, and the fix is small and local;
   - a test here can show the bug and then the fix: no live service, no special machine or permissions.

   Otherwise, leave it for a person, and end the body with one line on why: what needs deciding, or what is
   unknown.

## 6. Clean up and notify

- Stop the server. Leave `.demo/` as it is (ignored); remove `/tmp/red-agent/`.
- Tell the Slack channel `C0CAS41KRD3`, with `slack_post` as [issue-to-pr](../issue-to-pr/SKILL.md#slack) says:
  one message, each issue's link and title with its severity in a few words, and `ai-go` on those that have it.

## Report

To the user: the issues filed, with links, most severe first, each in a sentence, with whether it got `ai-go` and
why; the suspects you dropped and why (couldn't reproduce, already filed, by design, too minor); and what you didn't
get to explore.
