#!/bin/sh
# The visual tests, where their screenshots are made: the Playwright image on linux/amd64, as in CI,
# so that they match on every machine. Arguments go to `playwright test`, e.g. --update-snapshots.
# node_modules for Linux live in a volume of their own, apart from this checkout's.
set -e
cd "$(dirname "$0")/.."
exec docker run --rm --init --ipc=host --platform linux/amd64 \
  -v "$PWD:/work" -v skill-atlas-visual-node-modules:/work/node_modules -w /work \
  -e CI -e SKILL_ATLAS_VISUAL=1 -e NPM_CONFIG_UPDATE_NOTIFIER=false -e FONTCONFIG_FILE=/work/tests/visual/fonts.conf \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' visual "$@"
