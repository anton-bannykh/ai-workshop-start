#!/bin/sh
# The visual tests, where their screenshots are made: the Playwright image on linux/amd64, so that they
# match on every machine. Arguments go to `playwright test`, e.g. --update-snapshots. node_modules for
# Linux live in a volume of their own, apart from this checkout's.
#
# On Linux they run here instead, without Docker, when this machine renders as the image does:
# - Ubuntu 24.04 on x86_64, the image's own system (CI, a Linux VM): the same Chromium, fonts and
#   rendering, pixel for pixel;
# - any other Linux, if the visual tests of origin/main, whose screenshots are known good, pass here. The
#   answer is kept in ~/.cache/skill-atlas/visual, for this system, its fonts, Playwright and main's
#   screenshots; if they fail, Docker.
# SKILL_ATLAS_VISUAL_DOCKER=1 runs them in Docker anyway.
set -e
cd "$(dirname "$0")/.."
IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
VOLUME=skill-atlas-visual-node-modules
BASE=origin/main

# The image is Ubuntu 24.04 (noble), amd64.
is_image_system() (
  [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] && [ -r /etc/os-release ] && . /etc/os-release &&
    [ "$ID-$VERSION_ID" = ubuntu-24.04 ]
)

# The fonts the screenshots were made with, as tests/visual/fonts.conf in that checkout picks them.
has_fonts() {
  FONTCONFIG_FILE="$1/tests/visual/fonts.conf" fc-match -f '%{family}' system-ui 2>/dev/null | grep -q 'Liberation Sans' &&
    FONTCONFIG_FILE="$1/tests/visual/fonts.conf" fc-match -f '%{family}' monospace 2>/dev/null | grep -q 'Liberation Mono'
}

# The visual tests of a checkout, natively.
run_native() (
  cd "$1"
  shift
  SKILL_ATLAS_VISUAL=1 FONTCONFIG_FILE="$PWD/tests/visual/fonts.conf" exec npx playwright test "$@"
)

# Whether this machine renders as the image does: the visual tests of $BASE pass here, in a worktree of
# their own with this checkout's node_modules. Asked once for each system, fonts, Playwright and $BASE's
# screenshots.
renders_like_image() {
  git fetch -q origin main 2>/dev/null || true
  screenshots=$(git rev-parse -q --verify "$BASE:tests/visual/screenshots") || return 1
  key=$(
    { uname -m; cat /etc/os-release 2>/dev/null; npx playwright --version; echo "$screenshots"
      for family in system-ui sans-serif monospace; do
        FONTCONFIG_FILE="$PWD/tests/visual/fonts.conf" fc-match -f '%{file}\n' "$family" 2>/dev/null || true
      done
    } | sha256sum | cut -c1-16
  )
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/skill-atlas/visual"
  if [ -f "$cache/$key" ]; then
    [ "$(cat "$cache/$key")" = native ] && return
    echo "This machine does not render as the Playwright image does (asked before; to ask again, delete $cache/$key): in Docker, then." >&2
    return 1
  fi
  echo "Does this machine render as the Playwright image does? The visual tests of $BASE, here, without Docker…" >&2
  mkdir -p "$cache"
  work=$(mktemp -d)
  git worktree add -q --detach "$work/main" "$BASE"
  ln -s "$PWD/node_modules" "$work/main/node_modules"
  if ! has_fonts "$work/main"; then
    echo "The screenshots' fonts, Liberation Sans and Mono, are missing: sudo npx playwright install-deps chromium" >"$cache/$key.log"
    verdict=docker
  elif run_native "$work/main" --reporter=dot >"$cache/$key.log" 2>&1; then
    verdict=native
  else
    verdict=docker
  fi
  git worktree remove --force "$work/main"
  rm -rf "$work"
  echo "$verdict" >"$cache/$key"
  if [ "$verdict" = native ]; then
    echo 'They pass: no Docker needed here.' >&2
  else
    echo "They don't pass (see $cache/$key.log): in Docker, then. To ask again, delete $cache/$key." >&2
  fi
  [ "$verdict" = native ]
}

if [ -z "${SKILL_ATLAS_VISUAL_DOCKER:-}" ] && [ "$(uname -s)" = Linux ]; then
  if is_image_system; then
    if [ ! -d node_modules/playwright ]; then
      echo 'node_modules is missing: run npm ci, then this again.' >&2
      exit 1
    fi
    # Chromium, the build this Playwright pins; already there, it does nothing.
    npx playwright install chromium
    # Playwright's system dependencies bring the fonts.
    if ! has_fonts "$PWD"; then
      echo "The screenshots' fonts are missing: install Chromium's system dependencies once with" >&2
      echo '  sudo npx playwright install-deps chromium' >&2
      exit 1
    fi
    run_native "$PWD" "$@"
    exit
  fi
  # Another Linux: without node_modules or Chromium, there is nothing to try; Docker brings its own.
  if [ ! -d node_modules/playwright ]; then
    echo 'No node_modules here (npm ci) to try the visual tests without Docker: in Docker, then.' >&2
  elif ! npx playwright install chromium >/dev/null 2>&1; then
    echo "Playwright cannot install Chromium on this system: in Docker, then." >&2
  elif renders_like_image; then
    run_native "$PWD" "$@"
    exit
  fi
fi

if ! docker info >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) echo 'Docker is not running: start Docker Desktop (open -a Docker), then run this again.' >&2 ;;
    *) echo 'Docker is not running, or you may not use it: start it (sudo systemctl start docker), and add yourself to the docker group (sudo usermod -aG docker "$USER", then log in again).' >&2 ;;
  esac
  exit 1
fi

# An ARM Linux machine runs the amd64 image only with an emulator; Docker Desktop has one built in.
if [ "$(uname -s)" = Linux ] && [ "$(uname -m)" != x86_64 ] && [ ! -e /proc/sys/fs/binfmt_misc/qemu-x86_64 ]; then
  echo 'This machine cannot run linux/amd64 images yet: install the emulator once with' >&2
  echo '  docker run --privileged --rm tonistiigi/binfmt --install amd64' >&2
  exit 1
fi

# On Linux, a container's root is the host's root: the screenshots it writes would belong to root. Run as
# you, with a home of its own for npm, and the volume yours too. Docker Desktop (macOS) and rootless
# Docker or Podman map the files to you already, and must run as the container's root for that.
USER_ARGS=
if [ "$(uname -s)" = Linux ] && ! docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
  docker run --rm --platform linux/amd64 -v "$VOLUME:/work/node_modules" "$IMAGE" chown -R "$(id -u):$(id -g)" /work/node_modules
  USER_ARGS="--user $(id -u):$(id -g) -e HOME=/tmp"
fi

# The volume's mount point, made by you: Docker would make it as root.
mkdir -p node_modules
# shellcheck disable=SC2086 # USER_ARGS is several arguments
exec docker run --rm --init --ipc=host --platform linux/amd64 $USER_ARGS \
  -v "$PWD:/work" -v "$VOLUME:/work/node_modules" -w /work \
  -e CI -e SKILL_ATLAS_VISUAL=1 -e NPM_CONFIG_UPDATE_NOTIFIER=false -e FONTCONFIG_FILE=/work/tests/visual/fonts.conf \
  "$IMAGE" sh -c 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' visual "$@"
