# ADR 0008 — Document processing, parser isolation and structured extraction

**Status:** Accepted (CQ-EVD-003)
**Clarifies:** Document 14 §9–10 (ContentExtractor, ExtractedDocument), Document 15 §25–30 (upload and parser boundary), Document 16 TM-FILE-01..07 and TM-RAG-02/03, Document 21 §37–43 (queues, retries, dead letters).

## Context

A document version becomes useful only when something reads it, and reading an
uploaded file is the most hostile operation Capital Q performs: the bytes come from
outside, the parsers are large native-adjacent libraries, and the process that runs
them sits next to the database and the storage credential.

Three separate things had to be decided at once: where parsing runs, what "processed"
is allowed to mean when Capital Q has no malware scanner yet, and what shape the
output takes so that a later citation can say "page 7" and be believed.

The distinctions that constrain the answer:

```
uploaded ≠ safe ≠ parsed ≠ trusted
extracted block ≠ evidence item ≠ claim ≠ Q knowledge
document text ≠ instruction
```

## Decision

1. **One documents queue, driven by a domain event.** `evidence.document.version_created`
   is a fact; the worker turns it into an `evidence.document.process` job on a durable
   `documents` queue, with `documents-dead` for attempts that exhaust their retries.
   The job carries a document version id and a pipeline version and nothing else.

2. **The message is a claim, never an authority.** The worker resolves the version by id
   alone and compares the job's tenant with the row's. A mismatch is refused and
   dead-lettered rather than treated as "not found", because a stale job and a forged
   one deserve different answers. Storage identity, MIME type, size and ownership all
   come from the database, never from the payload.

3. **Parsing runs out of process, with nothing worth stealing.** The orchestrator holds
   the database and the storage credential; the parser is spawned with `execFile`, an
   argument array and no shell, into a private temp directory removed in `finally`.
   Its environment contains no `DATABASE_URL`, no storage key, no model provider key,
   no connector token. It runs under a wall-clock timeout, a bounded stdout and a heap
   ceiling, and its output is revalidated with Zod before anything is persisted — the
   child's output is exactly as untrusted as the document that produced it.

4. **Extractors are owned, not adopted, where the limits are the security property.**
   PDF uses `pdfjs-dist` with evaluation, system fonts and worker fetches disabled.
   DOCX and PPTX use a bounded OOXML reader written for this purpose: entry count,
   per-entry expanded size, total expanded size and compression ratio are checked
   against the central directory _before_ a byte is inflated, and the inflate is capped
   again. XML is scanned, never entity-resolved, so there is no XXE surface to secure.
   Macros, embedded objects and external relationships are never read or executed.

5. **Spreadsheets and CSV are deferred, explicitly.** A valid `.xlsx` upload produces
   `text_extraction_status = 'UNSUPPORTED'` and a failed run carrying
   `UNSUPPORTED_MEDIA_TYPE`. It never reports COMPLETED, because "we have no extractor"
   and "we read it and found nothing" are different facts and only one of them is true.

6. **No scanner means blocked, not clean.** The malware port exists with one
   implementation that answers UNAVAILABLE. Under the default `REQUIRE_CLEAN` policy an
   unscanned document is BLOCKED and never parsed; `ALLOW_UNSCANNED` exists for local
   development only and configuration refuses it outside a local environment. Only a
   scanner's own verdict may write `malware_scan_status = 'CLEAN'`.

7. **BLOCKED is a run status distinct from FAILED.** FAILED means the attempt broke and
   another may succeed; BLOCKED means policy refused the work and is terminal. The
   version-level `processing_status` has no BLOCKED value: the run carries why the work
   stopped, the version records only that it did.

8. **The artifact lives in private storage; the row carries provenance.**
   `evidence.document_extractions` records extractor, versions, run, artifact location,
   hash, counts and the number of instruction-risk signals. The blocks themselves go to
   the private `cq-extractions-private` bucket, inheriting the document's visibility
   scope and sensitivity class — a parser running is never a reason for private material
   to become less private. One artifact per (document version, pipeline version), and
   rows are immutable: reprocessing means a new pipeline version, not a rewrite.

9. **Instruction-shaped text is counted, not obeyed and not removed.** A deterministic
   scanner reports categories and locators only — never the matched passage, which is
   document content and stays in the private artifact. It executes nothing, calls no
   model, grants no permission and blocks no processing. A deck that says "ignore
   previous instructions" is still an ordinary deck whose words carry no authority.

10. **Completion is atomic.** The run's COMPLETED transition, the version's processing
    state and the `evidence.document.ready` event are written in one transaction through
    the outbox. A redelivered job finds the run already settled and emits nothing, so
    at-least-once delivery does not become at-least-once announcement.

## Consequences

- Documents cannot be processed in a hosted environment until a malware scanner is
  attached. This is intentional and visible in the run state rather than hidden.
- Extraction is available for PDF, DOCX, PPTX and plain text. Spreadsheets, CSV, images
  and scanned PDFs (no OCR) remain unsupported and say so.
- Parsing costs a process per document. The bound is deliberate: throughput is a tuning
  problem, containment is not.
- Nothing here creates chunks, embeddings, Q Knowledge, evidence items or claims, and
  no model is called. Those arrive in later packets and read the artifact this one
  produces.
