---
name: visual-tests
description: Keep the web view's screenshot tests in step with every change — run them, update the screenshots in tests/visual/screenshots when the page changed on purpose, check each one, and commit them with the change so the PR shows old and new side by side. Use on every change to the code, in every PR and every push to it, and when asked about screenshots or visual tests.
---

# Visual tests

`tests/visual/web.spec.ts` screenshots the web view's key moments: the empty page, a repository, both tabs,
the filter, an organization, warnings, errors. Each screenshot is a PNG in `tests/visual/screenshots/`,
in git. A test fails if a single pixel differs. GitHub answers from recordings (`tests/visual/server.ts`),
so the pages are the same on every run, and a changed screenshot means the page changed.

The screenshots are made in one place only, the Playwright Docker image on linux/amd64, or the system it is
built on, Ubuntu 24.04 on x86_64: the same Chromium, fonts and rendering, pixel for pixel. Fonts and rendering
differ elsewhere, even on another Linux. Never run `npx playwright test` directly: the config refuses.

## Where they run

`npm run test:visual` picks the place itself. If something is missing, it says what to run and stops.

- **Ubuntu 24.04 on x86_64** (CI, a Linux VM): natively, without Docker. After `npm ci`, once:
  `sudo npx playwright install-deps chromium` (the libraries and fonts Chromium needs). It installs Chromium
  itself.
- **Another Linux:** it first runs the visual tests of `origin/main`, whose screenshots are known good, natively,
  in a worktree of their own. They pass: this machine renders as the image does, and the tests run natively.
  They don't: in Docker. It says which, and keeps the answer in `~/.cache/skill-atlas/visual` until the system,
  its fonts, Playwright or main's screenshots change (delete the file it names to ask again, e.g. after
  `install-deps`). Debian 12, for one, differs by a few hundred pixels: Docker.
- **macOS, or `SKILL_ATLAS_VISUAL_DOCKER=1`:** in Docker, as below.

## Docker

- **macOS:** Docker Desktop, started: `open -a Docker`. It runs the amd64 image on Apple silicon too.
- **Linux:** the Docker engine, started (`sudo systemctl start docker`), and you in the `docker` group
  (`sudo usermod -aG docker "$USER"`, then log in again). Rootless Docker and Podman work too.
  - The tests run as you, so the screenshots they write are yours, not root's.
  - On an ARM machine, install the amd64 emulator once:
    `docker run --privileged --rm tonistiigi/binfmt --install amd64`.
- **CI:** the `visual` job runs the same `npm run test:visual`, natively, on an Ubuntu 24.04 runner.

The first run downloads the image, about 1 GB. Under emulation (Apple silicon, ARM Linux), a run takes
about 30 s.

## On every change

1. Run `npm run test:visual`.
2. **It passes:** the page looks the same. Say so in the PR: "Screenshots: unchanged".
3. **It fails, and the change was meant to change the page:** `npm run test:visual:update`, then check each
   changed screenshot (below), and commit them with the change.
4. **It fails, and the change was not meant to change the page:** that's a regression. Fix the code, not
   the screenshots. The diff of each failure is in `test-results/<test>/…-diff.png`, next to `-actual` and
   `-expected`. In CI, it's in the `visual-report` artifact.

## A new feature or a new state of the page

Add a test for each key moment it brings, the way the others are written: drive the page, wait for what
it shows (`expect(…).toHaveText(…)`), then `await expect(page).toHaveScreenshot('<moment>.png')`.

- Data comes from recordings: add what GitHub answers to `tests/visual/server.ts` (or `tests/helpers.ts`).
  Never live GitHub, and never a local directory: its `file://` links show where the checkout is.
- Nothing that changes from run to run: no times, no random order, no progress caught midway.
- A moment that is gone: delete its test and its PNG. `--update-snapshots` doesn't remove old files.

Then `npm run test:visual:update` writes the new PNGs. Run `npm run test:visual` again: it must pass.

## Check each changed screenshot

Before committing, look at every changed screenshot, before and after, with what differs boxed in red:

```sh
npm run -s screenshots:diff -- --base HEAD   # → .demo/screenshots/<moment>.before.png and .after.png
```

It lists each changed, new or removed screenshot, and how:
- **changed in N places, boxed in red:** a red box around each part that differs, on both images.
- **changed throughout:** the page moved everywhere, a font or a margin, so boxes wouldn't help.
- **resized**, **new** or **removed**.

Look at every pair. Only what the change meant to change may differ, and each box must be something you
meant. Anything else is a regression: fix the code.

## In the PR

Commit the screenshots in the same commit as the change. In "Files changed", GitHub then shows each one
old and new, side by side (also swipe and onion skin).

Then post them in the PR too, before and after, each under a cut:

```sh
npm run -s screenshots:diff -- --pr <number>                                   # creating the PR: against main
npm run -s screenshots:diff -- --pr <number> --base origin/<branch>            # a later push: run it before
                                                                               # `git push`, against what the PR showed
```

It uploads the images to the `demos` branch, like a demo, and prints a `## Screenshots` section:
"Unchanged.", or a line with the counts, then one `<details>` per screenshot with a Before | After table.

- Add one line under the heading on why they changed: the feature, the fix.
- **Creating a PR:** the section goes in the description.
- **A later push:** it goes in that push's one comment ([record-demo](../record-demo/SKILL.md#attach-it-to-the-pr)), before the demo.

CI runs the same tests (`visual` job), so it must be green.
