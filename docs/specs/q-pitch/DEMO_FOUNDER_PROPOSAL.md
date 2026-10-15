# Capital Q as a demo founder — PROPOSED (owner + integration owner decision)

Directive 2026-10-15 §E. Status: **proposal only.** No account, company, seed or migration has been created.

## 1. What exists today (fixture review, 15 Oct)

- **Fictional world:** `apps/q-api/src/dev/fictional-world/` seeds 12 companies through the product's own HTTP paths (Ledgerfold, Tarmacly, Yamfield Agro, Clinicrest, Marketlight Grids, Tallyloom, Ajopot, Maji Loop, Nsuo Labs, Brightkloof Energy, Souqsheet, Kazikit).
  - Accounts carry `app_metadata.fictional_demo` and the `@fictional.capitalq.local` domain.
  - A hosted target requires `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF` (QP-F03).
- **Isolation gaps (QP-F03):**
  - The certified scenes ran in the **production** project.
  - There is no separate showcase environment.
  - There is no "Demonstration data" banner beyond the page-foot "(fictional)" note.
  - Real-mailbox demo founders exist (`20261222120000_demo_rehearsal_access.sql`) and must never be tour actors.
- **New finding — `F2`:** the comparison fixture in `CERTIFICATION_MANIFEST.md` ("Ledgerfold vs F2") is **not** a fictional-world company. Its classification must be checked before any audience run. If it is a real-mailbox demo account, the comparison scene needs a fictional second company and re-certification.

## 2. Proposal

| Item         | Proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment  | Showcase only: a deployment of the released commit against the attested synthetic project. Seeded with the existing fictional-world CLI (`pnpm seed:fictional --hosted`). **Never production.**                                                                                                                                                                                                                                                             |
| Company      | One canonical company, "Capital Q (demonstration)". Its legal name is suffixed "(fictional)" like every seeded company.                                                                                                                                                                                                                                                                                                                                     |
| Founder      | `founder.capitalq-demo@fictional.capitalq.local`, with `fictional_demo` metadata and one founder membership through the existing Auth/RLS. No privileged role, no cross-tenant read.                                                                                                                                                                                                                                                                        |
| Profile data | Product description only, from `CAPITAL_Q_KNOWLEDGE_PACK` (`packages/q-pitch/src/knowledge-pack.ts`): PADL- and spec-cited statements as `USER_CLAIM` / `DOCUMENT_SUPPORTED`. **No traction, revenue, customers, funding, valuation, team size or market size.** Each of those is an explicit `UNKNOWN` until the owner supplies approved material. The seed claims use `truthClass: "UNKNOWN"`, which the fictional-world `ClaimSeed` type already allows. |
| Q answers    | Home Q answers about Capital Q through the governed retrieval path, from the pack written via the knowledge Write Gate. Unknowns are answered as unknown, with a human follow-up. The pack is not prompt-stuffed and is never cached across a role switch.                                                                                                                                                                                                  |
| Refresh      | The pack's `version` / `refreshedAt` is bumped when the product sources or the certification manifest change, or when owner material arrives.                                                                                                                                                                                                                                                                                                               |

## 3. Decisions needed

1. Approve a showcase environment (or an ADR for fictional tenants in production, which QP-F03 recommends against).
2. Approve the company, the founder identity and the pack wording (`status: PROPOSED`).
3. Supply any approved business material, or confirm that all business entries stay `UNKNOWN`.
4. Integration owner: the seed addition in `apps/q-api/src/dev/fictional-world/companies.ts` (not Lane P's file) and the Write Gate path for the pack (Lane S).
