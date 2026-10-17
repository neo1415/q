# Unicorn Potential UI — 17 October 2026

Recovered the existing remote UI worker commit `6e06f48c4ae0cfaeb4e9e4650a39b75e935673d4`, rather than recreating it. It is preserved as `fa47cf4a9` on `codex/unicorn-ui-completion-oct17`, based on the lead's `32f0f4d7`. The lead's authorization-lifetime hook changes remain intact.

Implemented: optional third CompanyScores assessment, full/compact/minimal variants, twelve progressively disclosed pillars and twenty-four criteria, weights/contributions/coverage, epistemic provenance and revision labels, strengths/gaps, comparable previous-snapshot momentum, provisional methodology and mandatory non-probability caveat. No invented history or cohort benchmarks. No scoring or provider calls during render.

The follow-up uses the canonical CompanyScoresDto and places one full disclosure in the profile Overview main column. The existing fit rail retains Investability and Suitability and links its third summary to that company's Overview assessment. Both consume the same authorized ProfileFit read; no second request. Shared authenticated Discover/Explore/saved/comparison surfaces inherit the third score. Public shared Q Cards do not receive premium scores.

LOCAL TESTED: own contracts/UI build (2 targets), own q-core dependency build (2 targets), and 13 focused component/authorization-lifetime tests across company-scores.test.tsx and unicorn-potential.test.tsx. Changed-file typed ESLint, formatting and diff checks pass. No live provider calls. The recovered worker's older CSS/browser receipts are historical, not fresh production proof.

Pending lead integration gates: integrated web/root types and protected CI; actual premium/free account browser and responsive acceptance after deployment; real evidence/source/history verification. No deployment or entitlement provisioning performed by this UI lane. The profile requires the existing fit endpoint to return READY with scores; do not hide missing backend authorization/coverage behind a client-side bypass. Native Q disclosure registration is tested locally; static Q catalog integration remains the lead's scope.

## Premium Discover refusal recovery

The existing action erased a premium 403 into a generic error, and the feed discarded that reason. The bounded follow-up preserves a typed PREMIUM_REQUIRED response for server 403 plus an explicit Unicorn filter; both existing transports map it to a safe fixed error. The feed shows a premium-access explanation and Clear filters recovery, retaining ordinary server authorization. Raw upstream details are not rendered. Added a browser-component regression for refusal → clear → ordinary recommendations. No billing context or local entitlement bypass.

LOCAL TESTED: existing feed controller 10 tests pass; own contracts/config/api-client dependency build passes. Filter UI suite is pending the lead's integrated dependency graph: isolated run could not resolve q-specialists/cards-request. Stopped the expanded q-specialists graph rather than duplicate the lead's all-package build. No production/browser acceptance claim for this follow-up.

## GateQ premium result surfaces

Implemented against lead `4cbbfdff4` and the server lane's typed contract `76d935899`: investor detail renders a separate current-company Unicorn assessment after the submitted brief; the immutable dossier remains unchanged. Founder applications show only the optional server-authorized field, deduplicated by canonical company. Free/guest payloads show no score. The signed-in public-gateway receipt links to `/gateq?tab=applications`; the anonymous receipt has no account-specific score or results link.

LOCAL TESTED: 52 tests pass across gateq-unicorn-assessment (4), gateq-form (30) and gateq-submitted-brief (18), including eight new assessment/privacy/deduplication/receipt/investor-placement cases. Own contracts build passed (one target). Original-component local Chromium previews at 1440px and 390px show all twelve pillars and the caveat without horizontal overflow. These are clearly labelled synthetic 50/100 fixtures, not canonical data or production acceptance. Screenshots and a receipt are under `/workspace/artifacts/unicorn-gateq-ui/`. No new deployed development route, scoring logic, billing context or provider call.

Pending lead gates: integrated root/web types, protected CI and deployed authenticated investor/premium-founder/free-founder acceptance using the server lane's authorization and canonical-link checks. Server implementation is `1017c2997`; this UI branch consumes its contract and does not independently grant entitlements.
