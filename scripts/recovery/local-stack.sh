#!/usr/bin/env bash
# Recovery G: the local full stack with no live provider calls.
#
#   scripts/recovery/local-stack.sh start [service...]   # default: all, one at a time
#   scripts/recovery/local-stack.sh stop  [service...]   # only what this script started
#   scripts/recovery/local-stack.sh status
#   scripts/recovery/local-stack.sh seed                 # fictional world, through the api
#   scripts/recovery/local-stack.sh env                  # print the env file path
#
# Services, in start order: db fake api q-api workers web.
# See scripts/recovery/local-stack.md for what each one is and why.
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# CQ_RECOVERY_ROOT runs another checkout's apps (e.g. the production
# baseline) under this harness: the guard, fake and env still come from here.
ROOT="${CQ_RECOVERY_ROOT:-$HARNESS}"
RUN="${CQ_RECOVERY_RUN_DIR:-$HARNESS/.playwright/recovery-stack}"
mkdir -p "$RUN"
ENV_FILE="$RUN/stack.env"

WEB_PORT="${CQ_RECOVERY_WEB_PORT:-3200}"
API_PORT="${CQ_RECOVERY_API_PORT:-3201}"
QAPI_PORT="${CQ_RECOVERY_QAPI_PORT:-3202}"
FAKE_PORT="${CQ_FAKE_PORT:-3990}"
DISABLED="disabled-locally-000000000000"
ALL=(db fake api q-api workers web)

# MOCK (default, CI): no vendor is reachable; the model is fake-vendors.mjs.
# LIVE (manual, founder-approved budget): real OpenAI (and optionally
# Deepgram) for this local stack only. Needs, in the operator's shell:
#   CQ_RECOVERY_MODE=live CQ_LIVE_OPENAI_API_KEY=<a non-production key>
#   CQ_LIVE_BUDGET_USD=<cap, e.g. 1>  [CQ_LIVE_DEEPGRAM_API_KEY=...]
#   [CQ_LIVE_PROXY_HOST=<proxy host> when vendors are only reachable via a proxy]
# The key is exported to the guarded processes only and is never written
# to the env file, the logs or the repository.
MODE="${CQ_RECOVERY_MODE:-mock}"
LIVE_HOSTS="api.openai.com,api.deepgram.com,agent.deepgram.com"
if [[ "$MODE" == live ]]; then
  [[ -n "${CQ_LIVE_OPENAI_API_KEY:-}" ]] || { echo "[local-stack] LIVE needs CQ_LIVE_OPENAI_API_KEY"; exit 2; }
  [[ "${CQ_LIVE_BUDGET_USD:-}" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "[local-stack] LIVE needs CQ_LIVE_BUDGET_USD (the approved cap)"; exit 2; }
  case "${CQ_LIVE_OPENAI_API_KEY}" in disabled-*) echo "[local-stack] LIVE refused: that is the disabled placeholder"; exit 2;; esac
elif [[ "$MODE" != mock ]]; then
  echo "[local-stack] CQ_RECOVERY_MODE is mock or live"; exit 2
fi

log() { printf '[local-stack] %s\n' "$*"; }

ensure_docker() {
  if docker info >/dev/null 2>&1; then return; fi
  log "docker daemon not running; starting dockerd (VM restarts stop it)"
  nohup dockerd >"$RUN/dockerd.log" 2>&1 &
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && return; sleep 1; done
  log "dockerd did not come up; see $RUN/dockerd.log"; exit 1
}

write_env() {
  # Local loopback keys from the local Supabase stack only. Never a hosted value.
  local status
  status="$(cd "$ROOT" && npx supabase status -o env 2>/dev/null)"
  local api_url publishable secret db_url
  api_url="$(printf '%s\n' "$status" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  publishable="$(printf '%s\n' "$status" | sed -n 's/^PUBLISHABLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  secret="$(printf '%s\n' "$status" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  db_url="$(printf '%s\n' "$status" | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  case "$api_url" in http://127.0.0.1:*|http://localhost:*) ;; *) log "refusing non-loopback Supabase URL"; exit 1;; esac
  case "$db_url" in postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) log "refusing non-loopback database URL"; exit 1;; esac
  umask 077
  cat >"$ENV_FILE" <<EOF
NODE_ENV=development
CAPITAL_Q_ENV=local
LOG_LEVEL=info
HOST=127.0.0.1
DATABASE_URL=$db_url
DATABASE_PRIVILEGED_URL=$db_url
SUPABASE_URL=$api_url
SUPABASE_PUBLISHABLE_KEY=$publishable
SUPABASE_SECRET_KEY=$secret
NEXT_PUBLIC_SUPABASE_URL=$api_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$publishable
CQ_API_URL=http://127.0.0.1:$API_PORT
CQ_Q_API_URL=http://127.0.0.1:$QAPI_PORT
Q_API_PUBLIC_URL=http://127.0.0.1:$QAPI_PORT
CQ_WEB_ORIGIN=http://127.0.0.1:$WEB_PORT
CQ_FOUNDER_ONBOARDING_ADAPTER=api
OPENAI_BASE_URL=http://127.0.0.1:$FAKE_PORT/v1
OPENAI_API_KEY=$DISABLED
GEMINI_API_KEY=$DISABLED
GROQ_API_KEY=$DISABLED
ELEVENLABS_API_KEY=$DISABLED
DEEPGRAM_API_KEY=$DISABLED
PEXELS_API_KEY=$DISABLED
RECALL_API_KEY=$DISABLED
CQ_SEED_ACCOUNT_PASSWORD=CapitalQ-dev-2026!
EOF
  log "env written to $ENV_FILE (loopback values, provider keys disabled)"
}

