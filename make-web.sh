#!/usr/bin/env bash
# One-step build for forks: edit src/variant/config.h, then run
#
#   ./make-web.sh          build the lite single-threaded engine into site/engine/
#   ./make-web.sh test     build, then check that the engine answers (needs node)
#   ./make-web.sh serve    build, then serve site/ on http://localhost:8080
#
# Extra flags after the command go to build.js, e.g. ./make-web.sh -- --no-minify
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

CMD="build"
case "${1:-}" in
    test|serve|build) CMD="$1"; shift ;;
esac
[ "${1:-}" = "--" ] && shift

# 1. Emscripten: use the one in PATH if it is the pinned version, else ~/emsdk.
EM_VERSION="$(grep -oP 'expectedEmscripten\s*=\s*"\K[0-9.]+' build.js | head -1)"
if ! emcc --version 2>/dev/null | grep -q "$EM_VERSION"; then
    EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"
    if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ] || ! "$EMSDK_DIR/emsdk" list 2>/dev/null | grep -q "$EM_VERSION.*INSTALLED"; then
        echo ">> Emscripten $EM_VERSION not found, installing (one time, ~1 GB)..."
        EMSDK_DIR="$EMSDK_DIR" scripts/setup-emsdk.sh
    fi
    "$EMSDK_DIR/emsdk" activate "$EM_VERSION" >/dev/null
    # shellcheck disable=SC1091
    source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
fi

# 2. JS minifier used by build.js
[ -d node_modules/terser ] || npm install --no-audit --no-fund

# 3. Build. -f makes sure header-only changes (src/variant/*.h) are picked up.
echo ">> Building lite single-threaded engine..."
node build.js --single-threaded --lite -f -s "$@"

# 4. Copy into the site
ENGINE_JS="$(basename "$(readlink -f src/stockfish.js)")"
ENGINE_WASM="${ENGINE_JS%.js}.wasm"
mkdir -p site/engine
rm -f site/engine/*.js site/engine/*.wasm
cp "src/$ENGINE_JS" "src/$ENGINE_WASM" site/engine/
echo "window.ENGINE_FILE = \"engine/$ENGINE_JS\";" > site/engine-file.js
echo ">> Engine copied to site/engine/$ENGINE_JS (+ .wasm, $(du -h "site/engine/$ENGINE_WASM" | cut -f1))"

# 5. Optional extras
if [ "$CMD" = "test" ]; then
    node scripts/smoke-test.js "site/engine/$ENGINE_JS"
elif [ "$CMD" = "serve" ]; then
    echo ">> Serving site/ on http://localhost:8080 (Ctrl+C to stop)"
    cd site && exec python3 -m http.server 8080
fi
