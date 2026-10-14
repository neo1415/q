# Relationship Hub H2 — live acceptance evidence

Status: native core verified; Q corrections awaiting gated release and replay. This is an evidence record in the existing handoff, not a declaration that the whole CRM is complete. STATE.md contains the latest release and CI heads.

## Released core

PR99 candidate `efd2b4d9d4b6447a1108067ca4e09fc9521237f1`: protected CI38617987342 PASS. Production merge `48c6f1e77f15db063c32535423756d017627791e`: CI38639947138 PASS; web, API, q-api and workers SUCCESS.

Existing authenticated accounts and canonical relationships were used. No accounts, relationships or business events were seeded or created by this acceptance.

| Role     | Viewport | Existing records | Core browser checks |    Selected CSV |   Filtered CSV |
| -------- | -------- | ---------------: | ------------------- | --------------: | -------------: |
| Founder  | 1440×960 |                2 | PASS                | 2 exact records | 1 exact record |
| Founder  | 390×844  |                2 | PASS                | 2 exact records | 1 exact record |
| Investor | 1440×960 |                9 | PASS                | 2 exact records | 1 exact record |
| Investor | 390×844  |                9 | PASS                | 2 exact records | 1 exact record |

Every row covers role heading, native Pipeline entry, table/board, search, sort/state filter, cursor pagination, cross-page same-scope selection, saved-view create/reload/restore/delete, preview, native relationship page/back and absence of document-wide horizontal overflow. The actual native download bytes match the independently authorized selected-export response for all four cases. Screenshots for founder mobile and investor desktop board were visually inspected.

Private complete receipts: `/tmp/cq-hub-h2-live-5LqSPR/outcomes.json`; CSVs and screenshots beside it. These artifacts contain private data and are not committed.

## Authorization and persistence

- Invalid organization context:403 for both roles.
- Stale filter/export scope:400.
- Selected inaccessible/nonexistent ID:404.
- Stronger proof: a real relationship authorized to the other existing account, absent from the current actor's exhaustive small result set, returns404 through authenticated browser export for BOTH roles. Private helper/result: `/workspace/cq-secrets/h2-real-foreign-export-proof.mjs` and `.json`.
- Same-browser authentication-context changes: founder view hidden from investor; investor view hidden from founder; founder view restored on return. This tests actual authenticated account boundaries, not a native multi-organization switcher. Private helper/result: `/workspace/cq-secrets/h2-account-view-isolation.mjs` and `h2-account-view-isolation-proof.json`.
- The isolation probe initially attempted Save before client controls registered and timed out; waiting for the real registered `list.pipeline` control made the complete test pass. No product fix is claimed from that readiness change. Cold pre-hydration interaction latency is not certified.

## Q: failures retained until real replay

- Founder Hub opening, Pipeline selection and Board selection produced actual DONE receipts.
- A separate founder record-open/Hub-return slice passed; its OPEN_RECORD_PAGE id matched the requested canonical record. It was not a complete Q pipeline pass.
- “Sort this pipeline by name A–Z” returned Understood without sorting on production48c6. Private failure `/tmp/cq-hub-h2-live-986DwZ`.
- Investor “Open the first relationship in this pipeline” returned generic NAVIGATE RELATIONSHIPS and opened the overview. Private failure `/tmp/cq-hub-h2-live-WlF6fL`; owned run saved privately as `h2-investor-record-failed-run.json`.
- The page-name parser already declined this ordinal. Missing deterministic binding allowed model fallback. Source101 binds explicit pipeline ordinals to native list links, and closed sort/search/state commands to existing semantic filters. Search text is bounded and valid only on its exact read-only filter. Candidate102 preserves production and excludes sibling98/97.
- Native-option visibility, hidden streamed Next copies and nested receipt.status caused separate harness failures. Correcting those assertions is not product capability proof.

Final acceptance must use the released Q correction, actual registered-control DONE receipts, completed owned Q runs, changed server-backed sort/search/state, exact native relationship opening and return. The source driver is `scripts/handoff/live/relationship-hub-h2-acceptance.mjs` in source101/candidate102. Optional CQ_HUB_VERIFY_Q=1 creates only internal Q turns; no outward actions or approvals. The private full replay helper additionally asserts the exact expected native record pathname; no Q steps are simulated.

## Current limits

Personal views are stored on the current device; synchronized personal/team views remain a separate unreleased branch. Pipeline source scan is bounded at1000. This slice exports CSV; full H3/H4, PDF/XLSX reporting, voice/Tavus and entire CRM completion are not certified. Current fixtures each have one organization; positive multi-membership switching is unrun.
