# Q Pitch — feature certification manifest

Referenced from the [master blueprint](Q_PITCH_MASTER_BLUEPRINT.md) §8–§9.

Every demonstration claim must map to an entry here that names three things:

- the authorised data it is shown on;
- the working code at a named revision;
- the verified behaviour, with a receipt.

No entry means no claim. An expired entry (`validUntil` passed, or the revision changed in the relevant area) must be re-verified before it is shown.

This file records the human-readable ledger. The machine-readable per-scene `SceneEvidence` records (blueprint §9) are introduced by QP-F05 and must stay consistent with it.

## Entry format

| Field                         | Meaning                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `featureId`                   | Atlas feature ID                                                                           |
| `status`                      | `PRODUCTION_LIVE_VERIFIED`, `CODE_VERIFIED`, `PARTIAL`, `NOT_IMPLEMENTED` or `CONCEPT`     |
| `actorContext`                | Authorised demo identity and role (never a real person's account)                          |
| `fixture`                     | Data the behaviour was verified on, with its classification                                |
| `appCommit`                   | Revision verified                                                                          |
| `verifiedAt` / `verifierType` | UTC time; `CODE`, `CI`, `BROWSER` or `HUMAN`                                               |
| `receipt`                     | Where the evidence is. Private receipts are referenced by path; never commit their content |
| `claimsAllowed`               | Exactly what may be said                                                                   |
| `claimsForbidden`             | What must not be said                                                                      |
| `validUntil`                  | Re-certification due                                                                       |

## Entries

### INV-DISCOVER-TOP3 — mandate-fit top three as cards

| Field                         | Value                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                      | PRODUCTION_LIVE_VERIFIED                                                                                                                                        |
| `actorContext`                | Fictional investor `investor.savanna-seed@fictional.capitalq.local` (Savanna Seed Partners)                                                                     |
| `fixture`                     | Existing fictional seeded companies (Ledgerfold, F2, Ledgerline)                                                                                                |
| `appCommit`                   | web `5ce3d76b`; q-api `c2f08536` (same server code)                                                                                                             |
| `verifiedAt` / `verifierType` | 2026-10-13 ~16:50 UTC; BROWSER (`scripts/handoff/live/investor-demo-rehearsal.mjs`)                                                                             |
| `receipt`                     | private `/tmp/cq-investor-demo-HZt53D` (not committed)                                                                                                          |
| `claimsAllowed`               | Q ranks the investor's top three by mandate fit and shows exactly those three canonical companies as cards (single run: text 3.0 s, cards 3.1 s, settled 3.4 s) |
| `claimsForbidden`             | "Instant"; fit = quality; any p95 claim                                                                                                                         |
| `validUntil`                  | Next change to the model-gateway fit path or answer-canvas                                                                                                      |

### INV-PROFILE-FINDINGS — selected-company analysis with native findings

| Field                                                                    | Value                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                 | PRODUCTION_LIVE_VERIFIED                                                                                                                                               |
| `actorContext` / `appCommit` / `verifiedAt` / `verifierType` / `receipt` | as INV-DISCOVER-TOP3                                                                                                                                                   |
| `fixture`                                                                | Ledgerfold                                                                                                                                                             |
| `claimsAllowed`                                                          | Q answers about the selected company with evidence-labelled findings and a reference to exactly that company (7 findings; single run 5.5 s first text, 14.2 s settled) |
| `claimsForbidden`                                                        | "Verified" for founder-stated facts; any fixed latency claim                                                                                                           |
| `validUntil`                                                             | Next change to the analyst prompt/schema or result blocks                                                                                                              |

### INV-RISKS-FOLLOWUP — risks follow-up on the same company

| Field                                                                    | Value                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `status`                                                                 | PRODUCTION_LIVE_VERIFIED                                                                                                       |
| `actorContext` / `appCommit` / `verifiedAt` / `verifierType` / `receipt` | as INV-DISCOVER-TOP3                                                                                                           |
| `fixture`                                                                | Ledgerfold                                                                                                                     |
| `claimsAllowed`                                                          | Q gives a sourced risk view with findings and stated uncertainty, still bound to the same company (8 findings; 4.8 s / 13.9 s) |
| `claimsForbidden`                                                        | Diligence completeness                                                                                                         |
| `validUntil`                                                             | As INV-PROFILE-FINDINGS                                                                                                        |

### INV-COMPARE-TABLE — two-company side-by-side comparison

| Field                                                                    | Value                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                 | PRODUCTION_LIVE_VERIFIED                                                                                                                                                                                |
| `actorContext` / `appCommit` / `verifiedAt` / `verifierType` / `receipt` | as INV-DISCOVER-TOP3                                                                                                                                                                                    |
| `fixture`                                                                | Ledgerfold vs F2                                                                                                                                                                                        |
| `claimsAllowed`                                                          | Q compares exactly the two named canonical companies against the mandate in one table; a measure a company lacks shows "Not recorded", never a low level (single run 14.2 s first text, 30.8 s settled) |
| `claimsForbidden`                                                        | Fast comparison; ranking as quality                                                                                                                                                                     |
| `validUntil`                                                             | Next change to the comparison card builders or answer-canvas                                                                                                                                            |

Every other atlas feature currently has no certification entry and must not be presented as live.
