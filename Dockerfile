# syntax=docker/dockerfile:1

# Multi-stage build for the maze-workshop game.
# One image serves both the built client (static files) and the Colyseus
# WebSocket server, so a single Kubernetes Service can expose the whole game.

# ---------- build stage: compile shared, server, and client ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install locked dependencies first (better layer caching).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN npm ci

# Copy sources and build all workspaces.
COPY tsconfig.json tsconfig.tests.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/client apps/client
RUN npm run build

# ---------- runtime stage: production dependencies + built artifacts ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist

ENV PORT=2567
ENV CLIENT_DIST=/app/apps/client/dist
WORKDIR /app/apps/server
EXPOSE 2567
USER node
CMD ["node", "dist/index.js"]
