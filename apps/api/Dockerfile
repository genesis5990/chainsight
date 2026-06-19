# Multi-stage Dockerfile for the ChainSight API.
# Used by Fly.io and Helm (On-Prem) — same image.
#
# Strategy: build inside the pnpm workspace, then use `pnpm deploy` to
# produce a flat, runnable directory with all transitive deps inlined.

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
FROM deps AS builder
COPY . .
RUN pnpm --filter @chainsight/api build

# ---- deploy stage: create a flat, production-only bundle ----
FROM builder AS deploy
RUN pnpm --filter @chainsight/api --prod deploy --legacy /out

# ---- runner stage ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

# /out from the deploy stage is a self-contained app folder with
# package.json + node_modules + dist (compiled output).
COPY --from=deploy /out/package.json ./package.json
COPY --from=deploy /out/node_modules ./node_modules
COPY --from=deploy /out/dist ./dist

USER chainsight
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/v1/health/live || exit 1

CMD ["node", "dist/index.js"]
