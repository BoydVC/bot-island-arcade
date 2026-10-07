#!/usr/bin/env bash
# Bot Island Arcade: build (reads ../bot-island data read-only) + serve on :4267 under nohup, then smoke test.
#   nohup ./run.sh &      or   ./run.sh --quick (build + serve, no browser test)   ./run.sh --shots (also re-render screenshots)
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
mkdir -p data
PORT="${BOT_ISLAND_ARCADE_PORT:-4267}"
if [[ -f data/server.pid ]] && kill -0 "$(cat data/server.pid)" 2>/dev/null; then echo "already serving on :$PORT (pid $(cat data/server.pid))"; else
  BOT_ISLAND_ARCADE_PORT=$PORT nohup nice -n 10 python3 server.py > data/server.log 2>&1 &
  echo $! > data/server.pid; sleep 1; echo "serving http://127.0.0.1:$PORT/ (pid $(cat data/server.pid))"; fi
if [[ "${1:-}" == "--shots" ]]; then nice -n 15 node --experimental-websocket tests/screens.mjs; fi
if [[ "${1:-}" != "--quick" ]]; then python3 tests/smoke_test.py; fi
