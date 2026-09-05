# Media module (`@capital-q/media`, CQ-MEDIA-001)

**Purpose.** The canonical answer to "what is this pitch, which company owns it,
what is it for, where is it in its lifecycle, which external provider holds the
bytes, is it ready, is it moderated, does it have captions or a transcript, what
playback policy applies, which pitch did it replace, and which pitch is currently
primary" — without requiring a provider, storing a byte of video, or letting any
of it touch company identity or ranking. Schema `media`: `media.media_assets`.

**Invariant.**

```
MediaAsset ≠ provider asset ≠ Company
Founder ≠ MediaAsset
Pitch ≠ company quality
media READY ≠ company discoverable ≠ pitch approved ≠ founder investment-ready
encoding status ≠ moderation status
transcript state ≠ canonical fact status
video quality ≠ investment quality
```

Capital Q's identifier is the `MediaAssetId`. The provider's identifier is
replaceable integration metadata: knowing it is never permission to play the
media, and it is never this record's identity.

No provider is implemented. No Cloudflare API is called, no vendor SDK is
installed, no provider credential exists, and no video bytes pass through the
API or PostgreSQL.

## Ownership

`owner_type` + `owner_id`, bounded exactly as evidence subjects are: `COMPANY` is
the only type, resolved through `MediaOwnerResolverRegistry` over the Company
public query port. There is no `select from ${owner_type}` anywhere, and an
unregistered type resolves to nothing rather than to a guess. `tenant_id` and
`owner_organisation_id` come from the resolved company, never from the request.

## Purpose

`FOUNDER_PITCH`, `COMPANY_PRODUCT_DEMO`, `OTHER`. Policy differs by purpose,
which is why it is a field: a founder pitch is made to be shown to investors,
and its rules must never be inherited by a recording of a private conversation.
`MEETING_RECORDING` is deliberately absent — it needs consent, retention and
disclosure rules this packet does not have.

## Lifecycle

```
CREATED → UPLOAD_PENDING → UPLOADING → PROCESSING → READY
                     ↘ EXPIRED   ↘ UPLOAD_FAILED  ↘ PROCESSING_FAILED
every state → DELETED (terminal)
```

The transition map is data, not scattered conditionals, and two properties
matter most because provider events arrive late, out of order and more than
once: **READY never regresses** and **DELETED never comes back**. Every mutation
carries the expected `version`, so a stale writer updates zero rows and is told
so. Nothing in production moves an asset past `CREATED` today; a synthetic
provider in tests is the only thing that exercises the rest.

`READY` means the provider considers the media playable. It does not mean the
company is discoverable, verified, approved, or worth anything in particular.

## Playback policy

`PRIVATE`, `AUTHORISED`, `PUBLIC`, defaulting to `PRIVATE`. This is not a
DisclosureScope. It says what kind of authorization the media itself demands;
disclosure decides whether this viewer may see this company's material. Both
must be satisfied, and neither substitutes for the other. `PUBLIC` means
eligible for deliberate public playback — it publishes nothing by itself.

A new pitch is private. Uploading never makes a company discoverable, and
marketplace publication remains a separate conjunction: media READY **and**
company marketplace eligibility **and** disclosure approved **and** moderation
not blocked.

## Moderation, captions, transcript

Three axes, each independent of the lifecycle and of each other. Moderation is
`NOT_REVIEWED | PENDING | ALLOWED | BLOCKED`; a provider may encode perfectly
something Capital Q must not show. Caption and transcript states are
`NOT_REQUESTED | PENDING | AVAILABLE | FAILED`, and nothing generates either
yet. When a transcript eventually exists it is source material for the Evidence
and Q pipelines, never a canonical company fact, and this packet creates no
Evidence Source and no Claim.

## Replacement and the current pitch

Replacing a pitch creates a **new** asset that points at the old one through
`replaces_media_asset_id`; the predecessor is marked `superseded_at` and is
never rewritten or erased. A partial unique index on
`(tenant_id, owner_type, owner_id) where purpose = 'FOUNDER_PITCH' and
deleted_at is null and superseded_at is null` makes "the current pitch"
a database guarantee rather than a convention, so two concurrent replacements
collide instead of both succeeding. A second unique index on
`replaces_media_asset_id` keeps lineage a chain rather than a tree.

There is exactly one current-pitch strategy and one source for it:
`CompanyPitchQueryPort.getCurrentPitchForCompany`, which reads the same
predicate the index enforces in one indexed lookup. `core.companies` gains no
competing pitch pointer.

Deletion is soft: status `DELETED`, `deleted_at` set, the row kept. It requires
`media.manage` and is audited, because removing a pitch changes what the company
presents. Material derived from a pitch elsewhere is governed by its own lineage
rules and does not cascade from here.

