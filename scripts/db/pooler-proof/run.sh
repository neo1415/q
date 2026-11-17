#!/usr/bin/env bash
# Transaction-pooler proof (DECISIONS 101; the 16 Nov trial was rolled back).
#
# Runs q-api's database layer, the run engine and the integration suites that
# cover runs, checkpoints, conversation state, memory reads and LISTEN wake
# through Supavisor in TRANSACTION mode, on a small pool, before anyone
# retries the pooler in production. Local only: no Railway, no hosted
# database, no provider calls.
#
#   bash scripts/heavy.sh bash scripts/db/pooler-proof/run.sh
#
# Topology: a second, separate local Supabase project (its own project id
# and ports), so it never touches the gate's `capital-q` containers:
#   Postgres 17 (the gate's image)    127.0.0.1:54422   fixtures and cleanup
#   Supavisor, transaction mode       127.0.0.1:54429   every app client
#   Supavisor, session mode           <container>:5432  LISTEN, as hosted
# Pool: POOLER_PROOF_POOL_SIZE server connections (default 4) per user, so a
# handful of app clients saturate it. Run under scripts/heavy.sh: it uses
# Docker, as the gate does.
#
# Env: POOLER_PROOF_DIR (scratch workdir, default /tmp/pooler-proof),
#      POOLER_PROOF_KEEP=1 (leave the stack running afterwards),
#      POOLER_PROOF_STEPS ("proof suites" by default).
set -uo pipefail
[ -x /opt/node24/bin/node ] && export PATH="/opt/node24/bin:$PATH"
cd "$(dirname "$0")/../../.."
dir="${POOLER_PROOF_DIR:-/tmp/pooler-proof}"
pool="${POOLER_PROOF_POOL_SIZE:-4}"
steps="${POOLER_PROOF_STEPS:-proof suites}"
project=capital-q-pooler-proof

# The gate's own exclusions, minus supavisor (the point of this harness).
exclude=studio,imgproxy,inbucket,edge-runtime,logflare,vector,storage-api,realtime,postgres-meta

if ! timeout 10 docker info >/dev/null 2>&1; then
  echo "pooler-proof: Docker is not running (start it as scripts/ci-local.sh does)" >&2
  exit 1
fi

# A copy of supabase/ (migrations, seed, config) with its own project id,
# ports moved up by 100, and the pooler on in transaction mode.
rm -rf "$dir"
mkdir -p "$dir"
cp -R supabase "$dir/supabase"
sed -i \
  -e "s/^project_id = .*/project_id = \"$project\"/" \
  -e 's/^port = 543\([0-9][0-9]\)$/port = 544\1/' \
  -e 's/^shadow_port = 54320$/shadow_port = 54420/' \
  -e 's/^inspector_port = 8083$/inspector_port = 8183/' \
  "$dir/supabase/config.toml"
# Only inside the [db.pooler] block: on, transaction mode, the small pool.
sed -i "/^\[db\.pooler\]/,/^\[db\.migrations\]/{
  s/^enabled = .*/enabled = true/
  s/^pool_mode = .*/pool_mode = \"transaction\"/
  s/^default_pool_size = .*/default_pool_size = $pool/
  s/^max_client_conn = .*/max_client_conn = 400/
}" "$dir/supabase/config.toml"

stop() { pnpm exec supabase stop --workdir "$dir" --no-backup >/dev/null 2>&1; }
stop
if ! pnpm exec supabase start --workdir "$dir" -x "$exclude"; then
  stop
  exit 1
fi

pooler="$(docker ps --format '{{.Names}}' | grep "$project" | grep -i -E 'supavisor|pooler' | head -1)"
if [ -z "$pooler" ]; then
  echo "pooler-proof: no Supavisor container for $project" >&2
  stop
  exit 1
fi
pooler_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$pooler")"
echo "pooler-proof: $pooler at $pooler_ip, pool $pool, transaction mode on :54429"

# The local stack's throwaway credentials (not secrets). The tenant is the
# one the Supabase CLI registers with its Supavisor: user postgres.pooler-dev.
export POOLER_PROOF_DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
export POOLER_PROOF_POOLER_URL="postgresql://postgres.pooler-dev:postgres@127.0.0.1:54429/postgres"
export POOLER_PROOF_LISTEN_URL="postgresql://postgres.pooler-dev:postgres@${pooler_ip}:5432/postgres"
export POOLER_PROOF_POOL_SIZE="$pool"
# Fixtures and cleanup in the existing suites use these directly (direct
# connection); the app clients they build are moved onto the pooler by the
# config shim (vitest.config.mjs).
export CQ_TEST_DATABASE_URL="$POOLER_PROOF_DIRECT_URL"
export DATABASE_URL="$POOLER_PROOF_DIRECT_URL"
# No provider is ever called; non-empty so no .env.local can supply a key.
for key in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY \
  DEEPSEEK_API_KEY ELEVENLABS_API_KEY DEEPGRAM_API_KEY SERP_API_KEY TAVILY_API_KEY; do
  export "$key=disabled-locally-000000000000"
done

rc=0
for step in $steps; do
  case "$step" in
    # The harness's own proofs: load, limits, cancel, LISTEN, runs.
    proof) pnpm exec vitest run --config scripts/db/pooler-proof/vitest.config.mjs --project proof || rc=1 ;;
    # Existing integration suites with app clients on the pooler, files in parallel.
    suites) pnpm exec vitest run --config scripts/db/pooler-proof/vitest.config.mjs --project suites || rc=1 ;;
    *) echo "pooler-proof: unknown step $step" >&2; rc=1 ;;
  esac
done

if [ "${POOLER_PROOF_KEEP:-0}" != 1 ]; then stop; fi
if [ "$rc" = 0 ]; then echo "pooler-proof: PASS"; else echo "pooler-proof: FAIL"; fi
exit "$rc"
