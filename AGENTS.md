# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
A screenshot for each key moment of the web view, in `tests/visual/` (the [visual-tests](.agents/skills/visual-tests/SKILL.md) skill).
## Workflow
- Work until the task is completed; don't stop halfway
- Double-check everything: re-read the diff against the spec, run the tests
- When done, open a PR against this fork, `origin`, never the repository it was forked from:
  `gh pr create --repo anton-bannykh/ai-workshop-start` (without `--repo`, `gh` may pick the parent)
- Every change: run the visual tests; update the screenshots with the change, checked, as the
  [visual-tests](.agents/skills/visual-tests/SKILL.md) skill says
- Every PR and every push to it: a demo of the web view, with the [record-demo](.agents/skills/record-demo/SKILL.md) skill
## Definition of done
- All tests pass locally, the visual tests too (`npm run test:visual`)

## Commands
- `npm ci`: first, in a fresh checkout
- `npm test`: the tests
- `npm run test:visual`: the web view's screenshots, natively on Linux when it renders as the Playwright image does (Ubuntu 24.04 x86_64 does), in Docker otherwise; `npm run test:visual:update` makes them anew
- `npm run screenshots:diff -- [--base <ref>] [--pr <n>]`: the changed screenshots, before and after, differences boxed in red, for the PR
- `npm run demo -- [scenario]`, `npm run demo:publish -- --pr <n> <files>`: record a demo, attach it to a PR
- `npm run test:e2e`: end to end, the CLI against live GitHub (JetBrains/kotlin, MPS, intellij-community); needs `GITHUB_TOKEN`, e.g. `GITHUB_TOKEN=$(gh auth token)`
