#!/usr/bin/env bash
# Cheap checks before the expensive release gate (owner direction, 14 Nov 2026).
#
# The full gate (scripts/ci-local.sh) takes ~26 minutes. Most of today's gate
# failures were preventable in a minute or two: unformatted docs, a missing
# UI-text translation, a migration version clash, stale tests next to changed
# code, lint on changed files. This script runs exactly those checks on what
# changed since production, so the full gate only ever runs on a commit that
# already passes them. It never replaces the gate and weakens nothing: every
# check here is a subset of a check the gate runs with the same config.
#
# Usage: bash scripts/pre-gate.sh [base-ref]   (default origin/recovery/2026-09-12)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
# Hold the machine's heavy-work lock (scripts/heavy.sh) for the whole
# pre-gate, so it never overlaps the release gate or another worker's run.
lock_root="${CI_LOCAL_OUT:-/tmp/ci-local}"
mkdir -p "$lock_root"
exec 8>"$lock_root/heavy.lock"
if ! flock -n 8; then
  echo "pre-gate: waiting for the machine ($(cat "$lock_root/heavy.owner" 2>/dev/null || echo busy))" >&2
  flock 8
fi
echo "pid=$$ cmd=pre-gate since=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$lock_root/heavy.owner"
export PATH=/opt/node24/bin:$PATH
base="${1:-origin/recovery/2026-09-12}"
git fetch -q origin "${base#origin/}" 2>/dev/null || true

mapfile -t changed < <(git diff --name-only --diff-filter=ACMR "$base"...HEAD)
fail=0
step() { printf '\n== %s\n' "$1"; }
bad() { echo "FAIL: $1"; fail=1; }

echo "pre-gate: ${#changed[@]} files changed since $base"

step "prettier (changed files)"
fmt=()
for f in "${changed[@]}"; do
  case "$f" in *.ts|*.tsx|*.mts|*.mjs|*.js|*.json|*.md|*.css|*.yml|*.yaml) [ -f "$f" ] && fmt+=("$f");; esac
done
if [ ${#fmt[@]} -gt 0 ]; then npx prettier --check "${fmt[@]}" >/dev/null 2>&1 || { npx prettier --check "${fmt[@]}" 2>&1 | grep '\[warn\]'; bad "prettier (run: npx prettier --write <files>)"; }; fi

step "migration versions unique"
dups=$(ls supabase/migrations | grep -oE '^[0-9]+' | sort | uniq -d)
[ -z "$dups" ] || bad "duplicate migration versions: $dups"

step "UI-text catalogue current (incl. Arabic)"
node --experimental-strip-types scripts/i18n/generate-ui-text-source.mts 2>&1 | tail -1
if ! git diff --quiet -- packages/q-core/src/ui-text/source.generated.ts; then
  bad "source.generated.ts was stale (regenerated now; commit it)"
fi
node --experimental-strip-types scripts/i18n/generate-ui-text-source.mts 2>&1 | grep -qE '\(0 gaps\)' || bad "catalogue has translation gaps"

step "package builds (dist current for type-aware checks)"
pnpm exec turbo run build --filter=./packages/* --output-logs=errors-only >/dev/null 2>&1 || bad "package build"

step "eslint (changed TS and JS files, batches of 4)"
lint=()
for f in "${changed[@]}"; do case "$f" in *.ts|*.tsx|*.mts|*.mjs|*.js) [ -f "$f" ] && lint+=("$f");; esac; done
for ((i = 0; i < ${#lint[@]}; i += 4)); do
  NODE_OPTIONS=--max-old-space-size=7168 npx eslint --max-warnings=0 "${lint[@]:i:4}" || bad "eslint ${lint[*]:i:4}"
done

step "root typecheck (includes tests)"
# Status is captured directly: under pipefail, `cmd | tail || true` resets
# PIPESTATUS, which once let an OOM-killed tsc report PASS (14 Nov).
tsc_out=$(node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1)
tsc_status=$?
printf '%s\n' "$tsc_out" | tail -20
[ "$tsc_status" -eq 0 ] || bad "root tsc (exit $tsc_status)"

step "app typechecks (each touched app's own tsconfig)"
# The root tsconfig does not cover every app's own config (apps/web test
# typing slipped through to the gate, 14 Nov).
for app in $(printf '%s\n' "${changed[@]}" | grep -oE '^apps/[^/]+' | sort -u); do
  if [ -f "$app/package.json" ] && grep -q '"typecheck"' "$app/package.json"; then
    app_out=$(cd "$app" && NODE_OPTIONS=--max-old-space-size=6144 pnpm run -s typecheck 2>&1)
    app_status=$?
    printf '%s\n' "$app_out" | grep -E 'error TS' | head -20
    [ "$app_status" -eq 0 ] || bad "$app typecheck (exit $app_status)"
  fi
done

step "repository-scan tests (not reachable by vitest related)"
# These read the source tree rather than importing it, so a changed file never
# makes them "related" (an unmarked form reached the gate, 14 Nov).
scan_tests=$(grep -rlE "readdirSync|globSync|fast-glob" apps/*/test packages/*/test 2>/dev/null | grep -E "\.test\.tsx?$" | sort -u)
if [ -n "$scan_tests" ]; then
  # shellcheck disable=SC2086
  sc_out=$(NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --maxWorkers=2 $scan_tests 2>&1)
  sc_status=$?
  printf '%s\n' "$sc_out" | grep -E '^ FAIL ' | sort -u
  printf '%s\n' "$sc_out" | tail -4
  [ "$sc_status" -eq 0 ] || bad "repository-scan tests (exit $sc_status)"
fi

step "tests related to changed source"
src=()
for f in "${changed[@]}"; do case "$f" in apps/*|packages/*) case "$f" in *.ts|*.tsx) [ -f "$f" ] && src+=("$f");; esac;; esac; done
if [ ${#src[@]} -gt 0 ]; then
  # Bounded workers and heap: an unbounded related run OOMed on the shared
  # 4-vCPU machine (14 Nov). Same tests, same assertions, fewer at once.
  vt_out=$(NODE_OPTIONS=--max-old-space-size=6144 npx vitest related --run --maxWorkers=2 "${src[@]}" 2>&1)
  vt_status=$?
  # Name every failing test, then the summary (a bare tail hid them, 14 Nov).
  printf '%s\n' "$vt_out" | grep -E '^ FAIL ' | sort -u
  printf '%s\n' "$vt_out" | tail -6
  [ "$vt_status" -eq 0 ] || bad "vitest related (exit $vt_status)"
fi

echo
if [ $fail -eq 0 ]; then echo "pre-gate PASS sha=$(git rev-parse --short HEAD)"; else echo "pre-gate FAIL sha=$(git rev-parse --short HEAD)"; exit 1; fi
