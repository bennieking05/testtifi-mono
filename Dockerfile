# Stage 1: Build Stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install system dependencies
RUN apk add --no-cache python3 make g++ gcc bash curl net-tools

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy your entire project (including schema.prisma)
COPY . .

# Rebuild bcrypt (if needed for Alpine)
RUN npm rebuild bcrypt --build-from-source

# Generate the Prisma client
RUN npx prisma generate

# Build your app
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# Stage 2: Runtime Stage
FROM node:20-alpine
WORKDIR /usr/src/app

# Copy from builder
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]