# Step 1: Build the React frontend
FROM node:18-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Step 2: Set up the Node.js backend
FROM node:18-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN npm install --prefix server
COPY server/ ./server/

# Copy the built frontend from Step 1 to the server's public folder
COPY --from=client-build /app/client/dist ./client/dist

# Create a directory for the persistent SQLite database
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL=/app/data/database.db

EXPOSE 3001

# Start the server
CMD ["node", "server/index.js"]