pidfile() { printf '%s/%s.pid' "$RUN" "$1"; }
running() { local p; p="$(pidfile "$1")"; [[ -f "$p" ]] && kill -0 "$(cat "$p")" 2>/dev/null; }

wait_http() {
  local name="$1" url="$2" seconds="${3:-180}"
  for _ in $(seq 1 "$seconds"); do
    if curl -sf -o /dev/null --noproxy '*' "$url"; then log "$name up ($url)"; return 0; fi
    if ! running "$name"; then log "$name exited; tail of $RUN/$name.log:"; tail -20 "$RUN/$name.log"; return 1; fi
    sleep 1
  done
  log "$name not ready after ${seconds}s; see $RUN/$name.log"; return 1
}

launch() {
  # launch <name> <cwd> <command...>: detached, own log, egress guarded.
  local name="$1" cwd="$2"; shift 2
  if running "$name"; then log "$name already running (pid $(cat "$(pidfile "$name")"))"; return; fi
  (
    # A clean environment: a cloud shell carries real credentials (SMTP,
    # Google, Railway...) that a service would otherwise pick up and use.
    # Found live: q-api inherited SMTP_API_KEY and tried to send reminder
    # emails through api.brevo.com (refused by the egress guard).
    local keep_path="$PATH" keep_home="$HOME" proxy="${HTTPS_PROXY:-}"
    local live_key="${CQ_LIVE_OPENAI_API_KEY:-}" live_dg="${CQ_LIVE_DEEPGRAM_API_KEY:-}"
    local live_proxy="${CQ_LIVE_PROXY_HOST:-}" ca="${NODE_EXTRA_CA_CERTS:-}"
    local live_gl="${CQ_LIVE_GPT_LIVE_KEY:-}" fake_gl="${CQ_RECOVERY_GPT_LIVE:-}"
    local fake_search="${CQ_RECOVERY_SEARCH:-}"
    for var in $(compgen -e); do unset "$var" 2>/dev/null || true; done
    export PATH="$keep_path" HOME="$keep_home"
    CQ_LIVE_OPENAI_API_KEY="$live_key"; CQ_LIVE_DEEPGRAM_API_KEY="$live_dg"
    CQ_LIVE_PROXY_HOST="$live_proxy"
    if [[ -n "$live_proxy" ]]; then
      export HTTPS_PROXY="$proxy" NODE_USE_ENV_PROXY=1
      [[ -n "$ca" ]] && export NODE_EXTRA_CA_CERTS="$ca"
    fi
    set -a; source "$ENV_FILE"; set +a
    if [[ "$MODE" == live ]]; then
      # LIVE: the operator's key, from their shell only; never in the env file.
      export OPENAI_API_KEY="$CQ_LIVE_OPENAI_API_KEY"
      unset OPENAI_BASE_URL
      [[ -n "${CQ_LIVE_DEEPGRAM_API_KEY:-}" ]] && export DEEPGRAM_API_KEY="$CQ_LIVE_DEEPGRAM_API_KEY"
      export CQ_EGRESS_ALLOW="$LIVE_HOSTS${CQ_LIVE_PROXY_HOST:+,$CQ_LIVE_PROXY_HOST}"
      [[ -n "${CQ_LIVE_PROXY_HOST:-}" ]] && export CQ_EGRESS_KEEP_PROXY=1
      # Realtime on, bounded by its own spend cap and session length.
      export CQ_VOICE_REALTIME=on
      export CQ_VOICE_REALTIME_DAILY_CAP_USD="$CQ_LIVE_BUDGET_USD"
      export CQ_VOICE_REALTIME_MAX_SESSION_SECONDS=120
      export CQ_SYNTHETIC_DEMO_ROUTING=true
    else
      unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY all_proxy
      # Synthetic world only, as the 2026-10-08 incident tenant was.
      export CQ_VOICE_REALTIME=on CQ_FAKE_VOICE_VENDORS=1 CQ_SYNTHETIC_DEMO_ROUTING=true
      # V, opt-in (CQ_RECOVERY_GPT_LIVE=1): GPT-Live as the product voice,
      # its session creation answered by the fake vendor (no key, no audio).
      # The fake sessions still land on the local ledger: a high local cap.
      [[ "$fake_gl" == 1 ]] && export CQ_VOICE_LIVE=on CQ_VOICE_PREVIEW=on CQ_VOICE_LIVE_DAILY_CAP_USD=20
      # V2, opt-in (CQ_RECOVERY_SEARCH=1): q-api builds its public people-search
      # adapter on a DISABLED key; vendor-redirect.mjs sends its calls to the
      # fake, which scripts and logs them. No real search provider is reachable.
      [[ "$fake_search" == 1 && "$name" == q-api ]] && export SERPER_API_KEY="$DISABLED"
      # V (GPT-Live developer preview), opt-in: CQ_LIVE_GPT_LIVE_KEY in the
      # operator's shell. The model stays the fake; only q-api gets the key,
      # and only for the GPT-Live session call (CQ_VOICE_LIVE_OPENAI_API_KEY,
      # honoured in a local deployment only). Short calls, a small cap.
      if [[ -n "$live_gl" ]]; then
        export CQ_VOICE_LIVE=on CQ_VOICE_PREVIEW=on
        export CQ_VOICE_LIVE_MAX_SESSION_SECONDS=60 CQ_VOICE_LIVE_DAILY_CAP_USD=0.5
        if [[ "$name" == q-api ]]; then
          export CQ_VOICE_LIVE_OPENAI_API_KEY="$live_gl"
          export CQ_EGRESS_ALLOW="api.openai.com${live_proxy:+,$live_proxy}"
          if [[ -n "$proxy" ]]; then
            export HTTPS_PROXY="$proxy" NODE_USE_ENV_PROXY=1 CQ_EGRESS_KEEP_PROXY=1
            export NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost"
            [[ -n "$ca" ]] && export NODE_EXTRA_CA_CERTS="$ca"
          fi
        fi
      fi
    fi
    live_gl=""
    unset CQ_LIVE_OPENAI_API_KEY CQ_LIVE_DEEPGRAM_API_KEY
    export NODE_OPTIONS="--import=$HARNESS/scripts/recovery/vendor-redirect.mjs --import=$HARNESS/scripts/recovery/egress-guard.mjs ${NODE_OPTIONS:-}"
    cd "$cwd"
    exec setsid "$@" >>"$RUN/$name.log" 2>&1
  ) &
  echo $! >"$(pidfile "$name")"
  log "$name started (pid $!), log $RUN/$name.log"
}

