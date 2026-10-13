# ADR 0067: GateQ guest-owned application documents

- Status: Proposed. Direction approved by the product owner on 2026-10-13: "define the ownership/security ADR and versioned contract now; full GateQ acceptance must include secure guest document uploads during an interview".
- Amends: none. It extends Evidence (ADR 0008 ingestion; ADR 0042 interim unscanned policy) and GateQ intake (application sessions).
- Implementation: after GateQ slice 1 (text interview, submission, dossier). It is a required part of GateQ acceptance (directive `docs/ai-handoff/session-directives/2026-10-13-gateq-adaptive-interview-and-inbox.txt` §5 and §8).
- Contract: `@capital-q/contracts`, GateQ application documents v1 (see Contract below).

## Context

A GateQ applicant may be a guest: no Capital Q account, no organisation membership. They hold only a scoped application session credential (`gqs_…`, hashed at rest, 14-day lifetime, one indistinguishable `SESSION_INVALID` for every failure).

Today:

- Evidence uploads require an authenticated actor with an active organisation (`packages/evidence/src/application/upload-use-cases.ts`).
- `GATEQ_APPLY_MATERIALS_PATH` only lets a signed-in founder share documents their organisation already owns.
- `gateq.application_documents` stores the association only.
- No extracted page text reaches the interviewer, and a guest cannot upload anything.

The product requires a founder to upload or share documents during the interview, with Q asking about them, and the investor's dossier citing them by page or section. Doing that must not:

- create a fake organisation membership;
- weaken Evidence's quarantine, malware or extraction rules;
- let document content act as an instruction to Q;
- let an unsubmitted document reach an investor.

## Decision

1. **The owner is the application, not a person or an organisation.**
   - A guest upload is an Evidence document whose owner scope is a GateQ application (`owner_kind = GATEQ_APPLICATION`, `owner_id = application_id`), within the gateway's tenant for storage partitioning only.
   - It never joins the applicant's or the investor's organisation document set.
   - No membership is created.
   - An authenticated founder who uploads during an application gets the same application-owned scope. Their existing organisation documents are still shared through the existing explicit share path (`GATEQ_APPLY_MATERIALS_PATH`), unchanged.
2. **Authority is the session credential, checked on the server.** Every guest upload, list or read is authorised by the application session token through `intake.authorise`.
   - The token grants access to that application's documents only.
   - RLS keeps the new rows server-only (RLS on, no policies, no browser grants), as for every other `gateq` table.
   - A token cannot name another application's document; a mismatch is the same `SESSION_INVALID`.
3. **The Evidence pipeline is reused unchanged.** Uploads go:
   1. to quarantine, by direct-to-storage signed upload (bytes never pass through the app origin, per CLAUDE.md);
   2. through file-type validation;
   3. through malware status, under the configured `CQ_MALWARE_POLICY` (ADR 0042 applies, and `NOT_SCANNED` is never shown as clean);
   4. through extraction with `scanInstructionRisk`;
   5. into page text in `evidence.document_pages`.

   A version that is BLOCKED or still processing never reaches Q or the investor.

4. **Q only sees extracted, permitted, bounded text, as data.**
   - The interviewer receives `documentProposals` built from extracted page text of this application's ready documents only. Each excerpt is bounded and labelled with `documentId`, `page` or `section`, `extractionStatus` and `instructionRisk`.
   - Text is fenced as untrusted data. Excerpts flagged by `scanInstructionRisk` are withheld or summarised as "contains instruction-like text".
   - A document can never change Q's instructions, tools, routing or permissions.
   - Facts drawn from a document are recorded with provenance `DOCUMENT_SUPPORTED`, citing the document, page and section. That is distinct from `APPLICANT_PROVIDED` and from independent verification, which Q never claims.
5. **Disclosure happens at submission and nowhere else.**
   - Before submission, the investor cannot list, read or infer guest documents.
   - The founder's review screen lists every document that will be disclosed. Documents can be removed before Submit.
   - At Submit, the immutable snapshot records the disclosed document ids and version ids. The investor's access is to those exact versions, through the existing signed-download path.
   - Later uploads are append-only amendments and never rewrite the snapshot.
6. **Limits.** Per-application limits on document count, total bytes and file types are configured and enforced on the server. Uploads are throttled through the existing GateQ throttle (`domain/throttle.ts`), as new operations.
7. **Retention.**
   - Unsubmitted guest documents expire with the application session and are then removed.
   - Submitted ones follow the gateway's retention (existing GateQ submission rules).
   - Deletion is recorded, never silent.

## Contract (versioned; to be added with the implementation)

`gateq-application-documents.v1`, under `/v1/gateq/apply/documents`. All routes are guest-token scoped and use problem-details errors.

| Route                                                 | Request                                             | Response                                                                         | Notes                                                            |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /v1/gateq/apply/documents`                      | `{ fileName, mimeType, byteSize, clientRequestId }` | `{ documentId, uploadUrl, expiresAt }`                                           | Signed direct-to-storage upload; idempotent on `clientRequestId` |
| `POST /v1/gateq/apply/documents/:documentId/complete` | —                                                   | `{ documentId, status }`                                                         | Starts the Evidence pipeline                                     |
| `GET /v1/gateq/apply/documents`                       | —                                                   | `[{ documentId, fileName, status, pages, malwareStatus, includedInSubmission }]` | `status` is `PROCESSING`, `READY`, `BLOCKED` or `FAILED`         |
| `DELETE /v1/gateq/apply/documents/:documentId`        | —                                                   | `204`                                                                            | Before submission only                                           |

The submission snapshot (v2+) gains `documents: [{ documentId, versionId, fileName, pages }]`. Dossier source references use `{ documentId, versionId, page?, section? }`.

## Consequences

- GateQ acceptance (directive §8) can prove: a relevant upload changes Q's questions; prompt injection inside an upload cannot control Q; the investor sees exactly the submitted documents; cross-application and cross-tenant reads fail.
- Evidence gains one new owner kind. Every Evidence read path must filter by owner kind, so a guest document can never appear in an organisation document list. Negative tests are required.
- Required tests:
  - pgTAP: owner scoping, no browser grants, and a cross-application negative;
  - unit: the token cannot reach another application's documents;
  - an injection fixture;
  - a BLOCKED document never reaches Q;
  - the snapshot includes only reviewed documents.
