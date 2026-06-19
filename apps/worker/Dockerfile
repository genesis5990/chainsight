# Multi-stage Dockerfile for the ChainSight worker (BullMQ consumer).
# Same strategy as API: tsup bundles workspace deps; runner stage re-installs
# external deps with pnpm to preserve the symlink layout.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json .npmrc ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/belief-state/package.json ./packages/belief-state/
COPY packages/capability-router/package.json ./packages/capability-router/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @chainsight/worker build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

COPY --from=builder /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=builder /repo/apps/worker/package.json ./apps/worker/
COPY --from=builder /repo/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /repo/packages/belief-state/package.json ./packages/belief-state/
COPY --from=builder /repo/packages/capability-router/package.json ./packages/capability-router/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /repo/apps/worker/dist ./apps/worker/dist

RUN chown -R chainsight:nodejs /repo
USER chainsight
WORKDIR /repo/apps/worker

CMD ["node", "dist/index.js"]
