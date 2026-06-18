# Multi-stage Dockerfile for the ChainSight API.
# Used by Fly.io and Helm (On-Prem) — same image.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---- deps stage ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/belief-state/package.json ./packages/belief-state/
COPY packages/capability-router/package.json ./packages/capability-router/
RUN pnpm install --frozen-lockfile

# ---- builder stage ----
FROM base AS builder
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @chainsight/api build

# ---- runner stage ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/package.json ./package.json
COPY --from=builder /repo/node_modules ./node_modules

USER chainsight
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/v1/health/live || exit 1

CMD ["node", "dist/index.js"]
