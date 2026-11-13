#!/usr/bin/env bash
# Local CI — the same gate as .github/workflows/ci.yml, run on this machine
# (owner decision 88, 12 Nov 2026: GitHub-hosted Actions minutes ran out;
# GitHub CI now runs only by hand). Same commands, same order, same
# no-live-provider rule. A deploy needs a PASS from this script on the exact
# commit, recorded in docs/ai-handoff (the summary line below is the receipt).
#
#   bash scripts/ci-local.sh            # everything, on HEAD, in a clean checkout
#   CI_LOCAL_REF=<sha> bash scripts/ci-local.sh          # another commit
#
# One gate runs per machine (a lock; a second exits 75). A full PASS writes
# a receipt for the full commit SHA, which scripts/deploy-promote.sh checks
# before it pushes the production branch.
#   STEPS="static typecheck" bash scripts/ci-local.sh   # a subset
#   CI_LOCAL_DIAGNOSE=1 bash scripts/ci-local.sh       # run every step even
#                                                      # after one fails
#
# Fail fast (owner, 13 Nov 2026): by default the gate stops at the first
# step that fails, since a failed step already means no receipt; the
# remaining steps are reported as NOT RUN. CI_LOCAL_DIAGNOSE=1 runs them
# all, to collect every failure at once. Either way only a run in which
# every step passed writes a receipt.
#
# Steps (CI job → here):
#   static       format and lint      pnpm format:check; pnpm lint
#   typecheck    typecheck            pnpm typecheck
#   build        build                pnpm build
#   test         test (1-3/3)         pnpm test (all shards in one run)
#   database     database (pgTAP)     a fresh local Supabase stack (Docker, as
#                                     CI), supabase test db, then the GateQ
#                                     concurrent-correction proof
#   integration  integration          pnpm test:integration against a fresh
#                                     local Supabase stack
# Needs root to start Docker when it is not running.
set -uo pipefail
# CI uses .nvmrc (Node 24); the cloud image defaults to Node 22.
[ -x /opt/node24/bin/node ] && export PATH="/opt/node24/bin:$PATH"
cd "$(dirname "$0")/.."
full="$(git rev-parse --verify "${CI_LOCAL_REF:-HEAD}^{commit}")" || exit 1
sha="${full:0:9}"
root="${CI_LOCAL_OUT:-/tmp/ci-local}"
out="$root/$sha"
mkdir -p "$out" "$root/receipts"
# One gate per machine at a time: two would share the Postgres port, the
# checkout and the 4 vCPU / 16 GB. A second run stops here and says which
# run holds the lock (owner, 12 Nov 2026).
exec 9>"$root/gate.lock"
if ! flock -n 9; then
  echo "ci-local: another gate is running ($(cat "$root/gate.owner" 2>/dev/null)); not starting a second one" >&2
  exit 75
fi
echo "pid=$$ sha=$full started=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/gate.owner"
# The gate runs in its own clean checkout of the commit (CI_LOCAL_INPLACE=1
# runs here instead), so work in this tree can go on while it runs and the
# receipt is for exactly that commit, never for files edited mid-run.
dirty=0
if [ "${CI_LOCAL_INPLACE:-0}" = "1" ]; then
  dirty="$(git status --porcelain | grep -v '^??' | wc -l | tr -d ' ')"
else
  main="$(pwd)"
  tree="$out/tree"
  git worktree remove --force "$tree" >/dev/null 2>&1
  # A run killed by a container restart can leave the directory without
  # git's record of it (worktree remove then fails). This gate holds the
  # machine lock, so no live run owns it: clear it.
  if [ -e "$tree" ]; then
    rm -rf "$tree"
    git worktree prune
  fi
  git worktree add --detach "$tree" "$sha" >/dev/null || exit 1
  trap 'git -C "$main" worktree remove --force "$tree" >/dev/null 2>&1' EXIT
  cd "$tree" || exit 1
  echo "== install (clean checkout of $sha)"
  pnpm install --frozen-lockfile --prefer-offline >"$out/install.log" 2>&1 ||
    { tail -25 "$out/install.log"; exit 1; }
fi
repo="$(pwd)"
steps="${STEPS:-static typecheck build test database integration}"

# No live provider call, ever (CLAUDE.md): non-empty disabled values.
for key in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY \
  SERP_API_KEY SERPER_API_KEY TAVILY_API_KEY BRAVE_API_KEY ELEVENLABS_API_KEY \
  DEEPGRAM_API_KEY RECALL_API_KEY; do
  export "$key=disabled-locally-000000000000"
