#!/usr/bin/env bash
# Run one memory-heavy command (vitest, tsc, eslint, next build, a pre-gate)
# under the machine's single heavy-work lock (owner, 15 Nov 2026).
#
# Why: this 4-vCPU / 16 GB machine runs the release gate and several workers.
# The gate's own lock only kept out a second gate, so workers' test runs
# overlapped it and the gate failed on out-of-memory kills and timeouts, not
# on code. Every heavy command now waits its turn here, and the gate holds
# the same lock for its whole run.
#
# Usage: bash scripts/heavy.sh <command> [args...]
set -euo pipefail
root="${CI_LOCAL_OUT:-/tmp/ci-local}"
mkdir -p "$root"
exec 8>"$root/heavy.lock"
if ! flock -n 8; then
  echo "heavy: waiting for the machine ($(cat "$root/heavy.owner" 2>/dev/null || echo busy))" >&2
  flock 8
fi
echo "pid=$$ cmd=$1 since=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$root/heavy.owner"
# exec keeps fd 8 (the lock) open for the command's whole life.
exec "$@"