start_one() {
  case "$1" in
    db)
      ensure_docker
      # Containers restart with the daemon; Postgres needs a moment after that.
      for _ in $(seq 1 120); do
        docker exec supabase_db_capital-q pg_isready -U postgres >/dev/null 2>&1 && break
        sleep 1
      done
      # The containers survive in docker; storage and realtime may have been left stopped.
      (cd "$ROOT" && npx supabase status >/dev/null 2>&1) || (cd "$ROOT" && npx supabase start -x studio,imgproxy,vector,logflare,edge-runtime,supavisor)
      for c in supabase_storage_capital-q supabase_realtime_capital-q; do
        docker start "$c" >/dev/null 2>&1 || true
      done
      # G2 K2: local FAST_CLASSIFICATION routes to the fake vendor's model, not Gemini.
      docker exec -i supabase_db_capital-q psql -U postgres -v ON_ERROR_STOP=1 -q <"$HARNESS/scripts/recovery/local-routing.sql"
      write_env ;;
    fake)
      [[ -f "$ENV_FILE" ]] || write_env
      launch fake "$HARNESS" env CQ_FAKE_PORT="$FAKE_PORT" CQ_FAKE_LOG="$RUN/fake-vendors.ndjson" node scripts/recovery/fake-vendors.mjs
      wait_http fake "http://127.0.0.1:$FAKE_PORT/__fake/health" 30 ;;
    api)
      launch api "$ROOT/apps/api" env PORT="$API_PORT" node --import ../../scripts/dev-env.mjs src/main.ts
      wait_http api "http://127.0.0.1:$API_PORT/health/live" ;;
    q-api)
      launch q-api "$ROOT/apps/q-api" env PORT="$QAPI_PORT" node --import ../../scripts/dev-env.mjs src/main.ts
      wait_http q-api "http://127.0.0.1:$QAPI_PORT/health/live" ;;
    workers)
      launch workers "$ROOT/apps/workers" node --import ../../scripts/dev-env.mjs src/main.ts
      sleep 3; running workers && log "workers running" ;;
    web)
      launch web "$ROOT/apps/web" node ./node_modules/next/dist/bin/next dev --port "$WEB_PORT" --hostname 127.0.0.1
      wait_http web "http://127.0.0.1:$WEB_PORT/auth/sign-in" 300 ;;
    *) log "unknown service $1"; exit 2 ;;
  esac
}

