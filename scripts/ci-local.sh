#!/usr/bin/env bash
# Local CI — the same gate as .github/workflows/ci.yml, run on this machine
# (owner decision 88, 12 Nov 2026: GitHub-hosted Actions minutes ran out;
# GitHub CI now runs only by hand). Same commands, same order, same
# no-live-provider rule. A deploy needs a PASS from this script on the exact
# commit, recorded in docs/ai-handoff (the summary line below is the receipt).
#
#   bash scripts/ci-local.sh            # everything
#   STEPS="static typecheck" bash scripts/ci-local.sh   # a subset
#
# Steps (CI job → here):
#   static       format and lint      pnpm format:check; pnpm lint
#   typecheck    typecheck            pnpm typecheck
#   build        build                pnpm build
#   test         test (1-3/3)         pnpm test (all shards in one run)
#   database     database (pgTAP)     fresh local Postgres 16 + every migration
#                                     (scripts/local-pg/setup.sh), pg_prove over
#                                     supabase/tests/database, then the GateQ
#                                     concurrent-correction proof
#   integration  integration          pnpm test:integration against a fresh
#                                     local database
# Needs root for the local Postgres (apt packages, the postgres user).
set -uo pipefail
cd "$(dirname "$0")/.."
repo="$(pwd)"
sha="$(git rev-parse --short=9 HEAD)"
dirty="$(git status --porcelain | grep -v '^??' | wc -l | tr -d ' ')"
out="${CI_LOCAL_OUT:-/tmp/ci-local}/$sha"
mkdir -p "$out"
steps="${STEPS:-static typecheck build test database integration}"
port="${CI_LOCAL_PGPORT:-54329}"

# No live provider call, ever (CLAUDE.md): non-empty disabled values.
for key in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY \
  SERP_API_KEY SERPER_API_KEY TAVILY_API_KEY BRAVE_API_KEY ELEVENLABS_API_KEY \
  DEEPGRAM_API_KEY RECALL_API_KEY; do
  export "$key=disabled-locally-000000000000"
done
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

declare -A result
run() {
  local name="$1"
  shift
  local started=$SECONDS
  echo "== $name"
  if "$@" >"$out/$name.log" 2>&1; then
    result[$name]="PASS $((SECONDS - started))s"
  else
    result[$name]="FAIL $((SECONDS - started))s (see $out/$name.log)"
    tail -25 "$out/$name.log"
  fi
  echo "   ${result[$name]}"
}

fresh_db() {
  PGPORT="$port" bash scripts/local-pg/setup.sh
}

step_static() { pnpm format:check && pnpm lint; }
step_typecheck() { pnpm typecheck; }
step_build() { pnpm build; }
step_test() {
  pnpm exec turbo run build --filter=./packages/* --output-logs=errors-only &&
    pnpm test
}
step_database() {
  fresh_db || return 1
  pg_prove -h /tmp -p "$port" -U postgres -d cq -r supabase/tests/database ||
    return 1
  pnpm exec turbo run build --filter=@capital-q/gateq-intake... --concurrency=2 ||
    return 1
  local psql=(psql -h /tmp -p "$port" -U postgres -X -v ON_ERROR_STOP=1)
  "${psql[@]}" -c "drop database if exists cq_gateq_supersession_test with (force)" \
    -c "create database cq_gateq_supersession_test template template0" || return 1
  "${psql[@]}" -d cq_gateq_supersession_test \
    -f supabase/tests/database/rls/support/gateq-supersession-local-bootstrap.psql ||
    return 1
  CQ_GATEQ_CONCURRENCY_URL="postgresql://postgres@127.0.0.1:$port/cq_gateq_supersession_test" \
    node supabase/tests/database/rls/support/gateq-supersession-concurrency.mjs
}
step_integration() {
  fresh_db || return 1
  pnpm exec turbo run build --filter=./packages/* --concurrency=2 || return 1
  CQ_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$port/cq" \
    DATABASE_URL="postgresql://postgres@127.0.0.1:$port/cq" \
    pnpm test:integration
}

started=$SECONDS
for name in $steps; do
  run "$name" "step_$name"
done

verdict=PASS
for name in $steps; do
  case "${result[$name]}" in PASS*) ;; *) verdict=FAIL ;; esac
done
[ "$dirty" = "0" ] || verdict="$verdict (uncommitted changes: not a receipt)"
echo
echo "ci-local $verdict sha=$sha at=$(date -u +%Y-%m-%dT%H:%M:%SZ) took=$((SECONDS - started))s"
for name in $steps; do echo "  $name: ${result[$name]}"; done
case "$verdict" in PASS) exit 0 ;; *) exit 1 ;; esac
