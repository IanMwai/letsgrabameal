#!/bin/bash

# Default to development mode
MODE=${1:-dev}

# Set color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ "$MODE" = "prod" ]; then
  echo -e "${BLUE}>>> Starting in PRODUCTION mode...${NC}"
  # Check if build exists
  if [ ! -d "client/dist" ]; then
    echo -e "${GREEN}>>> Building client first...${NC}"
    npm run build
  fi
  NODE_ENV=production node server/index.js
else
  echo -e "${BLUE}>>> Starting in DEVELOPMENT mode...${NC}"
  BACKEND_LOG=$(mktemp -t letsgrabameal-backend.XXXXXX.log)

  cleanup() {
    if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill "$BACKEND_PID"
    fi
    if [ -n "${BACKEND_LOG:-}" ] && [ -f "$BACKEND_LOG" ]; then
      rm -f "$BACKEND_LOG"
    fi
  }

  trap cleanup EXIT INT TERM

  # Start backend in background and wait until it is actually reachable.
  (cd server && node index.js) >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!

  BACKEND_PORT=${PORT:-3001}
  for _ in {1..50}; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo ">>> Backend failed to start. Output:"
      cat "$BACKEND_LOG"
      exit 1
    fi

    if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
      cat "$BACKEND_LOG"
      break
    fi

    sleep 0.2
  done

  if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo ">>> Backend did not become ready on port ${BACKEND_PORT}. Output:"
    cat "$BACKEND_LOG"
    exit 1
  fi

  # Start frontend in foreground
  (cd client && npm run dev)
fi