## Provider abstraction

`VideoProvider` — `createUploadSession`, `getAsset`,
`createPlaybackAuthorization`, `deleteAsset` — plus
`VideoProviderCapabilities`, `CreateVideoUploadSession`, `VideoUploadSession`,
`VideoAssetStatus`, `PlaybackAuthorizationRequest` and `PlaybackAuthorization`.
Every name is Capital Q's; no vendor type, field or status string appears in the
domain. Adapter failures map onto the shared taxonomy in `@capital-q/contracts`:
`ProviderAuthenticationError`, `ProviderRateLimitError`,
`ProviderUnavailableError`, `ProviderValidationError`.

`CloudflareStreamVideoProvider`: **not implemented**. Playback authorization:
**not implemented**. The seam exists so `CQ-MEDIA-010` can add an adapter
without touching the schema, the company domain or the feed.

Provider outage is not company outage: company profile and feed reads must never
depend on an external video call, and later surfaces stay usable with text when
playback fails.

## Authority, access and privacy

Capabilities: `media.create` (publish or replace a pitch), `media.view` (read
metadata), `media.manage` (delete). Admins hold all three; members hold create
and view. None is granted by being a founder or holding a title. Authority is
scoped to the exact company that owns the media, and a company in another tenant
is "not found" before any authorization detail could differ.

`media.media_assets` is INTERNAL_SERVER_ONLY: RLS enabled, no policies, no
grants to `anon` or `authenticated`, schema usage revoked. A browser cannot
read a media row, cannot declare an asset READY and cannot name a provider
asset. Reading metadata is not playback authorization.

Events — `media.asset.created`, `media.asset.replaced`, `media.asset.deleted`,
all INTERNAL — carry identifiers, owner reference, purpose and coded status
only. Audit records the same three material actions. No provider identifier,
upload target, playback token, thumbnail reference, caption or transcript ever
reaches an event, an audit record or a log. There is deliberately no
`media.asset.ready` event: nothing here can truthfully emit one, and
`CQ-MEDIA-012` adds it when verified webhooks can.

## API

```
POST   /v1/companies/:companyId/pitch                    create or replace
GET    /v1/companies/:companyId/pitch                    the current pitch
GET    /v1/companies/:companyId/media                    media history
DELETE /v1/companies/:companyId/pitch/:mediaAssetId      soft delete
```

The create request is strict and nearly empty: the only field a client may send
is `replacesMediaAssetId`. Tenant, owner, provider, status, readiness,
moderation and playback policy are the server's decisions, and an attempt to
send one fails validation rather than being ignored. The DTO carries no provider
identifier, no storage reference and no dimensions.

Creating an asset returns status `CREATED`. **It is not an upload**, and nothing
in the API or the client pretends otherwise — there is no `uploadPitch` method,
because nothing can upload yet.

## Founder F9

The published Founder definition stays F0–F8, unchanged. F9 ("give investors a
fast first understanding of what you are building") needs a working upload, and
the upload adapter is `CQ-MEDIA-011`; publishing a step that cannot succeed
would show founders a dead required question. What exists now is the seam: the
pitch record, its API, and the current-pitch query port a later F9 step writes
through.

## Boundaries and deferrals

- Cloudflare Stream adapter → `CQ-MEDIA-010`.
- Direct creator upload and resumable (`tus`) upload → `CQ-MEDIA-011`.
- Verified webhook processing and the ready event → `CQ-MEDIA-012`.
- Player → `CQ-WEB-021`; preloading → `CQ-WEB-022`; feed → `CQ-WEB-020+`.
- Caption and transcript generation → later Media/Q integration.
- Claims derived from a pitch → later Evidence/Q pipeline.
- Browser recording, trimming and editing: not planned here.

Media existence or readiness must never change a recommendation score, create
interest, or make a company fit. Technical video quality is explicitly not an
investment-quality feature.

## Tests

`packages/media/test/domain.test.ts` (lifecycle including READY regression and
deleted resurrection, playability conjunction, DTO safety, owner registry,
provider contract neutrality, vocabulary parity);
`packages/media/test/media-service.integration.test.ts` (creation honesty,
single current pitch, replacement lineage, stale replacement, delete/replace
race, member vs admin authority, cross-tenant negatives, lifecycle races,
provider metadata rules, privacy marker in events and audit, query port and
index use); `apps/api/test/media.test.ts` (HTTP boundary: strict requests, no
provider identity in responses); `supabase/tests/database/rls/290_media.test.sql`
(defaults, bounded vocabularies, single-pitch index, lineage, soft deletion,
principals).
