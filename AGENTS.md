# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
## Workflow
- Work until the task is completed; don't stop halfway
- Double-check everything: re-read the diff against the spec, run the tests
- When done, open a PR
## Definition of done
- All tests pass locally

## Commands
- `npm ci`: first, in a fresh checkout
- `npm test`: the tests
- `npm run test:e2e`: end to end, the CLI against live GitHub (JetBrains/kotlin, MPS, intellij-community); needs `GITHUB_TOKEN`, e.g. `GITHUB_TOKEN=$(gh auth token)`
