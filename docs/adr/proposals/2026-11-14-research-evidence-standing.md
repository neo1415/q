# Proposal (not applied): the standing of third-party research evidence

**Status:** Proposed for owner approval, 14 Nov 2026. Nothing in this file is in force.
**Amends, if approved:** ADR-001 (evidence axes) and ADR 0009 §6 and §8.
**Prompted by:** decisions 92–95 and the owner addendum of 14 Nov 2026 on resolving investor uncertainty.

## The gap

Decision 92 keeps four things distinct:

1. a source reporting a claim;
2. other sources corroborating or contradicting it;
3. the founder confirming it;
4. an independently verified fact.

ADR-001's axes express (4) (`EXTERNALLY_VERIFIED`, `PLATFORM_VERIFIED`) and the founder's own claim (`USER_CLAIM` / `SELF_REPORTED`). They do not cleanly express (1)–(3):

- **(1) A third party's report.** `evidence_status` has no value for "reported by someone other than the subject".
  - `NO_EVIDENCE` is what ADR 0009 §8 gives the model for such a page.
  - But the evidence-item rule refuses `NO_EVIDENCE` on an item ("an evidence item is evidence").
  - So research excerpts and readings are stored as `SELF_REPORTED`, with reliability `SECONDARY_EXTERNAL`. Read alone, `SELF_REPORTED` suggests the company said it.
- **(2) Corroboration.** `MULTI_SOURCE_SUPPORTED` exists, and deep research's cross-check already uses it. But it is defined for claims, not for a link between two reports. There is also no item-to-item relation table.
- **(3) Founder adoption of an external figure.** A `USER_CLAIM` / `SELF_REPORTED` claim cannot say "first reported by X". Without extra provenance, it looks the same as a figure the founder stated unprompted.

## What the code does now (within existing semantics; no class redefined)

| Distinction                     | Representation                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A report                        | A `public_web.reading` evidence item under the page's `PUBLIC_WEB` source: item `SELF_REPORTED` (forced by the item rule), reliability `SECONDARY_EXTERNAL`, and in `structuredValue.reading`: `truthClass: UNKNOWN`, `evidenceStatus: NO_EVIDENCE` (or `SELF_REPORTED` for the company's own site), `reportedBy: THIRD_PARTY \| COMPANY_OWN_SITE`, quote, URL, title, dates, content hash and a stable `readingId`. |
| Corroboration and contradiction | Derived in code at read time (`linkResearchReadings`), between independent publishers only, always with `independentVerification: false`. Not persisted. Never changes any reading's axes.                                                                                                                                                                                                                           |
| Founder adoption                | `USER_CLAIM` / `SELF_REPORTED` claim (the founder's), sourced to the page. Its new evidence item carries `reportedBy`, `confirmedBy: FOUNDER`, `confirmedByUserId` and `readingItemId`. The kept reading is also linked `SUPPORTS`. The statement says "first reported by … then confirmed by the founder".                                                                                                          |
| Independently verified          | Unchanged.                                                                                                                                                                                                                                                                                                                                                                                                           |

## Proposed amendment (smallest)

1. **A provenance attribute, not a new truth class.** Add `origin` to evidence items: `SUBJECT_STATEMENT | THIRD_PARTY_REPORT | DOCUMENT | PLATFORM`.
   - Additive nullable column, backfilled from reliability class and source type. Requires a migration.
   - Research items become `origin = THIRD_PARTY_REPORT`.
   - `SELF_REPORTED` then means what it says: the subject's own statement.
2. **Allow `NO_EVIDENCE` on an item only when `origin = THIRD_PARTY_REPORT`**, or add a dedicated evidence status `THIRD_PARTY_REPORTED`. The owner chooses one.
3. **Item-to-item relations.** An `evidence.item_relations` table (`CORROBORATES | CONTRADICTS`, publisher-independence key, computed-by version), so corroboration is addressable and trackable for re-assessment (addendum step 6). It is never an evidence status.
4. **Adoption provenance on claims.** Add `adopted_from_item_id` (nullable) to claims, so "founder confirmed a third-party figure" is a first-class standing (the audit's FOUNDER_CONFIRMED).
5. **ADR 0009 §6.** Allow readings of genuinely public pages to be kept for any asker in a tenant-neutral, content-hash-keyed store (public text only; no record of who asked). This would replace the in-process cache that investors use today.

Until approved: no migration is written or applied, and no existing class changes meaning.
