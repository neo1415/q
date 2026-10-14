# Claude Max continuation — October 14, 2026

This is the continuation index in the established shared handoff, not a new handoff system. Read STATE.md first: its prominent latest section controls exact production and protected-gate status. Older dated entries remain historical evidence. Read AGENTS.md, START-HERE.md, DECISIONS.md, locked PADL, Real Product Specification and Final System Review before material changes.

## Immediate release lane

H2 PR99 is normally merged as production48c6f1e77f15db063c32535423756d017627791e, all four Railway services SUCCESS, production CI38639947138 PASS. Native H2 passed four actual role/device cases. Two real Q-control failures led to source101/candidate102; do not confuse native acceptance with full H2/Q acceptance. Current exact heads and release/replay results belong in STATE.md and HUB-H2-LIVE-ACCEPTANCE-2026-10-14.md.

Integration branch build/int-rc; deployment branch recovery/2026-09-12. Normal protected PR merge only. A deployment is verified only after direct service revision reads and actual authorized browser acceptance. No H2 migration. Production48c6 is the rollback retaining native H2 for the Q correction. Productiondcb2b107e5d6eba914dd1eb90e34e0245ff8538d precedes H2. Do not push a failing sibling into the release branch.

## Reproduce actual H2 acceptance

The tracked script in101/102 is scripts/handoff/live/relationship-hub-h2-acceptance.mjs. It uses existing canonical authorized relationships and only internal Q turns/device views, without seeding relationships, sending messages or approving actions. Full four-case native proof is /tmp/cq-hub-h2-live-5LqSPR/outcomes.json (private, not portable Git evidence). Invalid-org403, stale-filter400, foreign-record404 are verified. Real cross-actor foreign-record CSV rejection and same-browser account view isolation were separately verified; see the H2 evidence document.

```bash
CQ_BROWSER_PROXY_CA_FILE=/usr/local/share/ca-certificates/environment-proxy-ca.crt \
NODE_OPTIONS=--import=./scripts/handoff/live/browser-proxy-pin.mjs \
CQ_H2_FIXTURES_FILE=/workspace/cq-secrets/h2-browser-fixtures.json \
CQ_HUB_PUBLIC_KEY_FILE=/workspace/cq-secrets/public.key \
CQ_HUB_VERIFY_Q=1 NODE_USE_ENV_PROXY=1 \
node /workspace/cq-secrets/h2-full-exact-record-rehearsal.mjs
```

Run from /workspace/q on the actual released code. The private helper adds exact expected native relationship pathname assertions to the tracked driver; no steps are simulated. Private helpers, fixtures, sessions, CSVs and screenshots are intentionally not committed; reuse existing authorized credential bindings or recreate authorized fixtures without inventing accounts. Require actual DONE receipts and completed owned Q runs, changed server-backed controls, exact native record and Hub return. CQ_HUB_DEVICE=desktop is optional for focused replay, not a substitute for the four-case core.

## Next independent work

1. Investor Q PR98: existing branch codex/gateq-investor-q-context starts8027487a1bfedc0048f1657a3d3feaa8d3d823a7. Its CI38619760987 failed capability-harness SCRIPTED_INPUTS for gateq_inbox_summarise; static/build/types/pgTAP passed. Isolated pr98_ci_fix owns only packages/q-tools/test/capability-harness.test.ts. The schema has optional company/applicationId plus exactly-one refinement; supply an explicit valid deterministic input, never weaken the schema or disable the harness. Fresh31 dependency builds reproduced1failed/1211passed. Corrected run and pushed head must be recorded in STATE. After protected gates, reconcile newer production in a distinct candidate and prove substantive selected-dossier, source-grounded answers through actual investor browser. A green fixture test alone is not investor-Q completion.
2. GateQ Evidence PR97 now364d286e6b3826462ae555cf5a0d24860312d4c7: new protected CI38648329522 running. Old38619511769 pgTAP step PASSED; subsequent real-repository concurrency proof failed. Disposable bootstrap missed canonical231600 lineage columns required by PR97 writes. Actual PostgreSQL17.11 baseline8causes SQLSTATE42703 application_turns.disclosure_lineage; fixture-only3-line include correction passed unchanged3rounds×8concurrentclaims, retries, rollback, MVCC and submissionlock. Existing PR branch fast-forwarded safely; separate codex/gateq-pr97-concurrency-fixture-oct14 preserves fix. Own package tsc/diff pass; .psql has no Prettier parser. No runtime/migration change, hosted migration or release. Private evidence /tmp/cq-pr97-fixture-repair-report.md. Complete secure guest upload, extraction, explicit disclosure, version/source lineage and authorized investor access in existing Evidence system after full protected gate/migration review; do not call fixture repair complete Evidence.
3. CRM H3/H4: connect existing GateQ, meetings, transcripts, canonical documents, diligence, Q Work and approvals into existing relationship record. Reuse services, permissions and native UI. Do not duplicate those systems or adopt rejected prototype75 CSS.
4. Server-backed views: codex/hub-h2-scoped-views / b4a2a68e553b11f8c366aa5d45289f2e542817b2 is recoverable WIP, not fresh-green. Original50/52tests passed, two fixture failures/root types failed. Migration241100 is UNAPPLIED. Reconcile with now-shipped H2 device views; preserve personal/team scope and authorization before rollout.
5. Q Pitch/performance: read docs/specs/q-pitch/Q_PITCH_MASTER_BLUEPRINT.md first. Do not start another demo architecture. Known-company navigation and measured first-useful-text/audio remain evidence-based performance work; no new p50/p95 or first-audio certification this release.

