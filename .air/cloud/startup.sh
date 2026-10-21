#!/usr/bin/env bash
# Environment startup for Skill Atlas (Node >= 24 TypeScript CLI).
# AIR_STARTUP_MODE=warmup: install deps and prove the environment with the CI checks.
# AIR_STARTUP_MODE=task:   install deps and return promptly.
set -euo pipefail

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then WARMUP=1; else WARMUP=; fi

cd "$(dirname "$0")/../.."

log() { echo "[startup] $*"; }

# Node >= 24 (package.json engines). Use nvm to install it only if the image lacks it.
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 24 ]; then
  log "node >= 24 not found (have: $(node -v 2>/dev/null || echo none)); installing via nvm"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm alias default 24
  for f in ~/.bash_profile ~/.bash_login ~/.profile; do
    if [ -f "$f" ]; then profile="$f"; break; fi
  done
  profile="${profile:-$HOME/.profile}"
  for f in "$profile" ~/.bashrc; do
    grep -q '# air-startup-nvm' "$f" 2>/dev/null ||
      echo 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" # air-startup-nvm' >> "$f"
  done
fi
log "node $(node -v), npm $(npm -v)"

log "npm ci"
npm ci --no-audit --no-fund
log "npm ci done"

# The same checks CI runs: typecheck, tests and the CLI smoke test on the fixture.
healthcheck() {
  log "healthcheck: typecheck"
  npm run typecheck
  log "healthcheck: tests"
  npm test
  log "healthcheck: CLI smoke"
  ./skill-atlas help
  ./skill-atlas scan ./fixture
  log "healthcheck: OK"
}

# The visual tests run natively on Ubuntu 24.04 x86_64 (scripts/visual.sh): Chromium and its system
# dependencies, ready for them. Without sudo, they say what to run.
visual_deps() {
  if ( . /etc/os-release && [ "$ID-$VERSION_ID-$(uname -m)" = ubuntu-24.04-x86_64 ] ) 2>/dev/null; then
    log "visual tests: chromium"
    npx playwright install chromium
    if sudo -n true 2>/dev/null; then sudo -n env PATH="$PATH" npx playwright install-deps chromium; else log "no sudo: skipping Chromium's system dependencies"; fi
  fi
}

if [ -n "${WARMUP:-}" ]; then healthcheck; visual_deps; fi
log "done"
