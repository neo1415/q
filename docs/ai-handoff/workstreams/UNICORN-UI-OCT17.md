# Unicorn Potential UI — 17 October 2026

Recovered the existing remote UI worker commit `6e06f48c4ae0cfaeb4e9e4650a39b75e935673d4`, rather than recreating it. It is preserved as `fa47cf4a9` on `codex/unicorn-ui-completion-oct17`, based on the lead's `32f0f4d7`. The lead's authorization-lifetime hook changes remain intact.

Implemented: optional third CompanyScores assessment, full/compact/minimal variants, twelve progressively disclosed pillars and twenty-four criteria, weights/contributions/coverage, epistemic provenance and revision labels, strengths/gaps, comparable previous-snapshot momentum, provisional methodology and mandatory non-probability caveat. No invented history or cohort benchmarks. No scoring or provider calls during render.

The follow-up uses the canonical CompanyScoresDto and places one full disclosure in the profile Overview main column. The existing fit rail retains Investability and Suitability and links its third summary to that company's Overview assessment. Both consume the same authorized ProfileFit read; no second request. Shared authenticated Discover/Explore/saved/comparison surfaces inherit the third score. Public shared Q Cards do not receive premium scores.

LOCAL TESTED: own contracts/UI build (2 targets), own q-core dependency build (2 targets), and 13 focused component/authorization-lifetime tests across company-scores.test.tsx and unicorn-potential.test.tsx. Changed-file typed ESLint, formatting and diff checks pass. No live provider calls. The recovered worker's older CSS/browser receipts are historical, not fresh production proof.

Pending lead integration gates: integrated web/root types and protected CI; actual premium/free account browser and responsive acceptance after deployment; real evidence/source/history verification. No deployment or entitlement provisioning performed by this UI lane. The profile requires the existing fit endpoint to return READY with scores; do not hide missing backend authorization/coverage behind a client-side bypass. Native Q disclosure registration is tested locally; static Q catalog integration remains the lead's scope.
