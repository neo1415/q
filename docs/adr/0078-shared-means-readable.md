# ADR 0078: Shared means readable — Q reads a highly confidential document for the investor it was shared with

- Status: **Accepted.** The owner decided it on 2026-11-16 (`docs/ai-handoff/DECISIONS.md` decision 99, "Shared means readable") and is the authority to amend it. The lead may renumber this ADR.
- Amends:
  - the "held back from Q, whoever asks" rule for HIGHLY_CONFIDENTIAL documents (Stress 2026-10-28 F03/S02-F; `apps/q-api/src/composition/material-documents.ts`), **for the chat read tools of an investor holding an active grant only**;
  - the note in `packages/model-gateway/src/policy/eligibility.ts` that no decision has been made to let the strongest material leave through a model provider: decision 99 is that decision, scoped as below. The provider ceilings themselves are unchanged.
- Unchanged: the evidence classification (`packages/evidence/src/domain/sensitivity.ts`: MANAGEMENT_ACCOUNTS, FINANCIAL and FINANCIAL_MODEL default to HIGHLY_CONFIDENTIAL), RLS, the data-room levels and grants, the Context Firewall plans, Q Knowledge and retrieval scopes (ADR 0041 §3: Q Knowledge ≠ Data Room disclosure), network-visible claims, ranking and recommendation features, and the founder's own Q.

## Context

The demo-evidence inventory (`docs/ai-handoff/audits/2026-11-16-demo-evidence-inventory.md`, section 3) found that Q tells every investor that a company's figures are "self-reported", even after the founder has shared management accounts with that investor through the data room. The investor can open those accounts on screen, but Q cannot read them: every HIGHLY_CONFIDENTIAL document is held back from Q for every reader. The owner's direction (decision 99): once a founder shares such a document with one investor through the product's grant or diligence workflow, Q may read it for that investor only.

## Decision

1. **Who.** Q may read the text and pages of a HIGHLY_CONFIDENTIAL document (management accounts, financial model, bank statement, other FINANCIAL material) in a turn of a person whose **own investor organisation** holds an **active grant** of that document: an unrevoked, unexpired disclosure policy whose recipient is the CONNECTED company–investor relationship, and which the disclosure access service allows for `view` for this person. That is exactly the check that lets the investor open the document in the data room (`DataRoomService.open`), minus the PUBLIC level: a room-wide level is not a share with one investor. Q can therefore never read more than the investor can open.
2. **Resolved on the server, at the read.** `DataRoomService.qReadableShare` resolves the investor organisation, relationship and grant from the actor context. No client- or model-supplied id is trusted. The check runs:
   - when the document is listed for matching;
   - again inside the text or page read itself, before any text leaves the database read and before the model is invoked.

   Nothing is cached, so a revoked or expired grant closes the document on the next read.

3. **Provenance.** A shared read carries `sharedUnder: { grantId, expiresAt }` in the tool result, so the run's recorded tool output names the grant it was read under.
4. **Evidence axes.** What Q reads stays the company's own material: truth class USER_CLAIM, evidence status DOCUMENT_SUPPORTED at most, never EXTERNALLY_VERIFIED. Q says it naturally ("their management accounts show…"). It does not say "self-reported", and it does not call the figures verified.
5. **Everyone else unchanged.**
   - An unshared document stays unreadable to every investor's Q.
   - Another investor, even a connected one, gets nothing from this investor's grant: the document is not listed to them, not readable and not in retrieval.
   - RESTRICTED material is never unlocked.
   - The founder's own Q is unchanged: their HIGHLY_CONFIDENTIAL documents remain held back (`heldBackFromQ`; figures become usable through the founder's confirmation). **Superseded by [ADR 0079](0079-founder-reads-own-documents.md) (decision 100, 2026-11-16):** a current member's own Q now reads them, with this ADR's provider handling.
   - The diligence workforce memo is composed without the share lookup and still treats these documents as held back. Extending it needs its own decision, because the memo persists an artifact.
6. **Sensitivity on the way to the model.** The founder's share is the owner-approved disclosure for that investor. The read is carried into that investor's turn at CONFIDENTIAL, the plan ceiling the investor's turn already has. It therefore reaches only a provider whose justified ceiling is CONFIDENTIAL: zero retention asserted, an enterprise contract, or an owner-approved ceiling (decision 62). The stored document keeps HIGHLY_CONFIDENTIAL for every other purpose. No provider ceiling and no firewall scope is raised.
7. **Combination-risk guard.** Cash + burn → runway is the combination the guard exists for. For the investor the founder shared these figures with, the founder chose to disclose that combination, so Q may derive runway for them in their turn. It must not leak:
   - **Other investors.** The share lookup is per actor and per relationship.
   - **Ranking, discoverability and recommendation features.** These never read documents, and the lookup has exactly one caller, guarded by `apps/q-api/test/shared-readable-boundary.test.ts`.
   - **Retrieval, Q Knowledge or shared memory.** Document chunks stay `organisation_private`. The read tools are READ_ONLY and write nothing. Any memory write still goes through the Write Gate at the investor's own private scope.

## Enforcement

- `packages/permissions/src/application/data-room.ts`: `qReadableShare`, the grant check.
- `apps/q-api/src/composition/material-documents.ts`:
  - `shareOf`: HIGHLY_CONFIDENTIAL only, an investor's OPEN entry only;
  - `documents`, `documentText` and `documentPages`, each re-checked.
- `apps/q-api/src/main.ts`: the chat tools' composition is the only one given `sharedGrant`.
- `packages/q-tools/src/tools/company-documents.ts`: `read_company_document` and `read_document_pages` return `sharedUnder` provenance and the evidence wording.

## Tests

- `packages/permissions/test/data-room.test.ts` "qReadableShare (ADR 0078)":
  - the grant is named;
  - null for another investor, a revoked grant, an expired grant, the owner, a PUBLIC level alone, an access refusal, and a relationship that is not connected.
- `apps/q-api/test/material-documents.test.ts` "a shared highly confidential document (ADR 0078)":
  - positive list, text and pages;
  - another investor stays held back;
  - revocation after listing;
  - RESTRICTED never unlocked;
  - the owner is unchanged.
- `packages/q-tools/test/company-documents.test.ts`: a READ with `sharedUnder`, DOCUMENT_SUPPORTED and CONFIDENTIAL; DENY after revocation.
- `apps/q-api/test/shared-readable-boundary.test.ts`: there is one caller of the share lookup, and no discovery, knowledge, memory or firewall code reads shared material.

No SQL, RLS or migration change. The grant tables and policies are the existing disclosure policies.

## Consequences

- The investor demo can show Q reading shared management accounts and stating cash, burn and runway as the company's own figures.
- A founder who shares a financial document with an investor now also lets that investor's Q read it. The data-room share copy should say so. That is a follow-up UI copy item, and is not done here.
