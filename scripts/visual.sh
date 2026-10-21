#!/bin/sh
# The visual tests, where their screenshots are made: the Playwright image on linux/amd64, so that they
# match on every machine. Arguments go to `playwright test`, e.g. --update-snapshots. node_modules for
# Linux live in a volume of their own, apart from this checkout's.
#
# On Ubuntu 24.04 on x86_64, the image's own system (CI, a Linux VM), they run here instead, without Docker:
# the same Chromium, fonts and rendering, pixel for pixel. SKILL_ATLAS_VISUAL_DOCKER=1 runs them in Docker anyway.
set -e
cd "$(dirname "$0")/.."
IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
VOLUME=skill-atlas-visual-node-modules
FONTS="$PWD/tests/visual/fonts.conf"

# The image is Ubuntu 24.04 (noble), amd64.
is_image_system() (
  [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] && [ -r /etc/os-release ] && . /etc/os-release &&
    [ "$ID-$VERSION_ID" = ubuntu-24.04 ]
)

if [ -z "${SKILL_ATLAS_VISUAL_DOCKER:-}" ] && is_image_system; then
  if [ ! -d node_modules/playwright ]; then
    echo 'node_modules is missing: run npm ci, then this again.' >&2
    exit 1
  fi
  # Chromium, the build this Playwright pins; already there, it does nothing.
  npx playwright install chromium
  # The fonts the screenshots were made with; Playwright's system dependencies bring them.
  if ! FONTCONFIG_FILE="$FONTS" fc-match -f '%{family}' system-ui 2>/dev/null | grep -q 'Liberation Sans' ||
    ! FONTCONFIG_FILE="$FONTS" fc-match -f '%{family}' monospace 2>/dev/null | grep -q 'Liberation Mono'; then
    echo "The screenshots' fonts are missing: install Chromium's system dependencies once with" >&2
    echo '  sudo npx playwright install-deps chromium' >&2
    exit 1
  fi
  SKILL_ATLAS_VISUAL=1 FONTCONFIG_FILE="$FONTS" exec npx playwright test "$@"
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
