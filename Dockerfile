# Stage 1: Base Stage for both build-worker and build-backend
FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Install system dependencies
RUN apk add --no-cache python3 make g++ gcc bash curl net-tools

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Rebuild bcrypt (if needed for Alpine)
RUN npm rebuild bcrypt --build-from-source

# Generate the Prisma client
RUN npx prisma generate

# --- Build worker (Summarize Worker) ---
FROM base AS build-worker

# Build the TypeScript project before pruning
RUN npm run build

# Prune dev dependencies AFTER build
RUN npm prune --omit=dev

# --- Runtime image for Summarize Worker ---
FROM node:20-alpine AS summarize-worker

WORKDIR /usr/src/app

# Copy only what's needed for runtime
COPY --from=build-worker /usr/src/app/package*.json ./
COPY --from=build-worker /usr/src/app/node_modules ./node_modules
COPY --from=build-worker /usr/src/app/dist ./dist

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "dist/worker/summarizeWorker.js"]