done
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
# The gate holds the machine alone (the lock below): unit tests may use
# every core (vitest.config.ts). Integration keeps its own setting.
export CQ_VITEST_MAX_WORKERS="${CQ_VITEST_MAX_WORKERS:-$(nproc)}"

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

# The database and integration jobs run on the same local Supabase stack as
# CI (Docker; Postgres 17 with the real pgmq, Auth and the REST gateway),
# from this commit's own migrations: a fresh stack for each job.
SUPABASE_EXCLUDE=studio,imgproxy,inbucket,edge-runtime,logflare,vector,storage-api,realtime,postgres-meta,supavisor
docker_up() {
  timeout 10 docker info >/dev/null 2>&1 && return 0
  # The daemon outlives the gate: it must not inherit the gate's lock
  # (fd 9), or every later gate is refused as "another gate is running".
  (nohup dockerd >"$out/dockerd.log" 2>&1 9>&- &)
  for _ in $(seq 1 60); do
    timeout 5 docker info >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "ci-local: Docker did not start (see $out/dockerd.log)" >&2
  return 1
}
fresh_supabase() {
  docker_up || return 1
  pnpm exec supabase stop --no-backup >/dev/null 2>&1
  pnpm exec supabase start -x "$SUPABASE_EXCLUDE"
}
stop_supabase() { pnpm exec supabase stop --no-backup >/dev/null 2>&1; }

# Prettier's own cache is safe to keep across gates: a file's formatting
# depends only on its content, the resolved config and Prettier's version,
# all of which the cache keys on (content strategy, not mtime: a fresh
# checkout's mtimes are all new). ESLint's cache is NOT used: type-aware
# rules read other files' types, which its per-file cache does not track.
step_static() {
  pnpm exec prettier --check . --cache --cache-strategy content \
    --cache-location "$root/cache/prettier/.prettiercache" && pnpm lint
}
step_typecheck() { pnpm typecheck; }
step_build() { pnpm build; }
step_test() {
  pnpm exec turbo run build --filter=./packages/* --output-logs=errors-only &&
    pnpm test
}
step_database() {
  fresh_supabase || return 1
  local rc=0
  pnpm exec supabase test db || rc=1
  if [ "$rc" = 0 ]; then
    pnpm exec turbo run build --filter=@capital-q/gateq-intake... --concurrency=2 &&
      docker exec supabase_db_capital-q createdb -U postgres -T template0 cq_gateq_supersession_test &&
      docker cp supabase supabase_db_capital-q:/tmp/cq-supersession &&
      docker exec supabase_db_capital-q psql -X -v ON_ERROR_STOP=1 -U postgres -d cq_gateq_supersession_test \
        -f /tmp/cq-supersession/tests/database/rls/support/gateq-supersession-local-bootstrap.psql &&
      CQ_GATEQ_CONCURRENCY_URL=postgres://postgres:postgres@127.0.0.1:54322/cq_gateq_supersession_test \
        node supabase/tests/database/rls/support/gateq-supersession-concurrency.mjs || rc=1
  fi
  stop_supabase
  return "$rc"
}
step_integration() {
  fresh_supabase || return 1
  local rc=0
  pnpm exec turbo run build --filter=./packages/* --concurrency=2 &&
    CQ_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
      DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
      pnpm test:integration || rc=1
  stop_supabase
  return "$rc"
}

started=$SECONDS
mkdir -p "$root/cache/prettier"
stopped=""
for name in $steps; do
  if [ -n "$stopped" ]; then
    result[$name]="NOT RUN (after $stopped failed)"
    continue
  fi
  run "$name" "step_$name"
  case "${result[$name]}" in
    PASS*) ;;
    *) [ "${CI_LOCAL_DIAGNOSE:-0}" = "1" ] || stopped="$name" ;;
  esac
done

verdict=PASS
for name in $steps; do
  case "${result[$name]}" in PASS*) ;; *) verdict=FAIL ;; esac
done
[ "$dirty" = "0" ] || verdict="$verdict (uncommitted changes: not a receipt)"
echo
at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "ci-local $verdict sha=$sha at=$at took=$((SECONDS - started))s"
for name in $steps; do echo "  $name: ${result[$name]}"; done
# The receipt scripts/deploy-promote.sh requires: every step, a clean tree,
# for this full commit SHA. A subset or a dirty tree writes none.
if [ "$verdict" = PASS ] && [ "$steps" = "static typecheck build test database integration" ]; then
  echo "PASS $full $at" >"$root/receipts/$full"
  echo "receipt: $root/receipts/$full"
fi
case "$verdict" in PASS) exit 0 ;; *) exit 1 ;; esac
