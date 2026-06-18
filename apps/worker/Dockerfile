# Multi-stage Dockerfile for the ChainSight worker.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/belief-state/package.json ./packages/belief-state/
COPY packages/capability-router/package.json ./packages/capability-router/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN pnpm --filter @chainsight/worker build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

COPY --from=builder /repo/apps/worker/dist ./dist
COPY --from=builder /repo/apps/worker/package.json ./package.json
COPY --from=builder /repo/node_modules ./node_modules

USER chainsight
CMD ["node", "dist/index.js"]
