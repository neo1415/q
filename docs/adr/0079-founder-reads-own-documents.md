# ADR 0079: The founder's own Q reads their own company's highly confidential documents

- Status: **Accepted.** The owner decided this on 2026-11-16 (`docs/ai-handoff/DECISIONS.md` decision 100) and is the authority to amend it. The lead may renumber this ADR.
- Builds on: [ADR 0078](0078-shared-means-readable.md) ("shared means readable"). It uses the same provider handling and the same read path.
- Supersedes:
  - the Stress 2026-10-28 rule (F02/F03, S02-F; `heldBackFromQ`) that held a company's HIGHLY_CONFIDENTIAL documents back from its own founder's Q, so that only Capital Q's code, never a model, read their figures and offered them for confirmation. That rule now applies only to RESTRICTED material.
  - ADR 0078 §5's bullet "The founder's own Q is unchanged", and only that bullet.
- Unchanged:
  - the evidence classification (MANAGEMENT_ACCOUNTS, FINANCIAL and FINANCIAL_MODEL default to HIGHLY_CONFIDENTIAL);
  - RLS, the data-room levels and grants, and the investor path, which stays ADR 0078's grants only;
  - the Context Firewall plans, Q Knowledge and retrieval scopes, and network-visible claims;
  - ranking, discovery and recommendation features;
  - the provider ceilings.

## Why a new ADR rather than amending 0078

ADR 0078 grants access through a disclosure the founder made to one investor. Decision 100 grants access through membership of the company that owns the document, which is a different authority with a different check. Recording it separately keeps each rule's basis, enforcement and tests easy to audit. ADR 0078 now points here.

## Decision

1. **Who.** Q may read the text and pages of a HIGHLY_CONFIDENTIAL document (management accounts, a financial model, a bank statement, other FINANCIAL material) in a turn, or a background job, of a person who meets two conditions:
   - **The data room treats them as the owner.** The document's company belongs to the organisation in their access context, and the authorisation service allows `disclosure.manage` for them (`DataRoomService` `readerOf`).
   - **Their membership is current.** At the read itself, they hold an active membership of that organisation, in their tenant, matched on membership id and user id (`createOwnCompanyMembership`).

   Both conditions are resolved on the server from the access context. No client- or model-supplied id is trusted.

2. **Never.**
   - **Other companies.** The data room lists another company's documents to them as an investor, never as the owner.
   - **Investors.** Their path is ADR 0078's grant only, and an investor view never asks the membership lookup.
   - **RESTRICTED material.** Identity artefacts are never unlocked.
   - **Ranking, discovery, retrieval, Q Knowledge or shared memory, for anyone.** Document chunks stay `organisation_private`, and the read tools are READ_ONLY.
3. **Re-checked at every read.** The membership is resolved when the document is listed, and again inside the text or page read, before any text leaves the database read. Nothing is cached. If the membership ends, the document closes on the next read.
4. **Provenance.** An own-company read carries `ownCompanyRead: { companyId, membershipId }` in the tool result (and in the data-room facts of a chat turn), so the run's recorded tool output names the membership it was read under. In a founder's analysis job, the document is listed in the artifact's sources as `data_room_document`.
5. **Evidence axes.** What Q reads is still the company's own management material:
   - truth class USER_CLAIM, evidence status DOCUMENT_SUPPORTED at most, never EXTERNALLY_VERIFIED;
   - Q says "your management accounts show…" and does not call the figures verified;
   - it sets them beside the deck and the founder's stated figures, keeping both sides of any difference.
6. **Sensitivity on the way to the model.** Handling is the same as ADR 0078 §6. The read is carried into the turn at CONFIDENTIAL, so it reaches only a provider whose justified ceiling is CONFIDENTIAL: zero retention asserted, an enterprise contract, or an owner-approved ceiling (decision 62). The founder's analysis job calls the gateway at CONFIDENTIAL in the same way. The stored document keeps HIGHLY_CONFIDENTIAL for every other purpose.
7. **The code-read confirmable figures stay.** Capital Q's code still reads key figures from such a document and offers them on the setup screen to Keep, Change or say Not this, and confirmed figures are still set against the deck. Q no longer describes the document itself as unreadable to its own founder (`ownDocumentQUse`).

## Enforcement

- `apps/q-api/src/composition/material-documents.ts`:
  - `createOwnCompanyMembership` (the membership check);
  - `ownReadOf` (OWNER entries and HIGHLY_CONFIDENTIAL only);
  - `documents`, `documentText` and `documentPages`, each re-checked at the read.
- `apps/q-api/src/main.ts`: `ownMember` is given to exactly two compositions, the chat document reads and the founder's analysis job's data-room reads.
- `packages/q-tools/src/tools/company-documents.ts`: `read_company_document` and `read_document_pages` return `ownCompanyRead` provenance and the evidence wording.
- `packages/q-tools/src/tools/own-records.ts`:
  - `heldBackFromQ` holds back RESTRICTED only;
  - `ownDocumentQUse` says how the founder's own highly confidential document is used;
  - `list_uploaded_documents` and `read_my_record` use both.

## Tests

- `apps/q-api/test/material-documents.test.ts` "the founder's own highly confidential documents (ADR 0079)":
  - the positive list, text and pages;
  - no membership;
  - a membership resolved for another company;
  - a membership that ends after listing;
  - RESTRICTED;
  - an investor view without a grant.
- `apps/q-api/test/material-documents.test.ts` "createOwnCompanyMembership": the SQL check and the no-membership case.
- `packages/q-tools/test/company-documents.test.ts`: a READ with `ownCompanyRead`, DOCUMENT_SUPPORTED and CONFIDENTIAL; DENY once the membership ends.
- `packages/q-tools/test/record-tools.test.ts`: the listing says the document is readable and keeps its figures; `read_my_record` holds back only RESTRICTED.
- `packages/model-gateway/test/data-room-document-fact.test.ts`: the chat path carries the own-read line.
- `apps/q-api/test/workforce-analyst.test.ts` "decision 100": the founder's own job reads the accounts, and stays held back without a membership.
- `apps/q-api/test/shared-readable-boundary.test.ts`: there is one lookup and there are two compositions, and no discovery, knowledge, memory or firewall code reads it.

No SQL, RLS or migration change. No prompt or tool-schema version bump: the tool outputs gain an optional provenance field, and the wording is carried in tool results.

## Consequences

- Asked "which of our documents back up the numbers?", a founder's Q and analysis job can read their own management accounts, invoice register and bank statement. They can then find the deck's 82% against the accounts' 29.3% gross margin, instead of asking for evidence the founder has already uploaded.
- One follow-up is not done here: a file the founder attaches to a Q chat (`attached-documents.ts`) is still held back when it is highly confidential. Aligning it with this decision is a separate, small change.
