#!/bin/sh
# Builds one Node service inside the root Dockerfile and prunes the tree to
# what that service needs at runtime. Run from the repository root of the
# build stage, never on a developer checkout: it deletes node_modules, other
# apps and every src/ directory.
#
#   docker-build-service.sh <api|q-api|workers>
set -eu

service="${1:?usage: docker-build-service.sh <api|q-api|workers>}"

# turbo resolves the order: `build` dependsOn `^build` (turbo.json).
node node_modules/turbo/bin/turbo run build --filter="@capital-q/${service}..."

# Production-only reinstall of this service's workspace closure, from the
# store the full install already filled (no network, lockfile frozen). The
# store is pnpm's default for this user, as in the full install: pnpm 11
# re-verifies dependencies before every `pnpm run`, and a store-dir that
# differs between install and run makes each build task reinstall.
# Every closure member is selected directly; then the workspace packages
# some members import at runtime but declare as devDependencies are linked
# (see workspace-closure.mjs for why).
filters=$(node scripts/deploy/workspace-closure.mjs list "@capital-q/${service}" |
  sed 's/^/--filter=/' | tr '\n' ' ')
rm -rf node_modules apps/*/node_modules packages/*/node_modules .turbo
# shellcheck disable=SC2086 # one --filter word per package, by design
pnpm install --frozen-lockfile --prod --offline $filters
node scripts/deploy/workspace-closure.mjs link-dev "@capital-q/${service}"

for app in apps/*; do
  [ "$app" = "apps/${service}" ] || rm -rf "$app"
done

# Runtime reads compiled dist/ only. Non-source assets beside it stay (for
# example packages/deck-render/fonts, resolved from import.meta.url).
rm -rf apps/*/src apps/*/test packages/*/src packages/*/test \
  packages/*/evals packages/*/.turbo
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
