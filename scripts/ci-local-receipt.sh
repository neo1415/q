#!/usr/bin/env bash
# Exit 0 only when scripts/ci-local.sh wrote a full PASS receipt for exactly
# this commit (decision 88). Used by scripts/deploy-promote.sh and by the
# pre-push hook in .githooks, so production never gets an ungated commit.
#   bash scripts/ci-local-receipt.sh <commit>
set -uo pipefail
full="$(git rev-parse --verify "${1:?commit}^{commit}" 2>/dev/null)" ||
  { echo "receipt: unknown commit $1" >&2; exit 1; }
file="${CI_LOCAL_OUT:-/tmp/ci-local}/receipts/$full"
read -r verdict sha at 2>/dev/null <"$file" ||
  { echo "receipt: none for $full (run: CI_LOCAL_REF=$full bash scripts/ci-local.sh)" >&2; exit 1; }
if [ "$verdict" != PASS ] || [ "$sha" != "$full" ]; then
  echo "receipt: $file is not a PASS for $full" >&2
  exit 1
fi
echo "receipt: PASS $full at $at"
