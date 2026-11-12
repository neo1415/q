#!/usr/bin/env bash
# Promote one commit to production (decision 88): the only way to push
# recovery/2026-09-12, which Railway deploys. Refuses unless
#   - scripts/ci-local.sh wrote a full PASS receipt for this exact SHA,
#   - the commit is on the integration branch, and
#   - production fast-forwards to it (no force-push, ever).
# Prints the commit it replaces: roll back by redeploying that build on
# Railway (scripts/handoff/live/railway/redeploy.mjs) or a gated revert.
#   bash scripts/deploy-promote.sh <commit>
set -uo pipefail
cd "$(dirname "$0")/.."
prod=recovery/2026-09-12
integration="${CQ_INTEGRATION_BRANCH:-fix/resume-asking-cv9ru3}"
full="$(git rev-parse --verify "${1:?commit to deploy}^{commit}")" || exit 1
bash scripts/ci-local-receipt.sh "$full" || exit 1
git fetch -q origin "$integration" "$prod" || { echo "promote: fetch failed" >&2; exit 1; }
git merge-base --is-ancestor "$full" "origin/$integration" ||
  { echo "promote: $full is not on origin/$integration" >&2; exit 1; }
before="$(git rev-parse "origin/$prod")"
if [ "$before" = "$full" ]; then echo "promote: $prod is already $full"; exit 0; fi
git merge-base --is-ancestor "$before" "$full" ||
  { echo "promote: $prod ($before) does not fast-forward to $full" >&2; exit 1; }
echo "promote: $prod $before -> $full (rollback point: $before)"
CQ_PROMOTE_CHECKED="$full" git push origin "$full:refs/heads/$prod" || exit 1
after="$(git ls-remote origin "refs/heads/$prod" | cut -f1)"
[ "$after" = "$full" ] || { echo "promote: remote $prod is $after, expected $full" >&2; exit 1; }
echo "promote: remote $prod = $full"
