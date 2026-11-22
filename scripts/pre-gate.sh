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

step "app typechecks (each touched app's own tsconfig; every app when a package changed)"
# The root tsconfig does not cover every app's own config (apps/web test
# typing slipped through to the gate, 14 Nov).
# A package change can break an app that imports it (live 16 Nov: an
# evidence row type broke q-api while only packages/ and apps/web changed).
apps_to_check=$(printf '%s\n' "${changed[@]}" | grep -oE '^apps/[^/]+' | sort -u)
if printf '%s\n' "${changed[@]}" | grep -qE '^packages/[^/]+/src/'; then apps_to_check=$(ls -d apps/*/ | sed 's#/$##'); fi
for app in $apps_to_check; do
  if [ -f "$app/package.json" ] && grep -q '"typecheck"' "$app/package.json"; then
    app_out=$(cd "$app" && NODE_OPTIONS=--max-old-space-size=6144 pnpm run -s typecheck 2>&1)
    app_status=$?
    printf '%s\n' "$app_out" | grep -E 'error TS' | head -20
    [ "$app_status" -eq 0 ] || bad "$app typecheck (exit $app_status)"
  fi
done

step "web bundle budget (when web or a package it bundles changed)"
# The gate's build step checks every route's first-load JS against
# apps/web/bundle-budget.json; two new pages failed it late on 21 Nov. A new
# or grown route needs its budget in the same commit, with a reason
# (bundle-budget.mjs --write measures every route; keep only that route's
# line from its diff, since the rest is hash noise). NODE_OPTIONS is cleared because the
# sandbox's --use-openssl-ca is refused by the Next build workers.
if printf '%s\n' "${changed[@]}" | grep -qE '^(apps/web/|packages/[^/]+/src/)'; then
  wb_out=$(cd apps/web && NODE_OPTIONS= pnpm run -s build 2>&1)
  wb_status=$?
  if [ "$wb_status" -ne 0 ]; then
    printf '%s\n' "$wb_out" | tail -20
    bad "web build (exit $wb_status)"
  else
    node apps/web/scripts/bundle-budget.mjs 2>&1 | tail -12 || bad "bundle budget (budget the new or grown route in apps/web/bundle-budget.json; --write measures them all)"
  fi
else
  echo "web and its packages unchanged"
fi

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

step "test suites of each changed package and everything that depends on it"
# `vitest related` follows source imports, but a workspace package is
# imported through its built dist, so a test in a dependent package is
# never "related" (21 Nov: a new Q capability changed q-specialists'
# manifest expectation and only the gate saw it). Here: every unit
# (apps/* or packages/*) that depends on a changed package, directly or
# through another, runs its whole unit suite, with the gate's config.
changed_pkgs=()
for unit in $(printf '%s\n' "${changed[@]}" | grep -oE '^packages/[^/]+' | sort -u); do
  [ -f "$unit/package.json" ] || continue
  name=$(node -e 'process.stdout.write(require("./'"$unit"'/package.json").name)' 2>/dev/null)
  [ -n "$name" ] && changed_pkgs+=("$name")
done
dependents=()
if [ ${#changed_pkgs[@]} -gt 0 ]; then
  mapfile -t dependents < <(CHANGED="${changed_pkgs[*]}" node -e '
    const fs = require("fs");
    const units = [];
    for (const top of ["apps", "packages"]) {
      for (const dir of fs.readdirSync(top)) {
        const file = `${top}/${dir}/package.json`;
        if (!fs.existsSync(file)) continue;
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        const deps = { ...json.dependencies, ...json.devDependencies };
        units.push({ path: `${top}/${dir}/`, name: json.name, deps: Object.keys(deps) });
      }
    }
    // Transitive: a dependent of a dependent sees the change too.
    const reached = new Set(process.env.CHANGED.split(" "));
    const out = new Set();
    for (let grew = true; grew; ) {
      grew = false;
      for (const unit of units) {
        if (out.has(unit.path) || !(reached.has(unit.name) || unit.deps.some((d) => reached.has(d)))) continue;
        out.add(unit.path);
        reached.add(unit.name);
        grew = true;
      }
    }
    for (const path of out) console.log(path);')
fi
if [ ${#dependents[@]} -gt 0 ]; then
  echo "${#dependents[@]} dependent unit(s): ${dependents[*]}"
  dp_out=$(NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --maxWorkers=2 --passWithNoTests "${dependents[@]}" 2>&1)
  dp_status=$?
  printf '%s\n' "$dp_out" | grep -E '^ FAIL ' | sort -u
  printf '%s\n' "$dp_out" | tail -4
  [ "$dp_status" -eq 0 ] || bad "dependent packages' tests (exit $dp_status)"
else
  echo "no changed package has a dependent"
fi

step "integration tests and pgTAP touching what changed (local Supabase)"
# W1-A (enterprise audit 21 Nov 2026, finding 7): two gates failed late on
# 20 Nov on integration tests that pinned a prompt version the change had
# moved. Here: every *.integration.test.ts in a changed package or app,
# plus every one that imports a changed package, runs against a fresh local
# Supabase, the same way the gate runs them; a changed migration or pgTAP
# file runs the database suite too. PRE_GATE_INTEGRATION=0 skips this step
# only with a loud line (the full gate still runs everything).
integration_files=()
changed_units=$(printf '%s\n' "${changed[@]}" | grep -oE '^(apps|packages)/[^/]+' | sort -u)
for unit in $changed_units; do
  while IFS= read -r f; do [ -n "$f" ] && integration_files+=("$f"); done < <(find "$unit" -name '*.integration.test.ts' -not -path '*/node_modules/*' 2>/dev/null)
  if [ "${unit%%/*}" = packages ] && [ -f "$unit/package.json" ]; then
    name=$(node -e 'process.stdout.write(require("./'"$unit"'/package.json").name)' 2>/dev/null)
    if [ -n "$name" ]; then
      while IFS= read -r f; do [ -n "$f" ] && integration_files+=("$f"); done < <(grep -rlF --include='*.integration.test.ts' "\"$name" apps packages 2>/dev/null | grep -v node_modules)
    fi
  fi
done
mapfile -t integration_files < <(printf '%s\n' "${integration_files[@]}" | grep -v '^$' | sort -u)
db_changed=$(printf '%s\n' "${changed[@]}" | grep -E '^supabase/(migrations|tests)/' | head -1)
if [ "${PRE_GATE_INTEGRATION:-1}" = 0 ]; then
  echo "SKIPPED by PRE_GATE_INTEGRATION=0: ${#integration_files[@]} integration file(s)${db_changed:+ and the pgTAP suite} not run here"
elif [ ${#integration_files[@]} -gt 0 ] || [ -n "$db_changed" ]; then
  echo "${#integration_files[@]} integration file(s)${db_changed:+, and pgTAP for changed database files}"
  if ! timeout 10 docker info >/dev/null 2>&1; then
    bad "integration step needs Docker for the local Supabase (or PRE_GATE_INTEGRATION=0 to skip it here)"
  else
    pnpm exec supabase stop --no-backup >/dev/null 2>&1
    if pnpm exec supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,storage-api,realtime,postgres-meta,supavisor >/dev/null 2>&1; then
      if [ -n "$db_changed" ]; then
        db_out=$(pnpm exec supabase test db 2>&1)
        db_status=$?
        printf '%s\n' "$db_out" | grep -E 'Failed test|not ok|Result' | head -20
        [ "$db_status" -eq 0 ] || bad "pgTAP (exit $db_status)"
      fi
      if [ ${#integration_files[@]} -gt 0 ]; then
        it_out=$(CQ_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
          DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
          NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --config vitest.integration.config.ts "${integration_files[@]}" 2>&1)
        it_status=$?
        printf '%s\n' "$it_out" | grep -E '^ FAIL ' | sort -u
        printf '%s\n' "$it_out" | tail -6
        [ "$it_status" -eq 0 ] || bad "integration tests (exit $it_status)"
      fi
    else
      bad "local Supabase did not start"
    fi
    pnpm exec supabase stop --no-backup >/dev/null 2>&1
  fi
else
  echo "no integration test or database file touches what changed"
fi

echo
if [ $fail -eq 0 ]; then echo "pre-gate PASS sha=$(git rev-parse --short HEAD)"; else echo "pre-gate FAIL sha=$(git rev-parse --short HEAD)"; exit 1; fi
