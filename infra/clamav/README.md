# ClamAV scanner service (decision 104)

The owner approved running ClamAV as a service for upload scanning (decision
104). This directory is that service: the official `clamav/clamav` image with
clamd on TCP 3310 and freshclam updating signatures at start and 12 times a
day. The workers stream each upload to it (`INSTREAM`) before parsing; see
`apps/workers/src/documents/clamd.ts`.

Until `CLAMAV_HOST` is set on the workers, nothing changes: the scanner is
unavailable and documents stay `NOT_SCANNED` under ADR 0042.

## Railway steps (the lead)

1. **New service** in the Capital Q project, from this repository, named
   `clamav`. Settings → Config-as-code path: `infra/clamav/railway.json`
   (Dockerfile `infra/clamav/Dockerfile`). Alternative: a service from the
   Docker image `clamav/clamav:1.4`; it then misses the stream-size limits
   below, so prefer the Dockerfile.
2. **Region**: the same as the workers (europe-west4).
3. **Networking**: private only. Do **not** generate a public domain or add
   a TCP proxy. The private host is `clamav.railway.internal`.
4. **Resources**: memory limit about 3 GB (signatures take ~1.2 GB; a
   database reload briefly holds two copies). 1–2 vCPU.
5. **Volume** (recommended): mount one at `/var/lib/clamav`, so a restart
   does not download the signatures again (the mirror rate-limits repeated
   full downloads).
6. **Health check**: leave the HTTP health check path empty (clamd speaks
   TCP, not HTTP). The image's Docker `HEALTHCHECK` PINGs clamd. The first
   start takes a few minutes while signatures download; the deploy log shows
   `clamd` listening on port 3310 when ready.
7. **Workers variables** (names only; set on the workers service):
   - `CLAMAV_HOST=clamav.railway.internal`
   - `CLAMAV_PORT=3310` (the default; optional)
   - `CLAMAV_TIMEOUT_MS` (optional; default 120000, the whole scan)
8. **Redeploy the workers.** At start they log
   `evidence.documents.not_scanned_scanned_at_start` with counts: the
   backfill below runs once in the background (up to 200 versions, oldest
   first). Any infected one logs `evidence.documents.quarantined_infected`
   with ids and the signature name.
9. **Once every version is scanned** (`selected: 0`), set
   `CQ_MALWARE_POLICY=REQUIRE_CLEAN` (or remove it) on workers **and** api,
   and supersede ADR 0042. With clamd attached a scanner error is retried
   (never recorded clean or NOT_SCANNED); the interim policy then only
   decides whether leftover NOT_SCANNED files may still be downloaded.

## Backfill (scan the NOT_SCANNED versions)

From the workers service (`railway ssh` or a one-off run with its
variables):

```bash
node dist/scan-not-scanned-documents.js              # dry run: lists ids
node dist/scan-not-scanned-documents.js --apply      # scans up to 200
node dist/scan-not-scanned-documents.js --apply --limit=500
```

Repeat until `selected` is 0. Idempotent: each write is a compare-and-set
from `NOT_SCANNED`. A clean verdict writes `CLEAN`; an infected one writes
`BLOCKED` and revokes the version's chunk sets (`MALWARE_DETECTED`); a scanner
error leaves it `NOT_SCANNED` for the next run.

## What an infected file becomes

- New uploads: the pipeline blocks it before parsing (run `BLOCKED`,
  `MALWARE_DETECTED`; version `malware_scan_status = BLOCKED`). Never
  extracted, chunked, shared or downloadable.
- Backfilled ones: `BLOCKED`, chunk sets revoked, page and text reads
  refused; downloads already admit only `CLEAN`/`NOT_SCANNED`.
- The owner sees "This file was blocked by the virus check". The file stays
  in private storage; nothing deletes it.

## Local check

```bash
docker build -t cq-clamav infra/clamav
docker run --rm -p 127.0.0.1:3310:3310 cq-clamav
printf 'zPING\0' | nc 127.0.0.1 3310   # PONG
```
