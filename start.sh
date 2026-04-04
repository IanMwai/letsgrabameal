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
  # Start backend in background
  (cd server && node index.js) &
  BACKEND_PID=$!
  
  # Start frontend in foreground
  (cd client && npm run dev)
  
  # When frontend stops, kill backend too
  kill $BACKEND_PID
fi
