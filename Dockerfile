# Set up the Node.js backend
FROM node:18-slim
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN npm install --prefix server

COPY server/ ./server/

# Copy the locally built frontend
COPY client/dist ./client/dist

# Create a directory for the persistent SQLite database
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=/app/data/database.db

EXPOSE 3001

# Start the server
CMD ["node", "server/index.js"]