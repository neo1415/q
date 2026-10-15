# Capital Q as a demo founder — PROPOSED (owner + integration owner decision)

Directive 2026-10-15 §E; lead request 15 Oct. Status: **proposal with an exact seed plan, for the lead to decide.** No account, company, seed or migration has been created.

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

| Item         | Proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment  | Showcase only: a deployment of the released commit against the attested synthetic project. Seeded with the existing fictional-world CLI (`pnpm seed:fictional --hosted`). **Never production.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Company      | One canonical company, "Capital Q (demonstration)". Its legal name is suffixed "(demonstration)". Visibility is `organisation_private` (the only alternative the contract offers is `network_visible`; there is **no per-investor company share** in `SetCompanyVisibilityRequestSchema`). So it is never in Discover, a slate or search. Investor-side questions about Capital Q are answered from the knowledge pack (product knowledge), not from this company record. The record serves the founder-side demo. **Option B (lead decides):** `network_visible` **only in the showcase environment**, where every investor is fictional; never in production. |
| Founder      | `founder.capitalq-demo@fictional.capitalq.local`, with `fictional_demo` metadata and one founder membership through the existing Auth/RLS. No privileged role, no cross-tenant read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Profile data | Product description only, from `CAPITAL_Q_KNOWLEDGE_PACK` (`packages/q-pitch/src/knowledge-pack.ts`): PADL- and spec-cited statements as `USER_CLAIM` / `DOCUMENT_SUPPORTED`. **No traction, revenue, customers, funding, valuation, team size or market size.** Each of those is an explicit `UNKNOWN` until the owner supplies approved material. The seed claims use `truthClass: "UNKNOWN"`, which the fictional-world `ClaimSeed` type already allows.                                                                                                                                                                                                     |
| Q answers    | Home Q answers about Capital Q through the governed retrieval path, from the pack written via the knowledge Write Gate. Unknowns are answered as unknown, with a human follow-up. The pack is not prompt-stuffed and is never cached across a role switch.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Refresh      | The pack's `version` / `refreshedAt` is bumped when the product sources or the certification manifest change, or when owner material arrives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 3. Exact seed plan (showcase only)

Today's seed cannot represent Capital Q truthfully. `FictionalCompany` (`apps/q-api/src/dev/fictional-world/types.ts:46`) requires a numeric `team.teamSize` and `founderCount`, a `raise.target` money amount, and a `countryOption` from `ng | ke | gh | za | eg`. The seed also always publishes companies as `network_visible` (`accounts.ts:580-585`). Seeding Capital Q as-is would invent a team size, a raise and a country, and would put the company in Discover. The plan changes that, in five steps.

1. **Types (`types.ts`):** add `readonly showcaseOnly?: true`. When it is set, `team`, `raise`, `customers`, `pilots`, `revenueStatus` and `growth` become optional (absent means unknown). `countryOption` gets no new value; it stays unset.
2. **Seeder (`accounts.ts`):** for `showcaseOnly`:
   - skip the `network_visible` publish, so the company keeps `organisation_private` (Option B instead publishes it, showcase only);
   - skip the team `PUT` and the raise answers when they are absent.
3. **Data (new `showcase.ts`, not `companies.ts`):** add `SHOWCASE_COMPANIES = [capitalQDemo]`. `key: "capital-q-demo"`, `name: "Capital Q (demonstration)"`, founder `founder.capitalq-demo@fictional.capitalq.local` (display name "Capital Q demo founder", headline "Demonstration account").
   - `shortDescription` / `story.problem` / `story.solution`: text from pack entries `kp.category`, `kp.purpose`, `kp.asymmetry`.
   - `story.traction`, `team`, `market`, `competition` and `raise`: each is "Not provided by the owner (unknown)".
   - `story.unknowns`: the eight `kp.unknown.*` statements.
   - `claims`: the 8 spec-cited statements as `USER_CLAIM` / `DOCUMENT_SUPPORTED`, with `documentTitle` set to the source path and section, plus `UNKNOWN` / `NO_EVIDENCE` claims for revenue, customers, funding, pricing, unit economics, market size, team and time saved.
   - `deck: []`. No numbers anywhere: the pack's schema test is reused on the seed data.
4. **CLI (`seed.ts`):** add the `--showcase` flag. `SHOWCASE_COMPANIES` is seeded **only** with both `--hosted` and `--showcase`, and only when the existing `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF` attestation matches. It is refused on loopback, and refused on any project without the attestation. It is idempotent on `key`, like the other companies.
5. **Tests (q-api, deterministic):**
   - the showcase company is never `network_visible` after seeding;
   - under Option A, every investor gets a 404 on the profile;
   - it never appears in a Discover slate;
   - its seed data has no digits outside the dates;
   - `--showcase` without `--hosted` is refused.

**Not changed:** migrations (none needed), RLS, permissions and production seeds. The company is a normal canonical company, with one founder membership through the existing Auth paths.

**Ownership:** Lane P can write steps 1–5 on a branch, if the lead assigns the fictional-world files (owned by q-api / integration) for one cycle.

## 4. Decisions needed

1. Approve a showcase environment (or an ADR for fictional tenants in production, which QP-F03 recommends against).
2. Approve the company, the founder identity and the pack wording (`status: PROPOSED`).
3. Supply any approved business material, or confirm that all business entries stay `UNKNOWN`.
4. Integration owner: the seed addition in `apps/q-api/src/dev/fictional-world/companies.ts` (not Lane P's file) and the Write Gate path for the pack (Lane S).
