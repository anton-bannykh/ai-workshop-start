---
name: record-demo
description: Record a demo of the web view — an animated WebP with the mouse visible, walking through a normal flow of using it, or through a feature's capabilities — and attach it to the PR. Use when creating a PR, when pushing changes to one (including addressing review), or when asked to record or show a demo of the UI.
---

# Record a demo

Every PR carries a demo of the web view, in its description; every later push to it, in a comment. The
demo is an animated WebP of `./skill-atlas serve` as a user runs it, with the mouse drawn on the page:
sharp, at twice the page's pixels, and it plays inline on GitHub and in any browser, with nothing to download.

## What to show

- **A feature or a UI change:** what it adds, so a reviewer sees it working without running it. Start from
  the normal flow and use the feature the way a user would: every capability it brings, the cases the spec
  names (an empty result, a warning, an organization…), and how it fits with what was there.
- **Anything else:** the normal flow, `scripts/demos/flow.ts`, to show the page still works.

Keep it under about 30 s: one pass, no repeats. Pause where something changes, so it can be seen.

## Write the scenario

A scenario is a module whose default export gets a `Demo` (see `scripts/demo.ts`):
`click`, `type`, `move`, `scroll` and `pause`, which move the mouse like a hand, and `page`, the Playwright page.

```ts
import type { Demo } from '../demo.ts';

export default async function filter({ page, click, type, pause }: Demo) {
  await click(page.locator('#repo'));
  await page.keyboard.press('Tab'); // completes the sample link, JetBrains/kotlin
  await click(page.locator('#scan'));
  await page.locator('#skills li.skill').first().waitFor({ timeout: 60_000 });
  await type(page.locator('#filter'), 'bump');
  await pause(1500);
}
```

- Use the mouse for what a user clicks (`click`, `type`), not `locator.click()`: the demo shows the mouse.
- Click a skill by its `.name`: the rest of the item holds its link, which opens GitHub.
- Scan GitHub repositories, such as JetBrains/kotlin or JetBrains/MPS. Not a local directory: its `file://`
  links show the paths on this machine.
- A feature's scenario goes in `scripts/demos/<feature>.ts`, committed with the feature; update
  `scripts/demos/flow.ts` when the normal flow itself changes.

## Record and check

```sh
GITHUB_TOKEN=$(gh auth token) npm run demo -- scripts/demos/<feature>.ts   # → .demo/<feature>.webp
```

First time: `npx playwright install chromium`; `img2webp` must be installed (`brew install webp`).

Then look at it before publishing: `.demo/<feature>-sheet.png` has eight moments of the demo, evenly apart,
each with its time. The mouse must be visible, each click must have done what it should, and the feature
must be on screen. Fix the scenario and record again until it is right.

## Attach it to the PR

```sh
npm run -s demo:publish -- --pr <number> .demo/<feature>.webp
```

It uploads to the `demos` branch of `origin`, your fork, and prints the Markdown that shows it. Publish only the
`.webp`: the sheet is for checking.

- **Creating a PR:** open it, publish with its number, then add a `## Demo` section to the description with
  the Markdown and one line on what it shows: `gh pr edit <number> --repo anton-bannykh/ai-workshop-start --body-file …`.
- **Any later push:** record again, publish, and post the Markdown in a PR comment, with what changed since the
  last demo; also in the replies of `address-review`. Leave the description's demo as it was.

Never commit the recordings to the PR's branch: `.demo/` is ignored.
