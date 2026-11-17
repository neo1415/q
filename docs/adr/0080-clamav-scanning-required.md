# ADR 0080: ClamAV scanning required for uploads

- Status: Accepted (founder decision 104, 2026-11-17)
- Supersedes: ADR 0042 (unscanned documents, interim)
- Restores: ADR 0008 §6 ("No scanner means blocked, not clean") and ADR 0041 §2

## Context

ADR 0042 let hosted environments process and serve uploads recorded `NOT_SCANNED` while no malware scanner existed. Decision 104 approved ClamAV.

## Decision

- **Scanner service:** a private Railway service `clamav` in the Q project, europe-west4.
  - Built from `infra/clamav/Dockerfile` (clamd on TCP 3310, 64 MB stream limit, freshclam 12× a day).
  - Signatures are kept on a volume at `/var/lib/clamav`.
  - It has no public domain and no TCP proxy.
- **Workers:** they stream every upload to it (`CLAMAV_HOST=clamav.railway.internal`) before parsing.
  - Infected → `BLOCKED` / `MALWARE_DETECTED`: never parsed, chunked, shared or downloadable.
  - Scanner error → retried, never recorded clean.
- **Backlog:** the backlog of `NOT_SCANNED` versions was scanned by the workers' start-up backfill: 2,245 versions on 2026-11-17, all CLEAN, 0 infected.
- **Policy:** `CQ_MALWARE_POLICY=REQUIRE_CLEAN` on workers and api. Only CLEAN files are served.

## Consequences

- If the scanner is down, new uploads wait and retry instead of being processed unscanned.
- The operator alerts (`OPS-ALERTS.md`) surface stuck work.
- The interim `NOT_SCANNED` status remains in the schema for history.
- `ALLOW_UNSCANNED` stays refused outside a local environment.