stop_one() {
  local p; p="$(pidfile "$1")"
  if [[ "$1" == db ]]; then log "db left running (shared with pgTAP); use 'npx supabase stop' to stop it"; return; fi
  if running "$1"; then
    # setsid made the service its own process group: stop the whole group.
    kill -TERM -- "-$(cat "$p")" 2>/dev/null || kill -TERM "$(cat "$p")" 2>/dev/null || true
    log "$1 stopped"
  fi
  rm -f "$p"
}

cmd="${1:-status}"; shift || true
services=("$@"); [[ ${#services[@]} -eq 0 ]] && services=("${ALL[@]}")

case "$cmd" in
  start)
    echo "$MODE" >"$RUN/mode"; log "mode: $MODE"
    # V (G-D26): whether q-api's GPT-Live line is on, for the specs that
    # need it (gpt-live.spec fails fast and says so when it is off).
    for s in "${services[@]}"; do
      [[ "$s" == q-api ]] && echo "${CQ_RECOVERY_GPT_LIVE:-0}" >"$RUN/gpt-live"
      [[ "$s" == q-api ]] && echo "${CQ_RECOVERY_SEARCH:-0}" >"$RUN/search"
    done
    log "gpt-live: $(cat "$RUN/gpt-live" 2>/dev/null || echo unknown)"
    for s in "${services[@]}"; do start_one "$s"; done ;;
  stop)
    for (( i=${#services[@]}-1; i>=0; i-- )); do stop_one "${services[$i]}"; done ;;
  status)
    log "mode: $(cat "$RUN/mode" 2>/dev/null || echo unknown)"
    log "gpt-live: $(cat "$RUN/gpt-live" 2>/dev/null || echo unknown)"
    docker info >/dev/null 2>&1 && log "docker: up" || log "docker: down"
    for s in fake api q-api workers web; do
      if running "$s"; then log "$s: running (pid $(cat "$(pidfile "$s")"))"; else log "$s: stopped"; fi
    done
    refused="$(grep -h '"recovery egress refused"' "$RUN"/*.log 2>/dev/null | wc -l)"
    log "egress refusals logged: $refused" ;;
  seed)
    set -a; source "$ENV_FILE"; set +a
    unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy
    cd "$ROOT" && CQ_SEED_API_URL="http://127.0.0.1:$API_PORT" node scripts/seed-fictional-world.mjs --local-stack --out "$RUN/fictional-world"
    # G2-SEED: one playable pitch whose transcript says a raise (no video provider locally).
    docker exec -i supabase_db_capital-q psql -U postgres -v ON_ERROR_STOP=1 -q <"$HARNESS/scripts/recovery/seed-pitch-raise.sql" ;;
  reset-allowance)
    # V2: the LOCAL org's monthly rehearsal allowance (q.rehearsals) runs out
    # after 30 Joins, and every later Join is a 402 that looks like a broken call.
    docker exec -i supabase_db_capital-q psql -U postgres -v ON_ERROR_STOP=1 -q -c "update billing.usage_events set voided_at = now(), void_reason = 'local test reset' where feature_key = 'q.rehearsals' and voided_at is null" ;;
  seed-research)
    # V2/W5: the Qatar Five prepared entities, loaded into the LOCAL database
    # (no web fetch, no provider call), with logos pointing at this web origin.
    set -a; source "$ENV_FILE"; set +a
    unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy
    cd "$ROOT" && node --import ./scripts/dev-env.mjs apps/q-api/src/dev/load-research-seed.ts --web-origin "http://127.0.0.1:$WEB_PORT"
    bash "$0" reset-allowance ;;
  env) echo "$ENV_FILE" ;;
  *) log "usage: $0 start|stop|status|seed|env [service...]"; exit 2 ;;
esac
