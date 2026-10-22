# Capital Q — one Dockerfile, four service targets: web, api, q-api, workers.
#
# Fallback host only: Railway (ADR 0014) builds with Railpack and never reads
# this file. Used by scripts/deploy/fly-deploy.mjs on Fly.io's remote builder
# (docs/ai-handoff/FLY-DEPLOY.md):
#
#   docker build --target api .
#   docker build --target web \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .
#
# No secret is a build argument. The two NEXT_PUBLIC_* values are public by
# design (an anon Supabase URL and its publishable key); every other value is
# a runtime secret on the host, never in a layer.

ARG NODE_IMAGE=node:24.22.0-bookworm-slim

# ---------------------------------------------------------------------------
# workspace: full install and the source tree. Shared by every build stage.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS workspace
ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
# The exact pnpm the root package.json pins (packageManager); installed with
# npm rather than corepack so the build does not depend on corepack's
# signing-key bundle.
RUN npm install --global pnpm@11.25.0 && npm cache clean --force
WORKDIR /repo
COPY . .
# Default store location on purpose: see scripts/deploy/docker-build-service.sh.
# The store stays in build stages only; runtime stages copy /repo alone.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Node services. Each build stage compiles the service and its workspace
# packages, then replaces node_modules with a production-only install of
# exactly that service's dependency closure (scripts/deploy/
# docker-build-service.sh).
# ---------------------------------------------------------------------------
FROM workspace AS api-build
RUN sh scripts/deploy/docker-build-service.sh api

FROM workspace AS q-api-build
RUN sh scripts/deploy/docker-build-service.sh q-api

FROM workspace AS workers-build
RUN sh scripts/deploy/docker-build-service.sh workers

FROM ${NODE_IMAGE} AS node-runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0
WORKDIR /app
# Code is owned by root and read-only to the service user; the services write
# only to the OS temp directory (the document parser's scratch workspace).
USER node

FROM node-runtime AS api
COPY --from=api-build /repo /app
ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

FROM node-runtime AS q-api
COPY --from=q-api-build /repo /app
ENV PORT=3002
EXPOSE 3002
CMD ["node", "apps/q-api/dist/main.js"]

FROM node-runtime AS workers
COPY --from=workers-build /repo /app
# No port: workers serve nothing (doc 21, IDA-033).
CMD ["node", "apps/workers/dist/main.js"]

# ---------------------------------------------------------------------------
# web: Next.js standalone output. NEXT_OUTPUT_STANDALONE=1 is read only by
# apps/web/next.config.ts; without it (Railway, local) the build and
# `next start` are unchanged.
# ---------------------------------------------------------------------------
FROM workspace AS web-build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_OUTPUT_STANDALONE=1
# Loose env mode so turbo hands next build every variable above.
RUN node node_modules/turbo/bin/turbo run build --filter=@capital-q/web... --env-mode=loose

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=web-build /repo/apps/web/.next/standalone ./
COPY --from=web-build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /repo/apps/web/public ./apps/web/public
# Next.js writes its image/fetch cache here at runtime.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
