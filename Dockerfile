# -------- Stage 1: Base Build Stage --------
FROM node:20-alpine AS base

WORKDIR /usr/src/app

RUN apk add --no-cache python3 make g++ gcc bash curl net-tools

COPY package*.json ./
RUN npm install

COPY . .

RUN npm rebuild bcrypt --build-from-source
RUN npx prisma generate

# -------- Stage 2: Build TypeScript --------
FROM base AS build
RUN npm run build
RUN npm prune --omit=dev

# -------- Stage 3a: Runtime for Express API --------
FROM node:20-alpine AS backend

WORKDIR /usr/src/app

COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]

# -------- Stage 3b: Runtime for Summarize Worker --------
FROM node:20-alpine AS summarize-worker

WORKDIR /usr/src/app

COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]