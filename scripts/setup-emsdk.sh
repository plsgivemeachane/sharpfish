#!/usr/bin/env bash
# Install the exact Emscripten version build.js expects.
# Usage: scripts/setup-emsdk.sh            (installs to $EMSDK_DIR or ~/emsdk)
# Afterwards build with: ./make-web.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Read the pinned version from build.js so there is only one place to change it.
EM_VERSION="$(grep -oP 'expectedEmscripten\s*=\s*"\K[0-9.]+' "$ROOT/build.js" | head -1)"
EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"

if [ -z "$EM_VERSION" ]; then
    echo "Could not read expectedEmscripten from build.js" >&2
    exit 1
fi

if [ ! -d "$EMSDK_DIR/.git" ]; then
    git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
else
    git -C "$EMSDK_DIR" pull --ff-only
fi

"$EMSDK_DIR/emsdk" install "$EM_VERSION"
"$EMSDK_DIR/emsdk" activate "$EM_VERSION"

echo
echo "Emscripten $EM_VERSION ready in $EMSDK_DIR"
echo "make-web.sh loads it automatically; for a manual shell run:"
echo "  source \"$EMSDK_DIR/emsdk_env.sh\""
