# ADR 0042: Unscanned documents, interim (no malware scanner yet)

- Status: Accepted (founder decision, 2026-10-03)
- Amends: ADR 0008 §6 ("No scanner means blocked, not clean") for hosted
  environments, while no scanner is attached; ADR 0041 §2 (the deck
  download's "scanner-CLEAN" condition)
- Migration: `20261120090000_documents_not_scanned.sql` (additive)

## Context

Capital Q has no malware scanner. The workers' scanner port is wired to an
implementation that always answers UNAVAILABLE, and under the default
policy (`REQUIRE_CLEAN`) every uploaded document is BLOCKED before it is
parsed (ADR 0008 §6). On the live deployment on 2026-10-03 that was every
document version (3 of 3, 2 tenants): no investor could download a deck,
no diligence download worked, and Q could read no upload.

The founder decided: "I will add the antivirus later, but I need those
documents to be available to who needs it."

## Decision

1. **An explicit interim policy.** `CQ_MALWARE_POLICY` gains
   `ALLOW_UNSCANNED_WITH_WARNING`. It is accepted in a hosted environment
   only when set explicitly; the default stays `REQUIRE_CLEAN`, and
   `ALLOW_UNSCANNED` stays local-only. Workers and API read the same
   variable.
2. **Unscanned is never clean.** With no scanner the verdict stays
   UNAVAILABLE. Under the interim policy the pipeline proceeds and records
   the version `NOT_SCANNED` (a new `malware_scan_status` value). `CLEAN`
   is written only from a scanner's CLEAN verdict, under every policy. An
   INFECTED verdict is still blocked; a scanner that exists but fails is
   still retried. The run's provenance records the policy it ran under.
3. **Processing proceeds within the existing limits.** Size bound, parser
   sandbox, timeouts and output limits are unchanged; a `NOT_SCANNED` file
   is extracted and chunked, so Q can read it.
4. **Downloads: the same audiences, nothing wider.** Under the interim
   policy a `NOT_SCANNED` current version may be downloaded exactly where a
   `CLEAN` one may today: an `INVESTORS`-audience deck by an investor the
   pitch rule admits (ADR 0041), and a document shared in diligence by that
   relationship's investor. `PENDING`, `BLOCKED` and `ERROR` are never
   handed out. Chat attachments and admin KYB reads stay CLEAN-only. Every
   such response carries `scanned: false`.
5. **Said wherever it is offered.** The deck on a company's profile, a
   diligence share and the founder's own file list show "Not virus-scanned
   yet". Q's read of the person's uploads carries the same fact, and Q says
   it when it offers or shares the file.
6. **Re-drive.** Versions whose latest run is BLOCKED with
   `MALWARE_SCAN_UNAVAILABLE` are re-processed by
   `apps/workers` `redrive-documents` (dry run by default; `--apply`
   enqueues one job each under the current `CQ_PIPELINE_VERSION`, which
   must differ from the version they were blocked under). Idempotent: a
   version with a run under the current pipeline version is never
   selected, and the run table's uniqueness absorbs a duplicate job. The
   workers also run it once in the background at start, only under this
   policy, logging one line (`evidence.documents.redriven_at_start`).

## Risk

A file nobody has scanned can reach an investor's machine. The audiences
are the ones the founder already chose, the file is the founder's own, and
every place it is offered says it has not been scanned. Parsing happens in
the existing sandbox with no credentials. The risk is accepted by the
founder for the interim.

## Reversal

When a scanner is attached:

1. Set `CQ_MALWARE_POLICY=REQUIRE_CLEAN` (or remove it) on workers and API:
   `NOT_SCANNED` files stop being served at once.
2. TODO: scan every `NOT_SCANNED` version (`selectNotScannedForScan` in
   `apps/workers/src/documents/redrive.ts`, tested) and record each
   scanner's verdict; only that verdict may write `CLEAN`.
3. This ADR is then superseded, and ADR 0008 §6 holds again in full.
