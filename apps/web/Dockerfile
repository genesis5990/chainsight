# Multi-stage Dockerfile for the ChainSight web frontend (Next.js 15).
# Uses Next.js standalone output mode + outputFileTracingRoot (set in
# next.config.mjs) to produce a self-contained server bundle.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/belief-state/package.json ./packages/belief-state/
COPY packages/capability-router/package.json ./packages/capability-router/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/math/package.json ./apps/math/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @chainsight/web build

# ---- runner stage ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

# Next.js standalone bundle (server.js + minimal node_modules) lives at
# /repo/apps/web/.next/standalone — and because outputFileTracingRoot is set
# to /repo, the standalone directory mirrors the monorepo structure.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

RUN chown -R chainsight:nodejs /app
USER chainsight
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
