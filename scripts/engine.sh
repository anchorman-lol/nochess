#!/bin/sh
# Puts the single-threaded Stockfish build where the browser can load it as a worker.
set -eu
mkdir -p public/engine
cp node_modules/stockfish/bin/stockfish-19-lite-single.js node_modules/stockfish/bin/stockfish-19-lite-single.wasm public/engine/
