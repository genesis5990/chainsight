# Multi-stage Dockerfile for the ChainSight API.
# Used by Fly.io and Helm (On-Prem) — same image.
#
# Strategy: tsup bundles all our @chainsight/* workspace packages and source
# into a single ESM bundle at apps/api/dist/index.js. External deps (fastify,
# @supabase/*, etc.) remain require()'d at runtime — they live in pnpm's
# .pnpm store under /repo/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>
# with symlinks at /repo/apps/api/node_modules/<pkg>.
#
# To preserve the pnpm symlink layout we copy the entire /repo into the runner.
# The dev dependencies are pruned by re-running `pnpm install --prod` against
# only the api package's dependencies.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---- deps stage: install all workspace deps (dev included for build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/belief-state/package.json ./packages/belief-state/
COPY packages/capability-router/package.json ./packages/capability-router/
COPY packages/pathfinder/package.json ./packages/pathfinder/
COPY packages/reproducibility/package.json ./packages/reproducibility/
COPY packages/tracer-agent/package.json ./packages/tracer-agent/
RUN pnpm install --frozen-lockfile

# ---- builder stage: bundle the API with tsup ----
FROM deps AS builder
COPY . .
RUN pnpm --filter @chainsight/api build

# ---- runner stage: minimal image with bundled output + production deps ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -g 1001 -S nodejs && adduser -S chainsight -u 1001

# Copy the manifest files needed for `pnpm install --prod`.
COPY --from=builder /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=builder /repo/apps/api/package.json ./apps/api/
COPY --from=builder /repo/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /repo/packages/belief-state/package.json ./packages/belief-state/
COPY --from=builder /repo/packages/capability-router/package.json ./packages/capability-router/
COPY --from=builder /repo/packages/pathfinder/package.json ./packages/pathfinder/
COPY --from=builder /repo/packages/reproducibility/package.json ./packages/reproducibility/
COPY --from=builder /repo/packages/tracer-agent/package.json ./packages/tracer-agent/

# Install only production dependencies into the runner stage.
# This recreates the pnpm symlink layout (apps/api/node_modules/* -> /repo/node_modules/.pnpm/...).
RUN pnpm install --frozen-lockfile --prod

# Copy the compiled bundle.
COPY --from=builder /repo/apps/api/dist ./apps/api/dist

# Ownership + non-root user.
RUN chown -R chainsight:nodejs /repo
USER chainsight
WORKDIR /repo/apps/api
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/v1/health/live || exit 1

CMD ["node", "dist/index.js"]
