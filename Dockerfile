# Stage 1: Build the React Application
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build the Server and Final Image
FROM node:20-alpine
WORKDIR /app

# Copy server dependencies and install
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --production

# Copy server source code
COPY server/ ./

# Build server (TypeScript)
RUN npm install -g typescript
RUN npm run build

# Remove source and keep only dist/node_modules
# (Optional optimization, but for now we keep it simple)

# Copy built client assets to server's public directory
# Ensure server is configured to serve static files if needed, 
# OR we rely on a reverse proxy. 
# For this V1 monorepo, let's copy client build to a 'public' folder in server
# and serve it via Express.
COPY --from=client-builder /app/client/dist ./public

# Expose port
EXPOSE 3000

# Start command
CMD ["node", "dist/index.js"]
