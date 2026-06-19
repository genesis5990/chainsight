# Multi-stage Dockerfile for the ChainSight worker (BullMQ consumer).
# Uses `pnpm deploy` to produce a flat, runnable bundle.

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

FROM deps AS builder
COPY . .
RUN pnpm --filter @chainsight/worker build

FROM builder AS deploy
RUN pnpm --filter @chainsight/worker --prod deploy --legacy /out

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

COPY --from=deploy /out/package.json ./package.json
COPY --from=deploy /out/node_modules ./node_modules
COPY --from=deploy /out/dist ./dist

USER chainsight
CMD ["node", "dist/index.js"]
