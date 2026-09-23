# Cloudflare Stream setup (`@capital-q/media`, CQ-MEDIA-010)

The Media context speaks to one video provider, Cloudflare Stream, through the
`VideoProvider` port. This page names what an operator must configure, what
each variable unlocks, and what the product does when a variable is absent.
It names variables only; no value belongs here, in a log, in a response or in
the browser.

## Environment variables (API service only)

| Variable                               | Required for                   | Secret | Notes                                                                                                                                              |
| -------------------------------------- | ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`                | upload, asset status, deletion | no     | 32 hex characters. Identifier, not a secret, but server-only.                                                                                      |
| `CLOUDFLARE_STREAM_API_TOKEN`          | upload, asset status, deletion | yes    | A Bearer **API token** scoped to `Stream: Edit`. Canonical name.                                                                                   |
| `CLOUDFLARE_API_KEY`                   | same, as an alias              | yes    | Accepted only as a second spelling of the token above (it was already in use under this name). Read as a Bearer API token, never a Global API Key. |
| `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN` | playback                       | no     | `customer-<code>.cloudflarestream.com`, from Stream → Settings. Without it no playback URL can be formed.                                          |
| `CLOUDFLARE_STREAM_SIGNING_KEY_ID`     | local token signing (optional) | no     | The `id` returned by `POST /accounts/{account_id}/stream/keys`.                                                                                    |
| `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`    | local token signing (optional) | yes    | The `pem` returned by the same call — base64-encoded PEM as issued, or the decoded PEM text. Both or neither with the key id.                      |

Config lives in `packages/config/src/video-providers.ts`, folded into the API
schema (`@capital-q/config/api`). The token and the key are `ProviderCredential`
values: `JSON.stringify`, `inspect` and string interpolation all render
`[redacted]`; the value is revealed once, in `apps/api/src/main.ts`, and handed
to the adapter.

## What is configured on this machine (2026-09-23, names only)

- Present in the repo-root `.env.local`: `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_API_KEY`.
- Proven to be a Bearer API token, not a Global API Key: one authenticated
  `GET /accounts/{id}/stream?per_page=1` answered **HTTP 200**, and
  `GET /user/tokens/verify` answered **HTTP 200** with status `active`.
  Global API Keys need `X-Auth-Key` + `X-Auth-Email` and are deliberately not
  supported: they grant the whole account.
- Absent: `CLOUDFLARE_STREAM_API_TOKEN` (alias covers it),
  `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`,
  `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`.

So on this machine the adapter is composed and talks to the real API, but two
account-side gaps remain:

1. **Setup blocker for upload — no Stream allocation.** A live
   `POST /accounts/{id}/stream/direct_upload` (60-second reservation,
   5-minute expiry) answered **HTTP 413** with vendor code **10011**,
   "Storage capacity exceeded … allocated 0 minutes", and
   `GET /accounts/{id}/stream/storage-usage` reports
   `totalStorageMinutesLimit: 0`, `videoCount: 0`. Stream is not subscribed on
   this account. Fix: Cloudflare dashboard → Stream → enable the subscription
   (billed per 1,000 minutes stored and per 1,000 minutes delivered); no code
   or variable changes. Until then the adapter surfaces every reservation as
   `MediaProviderError { failure: "REJECTED", status: 413, providerCode:
"10011" }`, and over HTTP as `503 PROVIDER_UNAVAILABLE` — never as a
   success.
2. **Setup blocker for playback — no customer subdomain.** Playback
   authorization refuses with `MEDIA_PROVIDER_NOT_CONFIGURED` naming
   `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN`. Read it from Stream → Settings →
   "Customer subdomain" and set it. Local signing is optional: without a
   signing key the adapter asks Cloudflare's token endpoint for each playback
   token under the API token, which works but costs one vendor call per
   playback.

Asset status and deletion were exercised live and behave as documented (a
never-created id reads as `EXPIRED` / `ASSET_NOT_FOUND`; deleting it is
idempotent).

## Degradation when unset

| Missing             | Behaviour                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| account id or token | The explicit `UNCONFIGURED` provider is composed. Every call rejects with `MediaProviderNotConfiguredError` naming both.         |
| customer subdomain  | Upload/status/delete work; `createPlaybackAuthorization` rejects naming the subdomain. `capabilities.signedPlayback` is `false`. |
| signing key         | Playback tokens are requested from the vendor's token endpoint instead of signed locally. Nothing is refused.                    |

Over HTTP a `MediaProviderNotConfiguredError` becomes a `503`
`PROVIDER_UNAVAILABLE` problem whose `detail` starts with
`MEDIA_PROVIDER_NOT_CONFIGURED:` and names the variables. A provider failure
(`MediaProviderError`) becomes `503 PROVIDER_UNAVAILABLE` (or `429
RATE_LIMITED`) with no vendor, host, status or reason code in the response;
those stay in the server log. Nothing is ever reported as uploaded, ready or
playable that was not.

## State translation (vendor → Capital Q lifecycle)

The raw vendor status never leaves `cloudflare-stream-video-provider.ts`.

| Cloudflare `status.state` | `uploaded` | Capital Q `MediaStatus`                                                                               |
| ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `pendingupload`           | —          | `UPLOAD_PENDING`                                                                                      |
| `downloading`             | —          | `UPLOADING`                                                                                           |
| `queued`, `inprogress`    | —          | `PROCESSING`                                                                                          |
| `ready`                   | —          | `READY`                                                                                               |
| `error`                   | absent     | `UPLOAD_FAILED`                                                                                       |
| `error`                   | present    | `PROCESSING_FAILED`                                                                                   |
| HTTP 404 for a known id   | —          | `EXPIRED` (the target lapsed; the lifecycle refuses this move from any state where it would be a lie) |
| anything else             | —          | refused as `MALFORMED_RESPONSE`; never guessed into the lifecycle                                     |

`DELETED` is never produced by the adapter: deletion is Capital Q's decision.
`errorReasonCode` travels as `providerErrorCode` for private diagnostics only.
`duration`, `input.width` and `input.height` are reported only when the vendor
knows them (it sends `-1` while it does not); nothing is invented.

## What the server decides, and the browser never does

`createUploadSession` sends the vendor: `maxDurationSeconds` (Capital Q's
reservation), `expiry` (30 minutes by default, bounded to the vendor's 2
minutes … 6 hours), `requireSignedURLs` (from the playback policy),
`allowedOrigins` (the web origin's host, when given), `creator` (the
`MediaAssetId`, so a vendor record always traces back to ours) and a `meta.name`
of purpose plus asset id. No person, organisation or company field is sent. The
browser receives a one-time upload URL and nothing else.

Resumable (tus) creator uploads are reported as unsupported
(`capabilities.resumableUpload: false`) because that mode needs the byte length
up front and the port does not carry it. Direct creator upload is limited by
the vendor to 200 MB, which a 3-minute pitch fits comfortably.

## Errors

| Class                             | Meaning                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `MediaProviderNotConfiguredError` | `code = MEDIA_PROVIDER_NOT_CONFIGURED`, `missing` = variable names                                                                    |
| `MediaProviderError.failure`      | `AUTHENTICATION` (401/403), `RATE_LIMITED` (429), `REJECTED` (other 4xx), `UNAVAILABLE` (5xx, network, timeout), `MALFORMED_RESPONSE` |

Both are mapped to problems in `apps/api/src/http/media.ts`
(`mediaProviderProblem`), scoped to the media routes.

## The direct upload flow (CQ-MEDIA-011)

Three `POST`s under `/v1/companies/:companyId/pitch/:mediaAssetId`, all in
`apps/api/src/http/media.ts`, backed by `packages/media/src/application/upload-use-cases.ts`.
No provider call happens inside a transaction: the vendor is asked first with
nothing locked, and its answer is applied under a row lock against the version
that was read.

| Route             | Who                                         | Does                                                                                                                                                                                                                                      | Answers                                                                        |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/upload-session` | owner, `media.create`                       | Body `{ expectedVersion }` only. Requires status `CREATED` with no provider asset. Reserves a one-time target (180 s allowance, adapter expiry, signed unless policy is `PUBLIC`), stores the uid, moves `CREATED → UPLOAD_PENDING`.      | `201 MediaUploadSessionDto` — the one-time `uploadUrl`, never the uid.         |
| `/sync`           | owner, `media.create`                       | Reads the provider, walks every legal lifecycle step to the reported state (`transitionPath`), records duration/dimensions/aspect ratio/poster reference. Idempotent; a move the lifecycle forbids is ignored, not forced.                | `200 { pitch }`                                                                |
| `/playback`       | owner (`media.view`) or discoverable viewer | Owner: any `READY` pitch of their own. Viewer: `READY` + moderation `ALLOWED` + policy not `PRIVATE` **and** the company eligible for them by the Recommendation context's REC-001 rule (`PitchViewerAccessPort`, composed in `main.ts`). | `200 PlaybackAuthorizationDto` — a minted URL, no token field, no provider id. |

Refusals on the viewer path are all `404`; the owner asking to play a pitch
that is not `READY` gets `400 INVALID_REQUEST`. A second `/upload-session` on
an asset that already holds a target is `400`: the one-time URL cannot be
re-issued, so a lost URL means replacing the pitch.

Each applied step emits `media.asset.status_changed` (previous and new
status) through the outbox; reservation and sync are audited as
`media.asset.upload_reserved` and `media.asset.synced` (states and the
vendor's failure code only — never the target, the uid or a token).

No schema change was needed: the uid lives in `provider_asset_id`, the
target's expiry is the provider's (a vendor 404 on sync becomes `EXPIRED`
where the lifecycle allows it), and signed playback derives from
`playback_policy` at reservation time.

## Not in this packet

Webhook ingestion (CQ-MEDIA-012), captions, the feed player and the founder
upload UI. The live path against this account still ends at the 413 plan
blocker above: nothing here has been observed to complete a real upload.
