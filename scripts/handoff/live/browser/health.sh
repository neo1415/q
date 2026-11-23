#!/usr/bin/env bash
# Hourly production health check (no spend): branches, Railway deploys, workers heartbeat, stuck Q runs, q-api error logs.
#   bash scripts/handoff/live/browser/health.sh <deployed-sha> <from HH:MM:SS UTC> <to HH:MM:SS UTC>
set -u
cd "$(git rev-parse --show-toplevel)"
export PATH=/opt/node24/bin:$PATH NODE_USE_ENV_PROXY=1 SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN:-proxy-injected}
pgrep -af ci-local.sh | head -2
git ls-remote origin fix/resume-asking-cv9ru3 recovery/2026-09-12
node scripts/handoff/live/railway/deploys.mjs 2>&1 | grep capital-q
node scripts/handoff/live/hosted-read.mjs "select service, extract(epoch from now()-beat_at)::int age_s from platform_ops.service_heartbeats" | tail -1
node scripts/handoff/live/hosted-read.mjs "select status, count(*) from q_runtime.runs where created_at < now()-interval '15 minutes' and status in ('RUNNING','QUEUED','PENDING','STARTED') group by 1" | tail -1
node scripts/handoff/live/railway/qlogs.mjs "$1" '57014|DB_POOL|"level":50' "$2" "$3" | tail -5
