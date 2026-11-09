# Stock reference engine

Unmodified Stockfish 19 (lite, single-threaded WASM), used only by the site's
eval bar so you can compare your variant against plain Stockfish.

It is built once from this repo with every variant setting off
(`-DVARIANT_STOCK`, see `src/variant/stock_config.h`) and committed, so forks
do not rebuild it. To rebuild it anyway: `./make-web.sh stock`.

GPLv3, like the rest of the engine (see `Copying.txt` in the repo root).
