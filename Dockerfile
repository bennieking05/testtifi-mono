# -------- Stage 1: Base Build Stage --------
FROM node:20-alpine AS base

WORKDIR /usr/src/app

RUN apk add --no-cache python3 make g++ gcc bash curl net-tools

COPY package*.json ./
# Copy Prisma schema first (required for postinstall prisma generate)
COPY prisma ./prisma
RUN npm install

# Generate Prisma client (postinstall also runs, but ensure availability in CI)
RUN npx prisma generate

# Copy rest of the code
COPY . .

RUN npm rebuild bcrypt --build-from-source

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
COPY --from=build /usr/src/app/prisma ./prisma
COPY --from=build /usr/src/app/public/testifi_light_logo.png ./public/testifi_light_logo.png
COPY --from=build /usr/src/app/public/testifi_dark_logo.png ./public/testifi_dark_logo.png
COPY --from=build /usr/src/app/public/og-image.png ./public/og-image.png

EXPOSE 4000
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]

# -------- Stage 3b: Runtime for Summarize Worker --------
FROM node:20-alpine AS summarize-worker

WORKDIR /usr/src/app

COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/prisma ./prisma
COPY --from=build /usr/src/app/public/testifi_light_logo.png ./public/testifi_light_logo.png
COPY --from=build /usr/src/app/public/testifi_dark_logo.png ./public/testifi_dark_logo.png
COPY --from=build /usr/src/app/public/og-image.png ./public/og-image.png

ENV NODE_ENV=production

CMD ["node", "dist/worker/summarizeWorker.js"]