## Preserve these branches; do not merge duplicates wholesale

- Original interrupted investor-Q alternative codex/q-gateq-selected-dossier / ef515bc6; later98 is a separate source implementation.
- Original interrupted H2 alternative codex/hub-h2-canonical-repair-oct14 / 2fc703cc; later96 is canonical and already integrated c189985022691362114723bff4ea850f1e29ca10.
- Source95 codex/gateq-hub-continuation-post1755 / 48724480 preserves real selected-dossier baseline driver; initial17.723s unavailable answer is failure, not success. Validate substantive source terms, not merely dossier identity.
- Product inventory aed12b0c is untested/stale snapshot, never truth for feature claims. Research86/88 source6aae4378/candidatec8374d6b are historically green but unreleased and require current production reconciliation.
- Guest codex/gateq-guest-upload-expiry /553316c5 and recoveryb35813de remain distinct. Proposed231200/231300/231400 require ordering/RLS review, never blanket-apply.
- Other GateQ, diligence, documents, graph-memory, voice/Tavus worktrees remain recoverable. Inspect git worktree list and each status before modifying. October14 continuation audit found38 worktrees; only design-review untracked node_modules, no uncommitted product source at that check. Do not commit generated dependencies.

## Product and environment boundaries

H2 views are device-local; synchronized personal/team views are not shipped. Pipeline source scan bounded1000; CSV slice only. No full CRM/H3/H4, PDF/XLSX, voice, Tavus audiovisual or complete GateQ guest Evidence claim. Existing fixtures each have one organization; positive multi-membership switching unrun. Do not rebuild GPT-Live, Q memory/context firewall/fast navigation, intelligent cards, workforce or document platform. READY document proof exists historically; PREPARING must never be called complete.

Node24.19, pnpm11.25 pinned. Existing pnpm bootstrap tries unwritable /home/agent; use existing local TypeScript through dependency-ordered graph when necessary, not dependency edits. All53 package builds passed in H2. Root/web/q-api strict types and affected tests passed; exact protected runs supersede local proof. Disk around520MB free; local Next generated output removed, so local dev server needs rebuild/restart. Do not delete private receipts/source or expand TLS trust. Browser uses process-scoped exact proxy CA pin, ignoreHTTPSErrors:false. Persistent trust mutation was automatically rejected earlier; no TLS bypass used.

Secrets are private credential names only in /workspace/cq-secrets (700/600): railway.token, supabase.token, public.key, trial-session-0.json founder COMPANY owner, workforce-session.json active investor FIRM owner, investor-session.json different FIRM. trial-session-1.json is FIRM, not a founder. Never dump their values or commit private test artifacts. No new account action established. Tavus is deferred in current sequencing; no paid minutes used here.

Maintain STATE.md, ACTIVE-TASKS.md, HANDOFF-LOG.md and relevant evidence in each significant engineering cycle. Commit and push small meaningful changes. Keep implementation, CI, merge, deploy and real product proof distinct.
