#!/bin/bash
# Start backend from root
(cd server && node index.js) &
# Start frontend from root
(cd client && npm run dev)
