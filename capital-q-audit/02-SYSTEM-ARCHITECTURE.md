# 02 — System Architecture

Investigator A. Read-only. HEAD `520bd123`. Each claim cites `path:line`. Excerpts are in `evidence/architecture/*.md`, and diagrams in `diagrams/system-architecture.md` and `diagrams/auth-permission-boundaries.md`.

## 1. Deployables and hosting

| Deployable                  | Hosted on (actual)                                                                                                                                                                                                           | Start                                                   | Port | Public?                                          | Health                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---- | ------------------------------------------------ | --------------------- |
| `apps/web` (Next.js 16.3.4) | **Railway** service `@capital-q/web` (`.railway/railway.ts:237-262`). The ADRs intend Vercel, but the 2026-10-08 handoff says "Railway deploys web, api, q-api and workers" (`docs/handoff/session-handoff-2026-10-08.md:5`) | `pnpm --filter @capital-q/web start` (`railway.ts:240`) | 3000 | yes                                              | none declared         |
| `apps/api` (Fastify 5.12.1) | Railway `@capital-q/api`, private endpoint `capital-qapi`                                                                                                                                                                    | `node apps/api/dist/main.js` (`railway.ts:125`)         | 3001 | yes                                              | `/health/ready`       |
| `apps/q-api` (Fastify)      | Railway `@capital-q/q-api`, private `capital-qq-api`                                                                                                                                                                         | `node apps/q-api/dist/main.js` (`railway.ts:162`)       | 3002 | yes (speech-provider callbacks, Recall webhooks) | `/health/ready`       |
| `apps/workers`              | Railway `@capital-q/workers`, private only                                                                                                                                                                                   | `node apps/workers/dist/main.js` (`railway.ts:199`)     | —    | no                                               | none (no HTTP server) |
| Embeddings runtime (TEI)    | **Not deployed.** Defined only in the superseded `render.yaml:33-66`; `.railway/railway.ts` has no such service                                                                                                              | —                                                       | —    | —                                                | —                     |
| Database / Auth / Storage   | Supabase hosted project. App traffic goes through the Supavisor session pooler (`railway.ts:90-93`)                                                                                                                          | —                                                       | —    | —                                                | —                     |
| Video                       | Cloudflare Stream (`packages/media/src/infrastructure/cloudflare-stream-video-provider.ts`)                                                                                                                                  | —                                                       | —    | —                                                | —                     |

- Region `europe-west4`, one replica per service (`railway.ts:35,127,164,200,241`).
- Source branch `recovery/2026-09-12` (`railway.ts:31`). This audit's branch is `recovery/2026-09-12-8y2j4w`; the handoff says HEAD is pushed to both (`session-handoff-2026-10-08.md:5`).
- Build: Railpack running `pnpm deploy:build:<svc>`, i.e. `turbo run build --filter=@capital-q/<svc>...` (`railway.ts:47-66`, root `package.json`). No Dockerfiles.
- `CAPITAL_Q_ENV=staging`, `NODE_ENV=production` (`railway.ts:82-87`).

**IaC drift (CONFIRMED).** `docs/deployment/staging.md:26-28` calls `.railway/railway.ts` "the source of truth for … non-secret variables", and the file header says each service receives "only the variables it actually reads" (`railway.ts:16-20`). However:

- No occurrence of `OPENAI_*`, `CQ_VOICE_REALTIME*`, `CLOUDFLARE_*`, `STRIPE_*`, `RECALL_*`, `GOOGLE_WORKSPACE_*`, `SMTP_*`/`BREVO_*`, `WEB_PUSH_*` or `POSTMARK_*` appears in `.railway/railway.ts` (grep count 0).
- Production nonetheless uses OpenAI as the primary model (lead's live evidence: `gpt-5.6-luna` NORMAL_DIALOGUE; migration `20261008130000_ai_ops_openai_primary.sql`), the duplex line (`CQ_VOICE_REALTIME`) and pitch video (34 `media.media_assets` rows live).

Those variables must therefore have been set directly in Railway. Applying `railway config apply` from this file could not remove them (`preserve()` semantics are only for the declared ones), but the file is not a reliable inventory of what runs.

**Readiness is not readiness.** `/health/ready` on q-api returns a static `{status:"ok"}` and checks no dependency (`apps/q-api/src/app.ts:760-770`: "readiness will grow to cover configuration…"). The api service registers the same pair (`apps/api/src/app.ts:440-442`). Railway therefore reports healthy with the database or providers down.

## 2. Frontend (apps/web)

**Route tree** (`apps/web/app`, 147 route files):

- Authenticated app shell `(app)/`: `home`, `discover/{,passed,saved,saved/compare,yours}`, `explore`, `find`, `search`, `capital` (+`export` route), `company/[companyId]{,/founder/[position]}`, `company/{interest,visibility}`, `investors/{,top,[id],[id]/rehearse}`, `relationships/{,company/[companyId]/{,calls,diligence,messages},investor/[id]/{,calls,diligence,messages},deal/[relationshipId]/{audit,reports/[reportId]}}`, `pitch/{,new,[mediaAssetId]}`, `profile` (+`q-card/qr`), `rehearsals/{,company/…,investor/…,meeting/…,r/[rehearsalId]}`, `work/{,[delegationId],[delegationId]/report/[laneId]}`, `daily/{,[editionId]}`, `documents`, `gateq`, `gateway`, `gateq/pack/…`, `results` (+`report`), `reviews`, `verification`, `settings/{,billing,memory,plan,reconnect/google,team,usage}`, `join/[token]`, and 20 admin routes `admin/*` (accounts, attribution.csv, audit, billing, brand, claims, email, etiquette, flags, organisations, q, q/runs/[runId], queue, reviews, safety, safety/break-glass/[id], team, verification).
- `(onboarding)/`: `onboarding/founder`, `onboarding/investor`, `welcome`.
- `auth/`: `sign-in`, `sign-up`, `check-email`, `forgot-password`, `update-password`, `callback` (route).
- Public: `/` (landing), `c/[code]`, `g/[publicId]{,/embed}`, `u/[handle]{,/card.pdf,/card.png,/vcard}`, `connected/google`, `paused`.
- 12 route handlers under `app/api/*` that proxy to services with the cookie session's bearer: `q-room`, `q-stream/v1/q/runs/[runId]/events` (SSE proxy), `q-speech`, `q-voice-narration/[voiceSessionId]`, `q-artifact/{recent,[artifactId]/[format]}`, `q-brand-kit/logo`, `q-daily/[editionId]/pdf`, `q-work-report/…`, `company-photo/…`, `investor-photo/…`, `pitch-captions/…`.
- 23 `dev/*` harness routes, 404 in production unless `CQ_DEV_PREVIEW=1` (`app/dev/q-room/page.tsx:26-31`).

**Proxy (middleware).** `apps/web/proxy.ts:10-48` runs `handleSessionProxy` (`src/auth/session-proxy.ts`) on a literal matcher list: session refresh and route protection only.

**Server actions.** 67 files carry `"use server"` (e.g. `src/features/q/actions.ts`, `src/features/voice/{actions,duplex-actions}.ts`, `src/features/briefing/arrival-actions.ts`, `src/features/q/room/room-actions.ts`, `src/features/chat/chat-actions.ts`, plus admin, gateq, relationships and settings actions). The pattern is: `getSessionAccessToken()` → `@capital-q/api-client` call with `{ baseUrl, accessToken }` → typed result.

**api-client** (`packages/api-client/src`, 57 modules, 8.7k LOC, depends only on `contracts` and `zod`). `request.ts` is the HTTP core, `sse.ts`/`q-stream*.ts` the SSE reader and reducer, and there is one module per domain (`q.ts`, `work.ts`, `chat.ts`, `schedule.ts`, `voice` via `q.ts`, …). The browser never holds the bearer token. Client components call same-origin `/api/*` routes or server actions; for example `use-q-conversation.ts:58,222` streams via `"/api/q-stream"` with `accessToken: ""`.

**Exceptions where the browser talks to a third party directly.** The Deepgram Voice Agent websocket (`provider/agent-socket.ts:26`), the OpenAI Realtime WebRTC peer (`provider/duplex-line.ts:252-282`, with an ephemeral credential minted by q-api), ElevenLabs (`@elevenlabs/react`), Cloudflare Stream HLS playback, and Supabase Auth (`@supabase/ssr`).

## 3. Service route inventories

### 3.1 apps/api — hand-registered routes (219)

Path constants were resolved from `packages/contracts`. `<name>` / `${name}` are locally composed prefixes such as `/v1/companies/:companyId`, `/v1/onboarding/sessions/:id` and `/v1/companies/:companyId/pitch`.

```
    GET    /health/live  (app.ts:440)
    GET    /health/ready  (app.ts:442)
    GET    /v1/admin/accounts  (http/admin.ts:399)
    GET    /v1/admin/accounts/:userId  (http/admin.ts:413)
    POST   /v1/admin/accounts/:userId/suspension  (http/admin.ts:427)
    GET    /v1/admin/attribution  (http/admin.ts:350)
    GET    /v1/admin/audit  (http/admin.ts:799)
    GET    /v1/admin/billing/accounts/:organisationId  (http/admin-billing.ts:157)
    POST   /v1/admin/billing/accounts/:organisationId/overrides  (http/admin-billing.ts:233)
    POST   /v1/admin/billing/accounts/:organisationId/plan  (http/admin-billing.ts:174)
    POST   /v1/admin/billing/fee-rate  (http/admin-billing.ts:337)
    GET    /v1/admin/billing/fees  (http/admin-billing.ts:290)
    POST   /v1/admin/billing/fees/accrue  (http/admin-billing.ts:320)
    GET    /v1/admin/billing/fees/export  (http/admin-billing.ts:300)
    GET    /v1/admin/billing/usage  (http/admin-billing.ts:145)
    GET    /v1/admin/brand-theme  (http/brand-theme.ts:102)
    POST   /v1/admin/brand-theme  (http/brand-theme.ts:112)
    GET    /v1/admin/break-glass  (http/admin.ts:686)
    POST   /v1/admin/break-glass  (http/admin.ts:698)
    GET    /v1/admin/break-glass/:requestId/chat  (http/admin.ts:743)
    POST   /v1/admin/break-glass/:requestId/decision  (http/admin.ts:712)
    POST   /v1/admin/companies/:companyId/public-external  (http/admin.ts:1027)
    GET    /v1/admin/company-claims  (http/admin.ts:944)
    POST   /v1/admin/company-claims/:requestId/decision  (http/admin.ts:958)
    GET    /v1/admin/company-claims/:requestId/evidence  (http/admin.ts:1005)
    GET    /v1/admin/disputes  (http/admin.ts:362)
    GET    /v1/admin/email  (http/admin.ts:850)
    GET    /v1/admin/etiquette-guide  (http/etiquette.ts:146)
    POST   /v1/admin/etiquette-guide  (http/etiquette.ts:156)
    POST   /v1/admin/etiquette-guide/active  (http/etiquette.ts:179)
    GET    /v1/admin/flags  (http/admin.ts:818)
    POST   /v1/admin/flags/:key  (http/admin.ts:830)
    GET    /v1/admin/kyb/:submissionId/document  (http/admin.ts:620)
    GET    /v1/admin/me  (http/admin.ts:288)
    GET    /v1/admin/organisations  (http/admin.ts:458)
    GET    /v1/admin/organisations/:organisationId  (http/admin.ts:473)
    POST   /v1/admin/organisations/:organisationId/suspension  (http/admin.ts:489)
    GET    /v1/admin/overview  (http/admin.ts:340)
    GET    /v1/admin/paused  (http/admin.ts:372)
    POST   /v1/admin/paused/:userId/reinstate  (http/admin.ts:383)
    GET    /v1/admin/q/errors  (http/admin.ts:774)
    GET    /v1/admin/q/monitor  (http/admin.ts:761)
    GET    /v1/admin/q/runs/:runId  (http/admin.ts:784)
    GET    /v1/admin/reviews  (http/admin.ts:579)
    POST   /v1/admin/reviews/:reviewId/decision  (http/admin.ts:592)
    GET    /v1/admin/safety  (http/admin.ts:646)
    POST   /v1/admin/safety/reports/:reportId/review  (http/admin.ts:657)
    POST   /v1/admin/step-up  (http/admin.ts:303)
    GET    /v1/admin/team  (http/admin.ts:863)
    POST   /v1/admin/team  (http/admin.ts:912)
    DELETE /v1/admin/team/:userId  (http/admin.ts:924)
    GET    /v1/admin/verification/claims  (http/admin.ts:514)
    POST   /v1/admin/verification/claims/:claimId/decision  (http/admin.ts:526)
    POST   /v1/billing/checkout  (http/billing.ts:143)
    GET    /v1/billing/plan  (http/billing.ts:111)
    GET    /v1/billing/plans  (http/billing.ts:134)
    POST   /v1/billing/portal  (http/billing.ts:217)
    GET    /v1/brand-theme  (http/brand-theme.ts:91)
    GET    /v1/chat/unread  (http/chat.ts:107)
    POST   /v1/companies  (http/companies.ts:161)
    GET    /v1/companies/:companyId  (http/companies.ts:193)
    GET    /v1/companies/:companyId/claim-requests  (http/gateq.ts:432)
    POST   /v1/companies/:companyId/claim-requests/confirm  (http/gateq.ts:409)
    GET    /v1/companies/:companyId/data-room/folders/:folderCode/access  (http/company-material.ts:230)
    GET    /v1/companies/:companyId/marketplace-readiness  (http/companies.ts:217)
    POST   /v1/companies/:companyId/marketplace-readiness/assess  (http/companies.ts:251)
    GET    /v1/companies/:companyId/media  (http/media.ts:167)
    GET    /v1/companies/:companyId/network-preview  (http/companies.ts:275)
    GET    /v1/companies/:companyId/visibility/preview  (http/visibility.ts:59)
    GET    /v1/companies/:companyId/visibility/state  (http/visibility.ts:46)
    GET    /v1/companies/claimable  (http/gateq.ts:371)
    GET    /v1/data-room/documents/:documentId/access  (http/company-material.ts:217)
    GET    /v1/discovery/companies  (http/discovery.ts:235)
    GET    /v1/discovery/explore  (http/explore.ts:96)
    GET    /v1/discovery/explore/related/:mediaAssetId  (http/explore.ts:139)
    GET    /v1/discovery/explore/search  (http/explore.ts:163)
    POST   /v1/discovery/interactions  (http/recommendation-interactions.ts:103)
    GET    /v1/discovery/investors  (http/discovery.ts:599)
    GET    /v1/discovery/investors/:investorOrganisationId  (http/discovery.ts:627)
    GET    /v1/discovery/investors/:investorOrganisationId/photo  (http/discovery.ts:658)
    GET    /v1/discovery/network-pitches  (http/discovery.ts:352)
    GET    /v1/discovery/passed  (http/recommendation-interactions.ts:148)
    GET    /v1/discovery/saved  (http/recommendation-interactions.ts:133)
    GET    /v1/discovery/your-companies  (http/discovery.ts:446)
    GET    /v1/documents  (http/documents.ts:134)
    GET    /v1/documents/:documentId  (http/documents.ts:222)
    GET    /v1/documents/:documentId/file  (http/documents.ts:189)
    POST   /v1/gateq/apply  (http/gateq-apply.ts:175)
    POST   /v1/gateq/apply/answers  (http/gateq-apply.ts:266)
    POST   /v1/gateq/apply/materials  (http/gateq.ts:528)
    GET    /v1/gateq/apply/session  (http/gateq-apply.ts:219)
    POST   /v1/gateq/apply/submit  (http/gateq-apply.ts:286)
    POST   /v1/gateq/apply/turn  (http/gateq-apply.ts:231)
    POST   /v1/gateq/gateways  (http/gateq.ts:259)
    GET    /v1/gateq/gateways  (http/gateq.ts:301)
    GET    /v1/gateq/gateways/:gatewayId  (http/gateq.ts:598)
    GET    /v1/gateq/gateways/:gatewayId/applications  (http/gateq.ts:563)
    GET    /v1/gateq/gateways/:gatewayId/inbox  (http/gateq.ts:461)
    GET    /v1/gateq/gateways/:gatewayId/inbox/:applicationId  (http/gateq.ts:482)
    GET    /v1/gateq/gateways/:gatewayId/inbox/:applicationId/pack  (http/gateq.ts:501)
    POST   /v1/gateq/gateways/:gatewayId/qualify  (http/gateq.ts:686)
    GET    /v1/gateq/gateways/:gatewayId/versions  (http/gateq.ts:611)
    POST   /v1/gateq/gateways/:gatewayId/versions  (http/gateq.ts:624)
    PUT    /v1/gateq/gateways/:gatewayId/versions/:versionId  (http/gateq.ts:646)
    POST   /v1/gateq/gateways/:gatewayId/versions/:versionId/publish  (http/gateq.ts:672)
    GET    /v1/gateq/investor-gates  (http/gateq.ts:324)
    GET    /v1/gateq/my-applications  (http/gateq.ts:341)
    GET    /v1/gateq/public/:publicId  (http/gateq.ts:716)
    POST   /v1/inbound/email/postmark  (http/inbound-email.ts:147)
    GET    /v1/integrations/google  (http/integrations.ts:90)
    GET    /v1/integrations/google/callback  (http/integrations.ts:108)
    POST   /v1/integrations/google/gmail-push  (http/integrations.ts:147)
    GET    /v1/integrations/google/relationships/:relationshipId/mail  (http/integrations.ts:128)
    POST   /v1/investors  (http/investors.ts:69)
    GET    /v1/investors/current  (http/investors.ts:105)
    GET    /v1/invitations/preview  (http/team.ts:97)
    GET    /v1/kyb  (http/reviews-kyb.ts:63)
    GET    /v1/me  (http/me.ts:114)
    GET    /v1/me/etiquette-guide  (http/etiquette.ts:103)
    GET    /v1/me/inbound-email  (http/inbound-email.ts:97)
    GET    /v1/me/organisations  (http/team.ts:85)
    GET    /v1/me/profile  (http/me.ts:103)
    GET    /v1/meetings/:meetingId/brief  (http/schedule.ts:144)
    POST   /v1/network/commitments/:commitmentId/adopt  (http/commitments.ts:238)
    POST   /v1/network/commitments/:commitmentId/confirm  (http/commitments.ts:208)
    POST   /v1/network/commitments/:commitmentId/dispute  (http/commitments.ts:262)
    POST   /v1/network/commitments/:commitmentId/withdraw  (http/commitments.ts:222)
    GET    /v1/network/commitments/mine  (http/commitments.ts:399)
    GET    /v1/network/companies/:companyId/fundraising  (http/commitments.ts:455)
    GET    /v1/network/companies/:companyId/incoming-interest  (http/network-interests.ts:293)
    GET    /v1/network/companies/:companyId/interest  (http/network-interests.ts:124)
    GET    /v1/network/companies/:companyId/relationship  (http/network-interests.ts:140)
    GET    /v1/network/companies/:companyId/relationships  (http/network-interests.ts:273)
    GET    /v1/network/connection-requests  (http/network-interests.ts:348)
    GET    /v1/network/investors/:investorOrganisationId/connection  (http/network-interests.ts:327)
    GET    /v1/network/investors/:investorOrganisationId/relationship  (http/network-interests.ts:154)
    GET    /v1/network/pass-reasons  (http/network-interests.ts:176)
    GET    /v1/network/relationships  (http/network-interests.ts:256)
    GET    /v1/network/relationships/:relationshipId/audit-export  (http/deal-close.ts:118)
    GET    /v1/network/relationships/:relationshipId/commitments  (http/commitments.ts:158)
    POST   /v1/network/relationships/:relationshipId/commitments  (http/commitments.ts:178)
    GET    /v1/network/relationships/:relationshipId/deal  (http/deal-close.ts:77)
    GET    /v1/network/relationships/:relationshipId/diligence  (http/network-interests.ts:211)
    GET    /v1/network/relationships/:relationshipId/diligence/documents/:documentId/download  (http/network-interests.ts:228)
    GET    /v1/network/relationships/:relationshipId/pass  (http/network-interests.ts:186)
    GET    /v1/network/relationships/:relationshipId/reports/:reportId/pdf  (http/deal-close.ts:90)
    GET    /v1/notifications  (http/schedule.ts:176)
    POST   /v1/notifications/read  (http/schedule.ts:246)
    GET    /v1/notifications/settings  (http/push.ts:80)
    POST   /v1/organisations  (http/organisations.ts:89)
    GET    /v1/organisations  (http/organisations.ts:121)
    GET    /v1/organisations/:organisationId  (http/organisations.ts:148)
    PATCH  /v1/organisations/:organisationId  (http/organisations.ts:162)
    POST   /v1/organisations/:organisationId/activate  (http/organisations.ts:183)
    GET    /v1/public/cards/:code  (http/q-cards.ts:135)
    GET    /v1/public/handles/:handle  (http/q-cards.ts:110)
    GET    /v1/push/key  (http/push.ts:41)
    PUT    /v1/push/subscription  (http/push.ts:46)
    POST   /v1/push/subscription/remove  (http/push.ts:66)
    GET    /v1/readiness  (http/readiness.ts:35)
    POST   /v1/relationships/:relationshipId/meeting-slots  (http/schedule.ts:114)
    GET    /v1/relationships/:relationshipId/meetings  (http/schedule.ts:95)
    GET    /v1/relationships/:relationshipId/messages  (http/chat.ts:53)
    GET    /v1/relationships/:relationshipId/messages/:messageId/attachment  (http/chat.ts:93)
    POST   /v1/relationships/:relationshipId/messages/read  (http/chat.ts:73)
    GET    /v1/reminders  (http/schedule.ts:165)
    GET    /v1/results  (http/results.ts:51)
    GET    /v1/results/report  (http/results.ts:73)
    GET    /v1/reviews  (http/reviews-kyb.ts:55)
    POST   /v1/taxonomy/candidates  (http/taxonomy.ts:76)
    GET    /v1/taxonomy/nodes/:nodeId  (http/taxonomy.ts:129)
    GET    /v1/team  (http/team.ts:62)
    POST   /v1/webhooks/cloudflare-stream  (http/media-webhooks.ts:106)
    POST   /v1/webhooks/stripe  (http/billing.ts:297)
    GET    <base>  (http/capital-objectives.ts:65)
    GET    <base>  (http/investor-mandates.ts:61)
    GET    <byId>  (http/capital-objectives.ts:99)
    GET    <byId>  (http/investor-mandates.ts:81)
    GET    <byId>  (http/investors.ts:119)
    GET    <byId>  (http/onboarding.ts:153)
    GET    <cardPath>  (http/q-cards.ts:89)
    GET    <pitch>  (http/media.ts:156)
    GET    <sessionById>  (http/documents.ts:118)
    POST   <sessions>  (http/onboarding.ts:105)
    GET    <subjectPath>  (http/profile-images.ts:65)
    GET    <vocabularies>  (http/taxonomy.ts:91)
    GET    ${base}/assumptions  (http/company-material.ts:163)
    GET    ${base}/current  (http/capital-objectives.ts:86)
    GET    ${base}/data-room  (http/company-material.ts:101)
    GET    ${base}/data-room/documents/:documentId/open  (http/company-material.ts:116)
    GET    ${base}/deck  (http/company-material.ts:131)
    GET    ${base}/deck/open  (http/company-material.ts:145)
    GET    ${base}/founder-profile/me  (http/company-team.ts:68)
    GET    ${base}/founders/:position  (http/company-material.ts:252)
    GET    ${base}/profile  (http/company-profile.ts:295)
    GET    ${base}/profile/deck/download  (http/company-profile.ts:426)
    GET    ${base}/profile/photo  (http/company-profile.ts:413)
    GET    ${base}/questions  (http/company-material.ts:203)
    GET    ${base}/requests  (http/company-material.ts:189)
    GET    ${base}/team-facts  (http/company-team.ts:84)
    GET    ${base}/team/me  (http/company-team.ts:52)
    GET    ${base}/verification  (http/verification.ts:48)
    POST   ${byId}/back  (http/onboarding.ts:162)
    GET    ${byId}/network-preview  (http/investors.ts:138)
    GET    ${byId}/representatives/me  (http/investors.ts:154)
    POST   ${byId}/say  (http/onboarding.ts:189)
    GET    ${byId}/turns  (http/onboarding.ts:255)
    POST   ${byId}/turns  (http/onboarding.ts:276)
    GET    ${COMPANIES_PATH}/:companyId/capital-ledger  (http/commitments.ts:280)
    GET    ${COMPANY_CAPITAL_ROUND_PATH}${CAPITAL_ROUND_HISTORY_SUFFIX}  (http/commitments.ts:367)
    GET    ${nudgePath}/briefing  (http/onboarding.ts:308)
    POST   ${nudgePath}/briefing  (http/onboarding.ts:319)
    GET    ${pitch}/:mediaAssetId/captions.vtt  (http/media.ts:335)
    GET    ${pitch}/:mediaAssetId/download  (http/media.ts:250)
    POST   ${pitch}/:mediaAssetId/playback  (http/media.ts:225)
    POST   ${pitch}/:mediaAssetId/sync  (http/media.ts:194)
    GET    ${pitch}/:mediaAssetId/transcript  (http/media.ts:316)
    GET    ${sessions}/current  (http/onboarding.ts:131)
    GET    ${vocabularies}/:vocabularyCode/nodes  (http/taxonomy.ts:98)
```

### 3.2 apps/api — registry-generated mutation routes (131, ADR 0040)

`registerAppActionRoutes` (`apps/api/src/http/app-actions.ts:156-200`) mounts every `APP_ACTIONS` entry that has an `http` block. Each request is parsed with Zod, gets `actor` from `getActorContext`, then `action.authorize(ports, context, input)`; a deny returns `callNotFound()` (404, not 403) and an allow calls `action.run`. `idempotencyKey` is `http.idempotencyKeyOf?.(input) ?? request.id` (`app-actions.ts:180`); most consequential actions carry the client `Idempotency-Key` header in their input (e.g. `packages/app-actions/src/actions/chat.ts:52,98`). Person-scoped variants run under the onboarding actor (`app-actions.ts:211-245`). The same registry is exposed to Q as tools (`packages/q-tools` depends on `app-actions`). `[idem]` marks actions declaring `idempotencyKeyOf`.

```
    PATCH  /v1/companies/:companyId  company.profile.update  (actions/records.ts:554)
    POST   /v1/companies/:companyId/capital-rounds  capital.round.open  (actions/commitments.ts:139)
    PATCH  /v1/companies/:companyId/capital-rounds/:roundId  capital.round.revise  (actions/rounds.ts:139)
    POST   /v1/companies/:companyId/capital-rounds/:roundId/close  capital.round.close  (actions/commitments.ts:179)
    POST   /v1/companies/:companyId/capital-rounds/:roundId/steps  capital.round.step  (actions/rounds.ts:180)
    POST   /v1/companies/:companyId/claim-requests  company.claim.request [idem]  (actions/gateq-find.ts:132)
    POST   /v1/companies/:companyId/claim-requests/:requestId/decision  company.claim.decide  (actions/gateq-find.ts:328)
    POST   /v1/companies/:companyId/claim-requests/evidence  company.claim.evidence.upload  (actions/gateq-find.ts:177)
    POST   /v1/companies/:companyId/claim-requests/evidence/complete  company.claim.evidence.complete  (actions/gateq-find.ts:209)
    POST   /v1/companies/:companyId/data-room/folders/:folderCode/grants  document.access.share_folder  (actions/founder-documents.ts:561)
    POST   /v1/companies/:companyId/data-room/folders/:folderCode/level  document.access.folder_level  (actions/founder-documents.ts:618)
    PUT    /v1/companies/:companyId/data-room/outline  data_room.outline.set  (actions/data-room.ts:430)
    POST   /v1/companies/:companyId/data-room/requests  data_room.access.request  (actions/data-room.ts:305)
    PATCH  /v1/companies/:companyId/founder-profile/me  company.founder_profile.me.update  (actions/records.ts:698)
    POST   /v1/companies/:companyId/pitch/:mediaAssetId/details  pitch.details.set  (actions/pitch.ts:235)
    PATCH  /v1/companies/:companyId/team-facts  company.team_facts.update  (actions/records.ts:753)
    PUT    /v1/companies/:companyId/team/me  company.team.me.upsert  (actions/records.ts:626)
    POST   /v1/companies/:companyId/verification/requests  verification.company.request  (actions/settings.ts:280)
    POST   /v1/companies/:companyId/visibility  company.visibility.set  (actions/visibility.ts:108)
    POST   /v1/companies/:companyId/visibility/shares  disclosure.raise.share  (actions/visibility.ts:316)
    POST   /v1/companies/:companyId/visibility/shares/:policyId/revoke  disclosure.share.revoke  (actions/visibility.ts:447)
    POST   /v1/data-room/documents/:documentId/grants  document.access.share  (actions/founder-documents.ts:464)
    POST   /v1/data-room/documents/:documentId/level  data_room.document.level.set  (actions/data-room.ts:183)
    POST   /v1/data-room/grants/:policyId/revoke  document.access.revoke  (actions/founder-documents.ts:698)
    POST   /v1/data-room/requests/:requestId/decision  data_room.request.decide  (actions/data-room.ts:526)
    POST   /v1/diligence-questions/:questionId/answer  diligence.question.answer  (actions/founder-documents.ts:814)
    POST   /v1/document-requests/:requestId/decline  document_request.decline  (actions/founder-documents.ts:331)
    POST   /v1/document-requests/:requestId/fulfil  document_request.fulfil  (actions/founder-documents.ts:202)
    PATCH  /v1/documents/:documentId  document.rename  (actions/document-manage.ts:121)
    POST   /v1/documents/:documentId/archive  document.archive  (actions/document-manage.ts:221)
    POST   /v1/documents/:documentId/deck-extractions/:extractionId/confirm  deck.extraction.confirm  (actions/data-room.ts:656)
    POST   /v1/documents/:documentId/deck-extractions/:extractionId/read-again  deck.read_again  (actions/data-room.ts:935)
    POST   /v1/documents/:documentId/deck-extractions/:extractionId/sections/:section/review  deck.section.review  (actions/data-room.ts:835)
    POST   /v1/documents/:documentId/download-audience  document.deck_audience.set  (actions/deck.ts:143)
    POST   /v1/documents/upload-sessions  document.upload.start  (actions/documents.ts:109)
    POST   /v1/gateq/gateways/:gatewayId/inbox/:applicationId/notes  gateq.inbox.note [idem]  (actions/gateq-inbox.ts:559)
    POST   /v1/gateq/gateways/:gatewayId/inbox/:applicationId/pass  gateq.inbox.pass [idem]  (actions/gateq-inbox.ts:713)
    POST   /v1/gateq/gateways/:gatewayId/inbox/:applicationId/reply  gateq.inbox.reply [idem]  (actions/gateq-inbox.ts:759)
    POST   /v1/gateq/gateways/:gatewayId/inbox/archive  gateq.inbox.archive  (actions/gateq-inbox.ts:347)
    POST   /v1/gateq/gateways/:gatewayId/inbox/assign  gateq.inbox.assign  (actions/gateq-inbox.ts:483)
    POST   /v1/gateq/gateways/:gatewayId/inbox/label  gateq.inbox.label  (actions/gateq-inbox.ts:414)
    PUT    /v1/gateq/gateways/:gatewayId/inbox/settings  gateq.inbox.reply_promise  (actions/gateq-inbox.ts:637)
    POST   /v1/gateq/gateways/:gatewayId/inbox/star  gateq.inbox.star  (actions/gateq-inbox.ts:283)
    POST   /v1/gateq/gateways/:gatewayId/policy-extractions  gateway.policy.read_mandate [idem]  (actions/gateq.ts:70)
    POST   /v1/gateq/startup-alerts  gateq.startup_alert.save [idem]  (actions/gateq-find.ts:247)
    DELETE /v1/integrations/google  integrations.google.disconnect  (actions/settings.ts:189)
    POST   /v1/integrations/google/connect  integrations.google.connect  (actions/settings.ts:153)
    PATCH  /v1/investors/:investorOrganisationId  investor.profile.update  (actions/records.ts:822)
    POST   /v1/investors/:investorOrganisationId/mandates/:mandateId/suggestions/:suggestionId/apply  investor.mandate.suggestion.apply  (actions/investor-promises.ts:377)
    PUT    /v1/investors/:investorOrganisationId/representatives/me  investor.representative.me.upsert  (actions/records.ts:903)
    POST   /v1/investors/:investorOrganisationId/visibility  investor.visibility.set  (actions/visibility.ts:198)
    POST   /v1/invitations/accept  team.invitation.accept  (actions/team.ts:648)
    POST   /v1/join-requests  team.join_request.create  (actions/team.ts:679)
    POST   /v1/kyb  verification.kyb.submit  (actions/settings.ts:447)
    PATCH  /v1/me  person.name.set  (actions/me.ts:75)
    PUT    /v1/me/etiquette-guide  settings.etiquette_guide.save  (actions/etiquette.ts:127)
    DELETE /v1/me/etiquette-guide/versions  settings.etiquette_guide.remove  (actions/etiquette.ts:194)
    POST   /v1/me/inbound-email/rotate  integrations.inbound_email.rotate  (actions/settings.ts:234)
    PATCH  /v1/me/profile  person.profile.edit  (actions/me.ts:115)
    POST   /v1/meetings/:meetingId/cancel  schedule.meeting.cancel  (actions/schedule.ts:206)
    POST   /v1/network/commitments/:commitmentId/amount-confirmation  capital.commitment.confirm_amount  (actions/commitments.ts:331)
    POST   /v1/network/commitments/:commitmentId/receipt  capital.commitment.confirm_received  (actions/commitments.ts:417)
    POST   /v1/network/commitments/:commitmentId/transfer  capital.commitment.mark_sent  (actions/commitments.ts:372)
    POST   /v1/network/companies/:companyId/express-interest  relationship.interest.express  (actions/interest.ts:111)
    POST   /v1/network/investors/:investorOrganisationId/connection-request  relationship.connection_request.send  (actions/interest.ts:273)
    POST   /v1/network/relationships/:relationshipId/deal/checklist  relationship.deal.checklist  (actions/deal-close.ts:558)
    POST   /v1/network/relationships/:relationshipId/deal/close  relationship.deal.close [idem]  (actions/deal-close.ts:305)
    POST   /v1/network/relationships/:relationshipId/deal/signed  relationship.deal.signed [idem]  (actions/deal-close.ts:238)
    POST   /v1/network/relationships/:relationshipId/deal/terms  relationship.deal.terms [idem]  (actions/deal-close.ts:187)
    POST   /v1/network/relationships/:relationshipId/diligence/requests  diligence.document.request  (actions/diligence.ts:233)
    POST   /v1/network/relationships/:relationshipId/diligence/requests/:requestId/fulfil  diligence.request.fulfil  (actions/diligence.ts:292)
    POST   /v1/network/relationships/:relationshipId/diligence/requests/:requestId/upload  diligence.request.upload_fulfil  (actions/diligence.ts:361)
    POST   /v1/network/relationships/:relationshipId/diligence/shares  diligence.document.share  (actions/diligence.ts:119)
    POST   /v1/network/relationships/:relationshipId/diligence/shares/:policyId/revoke  diligence.document.revoke  (actions/diligence.ts:172)
    POST   /v1/network/relationships/:relationshipId/meeting-outcome  relationship.outcome.meeting  (actions/outcomes.ts:364)
    POST   /v1/network/relationships/:relationshipId/pass  relationship.outcome.pass  (actions/outcomes.ts:203)
    POST   /v1/network/relationships/:relationshipId/reports  relationship.report.generate [idem]  (actions/deal-close.ts:484)
    PUT    /v1/notifications/settings  settings.notifications.set  (actions/settings.ts:97)
    POST   /v1/onboarding/nudge/choice  onboarding.reminders.choose  (actions/onboarding.ts:313)
    POST   /v1/profile-images/uploads/:uploadId/complete  profile_image.upload.complete  (actions/profile-images.ts:117)
    PATCH  /v1/q-cards/:subjectType/:subjectId  q_card.update  (actions/records.ts:1050)
    PUT    /v1/q-cards/:subjectType/:subjectId/handle  q_card.handle.claim  (actions/records.ts:967)
    POST   /v1/q/work/:delegationId/delegation  q.work.delegation.set  (actions/work.ts:149)
    POST   /v1/q/work/:delegationId/pause  q.work.pause  (actions/work.ts:71)
    POST   /v1/q/work/:delegationId/resume  q.work.resume  (actions/work.ts:97)
    POST   /v1/q/work/suggestions/dismissals  q.work.suggestion.dismiss  (actions/work.ts:183)
    POST   /v1/readiness/actions/:actionKey/state  readiness.action.state  (actions/readiness.ts:150)
    POST   /v1/readiness/questions/:questionId/answer  readiness.question.answer [idem]  (actions/readiness.ts:270)
    POST   /v1/readiness/questions/:questionId/dismiss  readiness.question.dismiss [idem]  (actions/readiness.ts:388)
    POST   /v1/relationships/:relationshipId/diligence/questions  diligence.questions.send  (actions/investor-promises.ts:242)
    POST   /v1/relationships/:relationshipId/meetings  schedule.meeting.book  (actions/schedule.ts:167)
    POST   /v1/relationships/:relationshipId/meetings/join  schedule.meeting.join  (actions/schedule.ts:354)
    POST   /v1/relationships/:relationshipId/messages  chat.message.send  (actions/chat.ts:94)
    POST   /v1/relationships/:relationshipId/messages/reports  chat.report  (actions/chat.ts:181)
    POST   /v1/reminders  schedule.reminder.create  (actions/schedule.ts:249)
    POST   /v1/reminders/:reminderId/dismiss  schedule.reminder.dismiss  (actions/schedule.ts:280)
    POST   /v1/reviews  review.request  (actions/settings.ts:331)
    POST   /v1/team/invitations  team.invite  (actions/team.ts:201)
    DELETE /v1/team/invitations/:invitationId  team.invitation.revoke  (actions/team.ts:433)
    POST   /v1/team/invitations/:invitationId/resend  team.invitation.resend  (actions/team.ts:402)
    POST   /v1/team/join-requests/:requestId/decision  team.join_request.decide  (actions/team.ts:603)
    POST   /v1/team/leave  team.leave  (actions/team.ts:498)
    POST   /v1/team/members/:membershipId/remove  team.member.remove  (actions/team.ts:466)
    PUT    /v1/team/members/:membershipId/role  team.member.role.set  (actions/team.ts:336)
    POST   /v1/team/ownership-offers  team.ownership.offer  (actions/team.ts:531)
    POST   /v1/team/ownership-offers/:offerId/response  team.ownership.respond  (actions/team.ts:566)
    POST   <accept>  relationship.interest.express  (actions/interest.ts:208)
    POST   <accept>  relationship.connection_request.send  (actions/interest.ts:353)
    POST   <base>  capital.objective.create  (actions/capital.ts:185)
    POST   <base>  investor.mandate.create  (actions/mandate.ts:161)
    PATCH  <byId>  capital.objective.update  (actions/capital.ts:227)
    POST   <decision.path>  discovery.company.unpass [idem]  (actions/discovery.ts:146)
    POST   <definition.path>  chat.message.send  (actions/chat.ts:140)
    POST   <pause>  relationship.outcome.pass  (actions/outcomes.ts:270)
    POST   <pitch>  pitch.create  (actions/media.ts:135)
    POST   ${byId}/close  capital.objective.close  (actions/capital.ts:267)
    POST   ${byId}/complete  onboarding.complete  (actions/onboarding.ts:181)
    POST   ${byId}/questions/:questionId${dismiss ? ONBOARDING_DISMISS_SEGMENT : ONBOARDING_ANSWER_SEGMENT}  onboarding.suggestion.resolve  (actions/onboarding.ts:280)
    POST   ${byId}/replace  capital.objective.replace  (actions/capital.ts:311)
    POST   ${byId}/steps/:stepKey${withdraw ? ONBOARDING_WITHDRAW_SEGMENT : ONBOARDING_SKIP_SEGMENT}  ?  (actions/onboarding.ts:144)
    POST   ${byId}/suggestions/:suggestionId/resolve  onboarding.suggestion.resolve  (actions/onboarding.ts:220)
    POST   ${byId}${activate ? INVESTOR_MANDATE_ACTIVATE_SUFFIX : INVESTOR_MANDATE_CLOSE_SUFFIX}  investor.mandate.update  (actions/mandate.ts:256)
    POST   ${byId}${revision ? ONBOARDING_REVISIONS_SEGMENT : ONBOARDING_RESPONSES_SEGMENT}  ?  (actions/onboarding.ts:100)
    DELETE ${pitch}/:mediaAssetId  pitch.delete  (actions/media.ts:178)
    POST   ${pitch}/:mediaAssetId/playback-policy  pitch.playback_policy.set  (actions/media.ts:334)
    POST   ${pitch}/:mediaAssetId/upload-session  pitch.upload.start  (actions/media.ts:238)
    POST   ${pitch}/:mediaAssetId/upload-session/cancel  pitch.upload.cancel  (actions/media.ts:292)
    POST   ${sessionById}/cancel  document.upload.cancel  (actions/documents.ts:212)
    POST   ${sessionById}/complete  document.upload.complete  (actions/documents.ts:161)
    DELETE ${subjectPath}/:kind  profile_image.remove  (actions/profile-images.ts:152)
    POST   ${subjectPath}/:kind/uploads  profile_image.upload.start  (actions/profile-images.ts:80)
```

### 3.3 apps/q-api routes (98 hand-registered; several register conditionally)

`apps/q-api/src/app.ts` registers 29 route groups, about 25 of them behind `if (dependencies.X !== undefined)`. A module that is not composed (missing provider key, missing port) means its routes do not exist and return 404, not 503.

```
    GET    /health/live  (app.ts:763)
    GET    /health/ready  (app.ts:765)
    GET    /v1/discovery/slates/:slateId/companies/:companyId/explanation  (http/recommendation-explanations.ts:48)
    GET    /v1/fit/companies  (http/fit.ts:64)
    GET    /v1/fit/companies/:companyId  (http/fit.ts:89)
    GET    /v1/fit/companies/:companyId/q-view  (http/fit.ts:107)
    GET    /v1/fit/compare  (http/investor-promises.ts:46)
    GET    /v1/fit/thesis  (http/investor-promises.ts:74)
    GET    /v1/fit/top  (http/fit.ts:129)
    POST   /v1/mcp  (http/q-mcp.ts:52)
    POST   /v1/q/answer-exports  (http/q-documents.ts:324)
    GET    /v1/q/approvals  (http/q-approvals.ts:154)
    GET    /v1/q/artifacts  (http/q-artifacts.ts:296)
    GET    /v1/q/brand-kit  (http/q-documents.ts:146)
    POST   /v1/q/brand-kit  (http/q-documents.ts:164)
    POST   /v1/q/brand-kit/confirm  (http/q-documents.ts:255)
    GET    /v1/q/brand-kit/logo  (http/q-documents.ts:295)
    POST   /v1/q/brand-kit/suggest  (http/q-documents.ts:220)
    POST   /v1/q/briefing/command  (http/briefing-command.ts:30)
    GET    /v1/q/conversations  (http/q-conversations.ts:75)
    GET    /v1/q/daily  (http/daily.ts:65)
    GET    /v1/q/daily/editions/:editionId  (http/daily.ts:76)
    GET    /v1/q/daily/editions/:editionId/pdf  (http/daily.ts:89)
    GET    /v1/q/daily/preferences  (http/daily.ts:128)
    PUT    /v1/q/daily/preferences  (http/daily.ts:139)
    POST   /v1/q/daily/requests  (http/daily.ts:163)
    DELETE /v1/q/errands/:errandId  (http/errands.ts:67)
    GET    /v1/q/investors/:investorOrganisationId/rehearsals  (http/rehearsals.ts:290)
    GET    /v1/q/meetings/:meetingId/assistant  (http/meeting-assistant.ts:90)
    POST   /v1/q/meetings/:meetingId/assistant  (http/meeting-assistant.ts:106)
    DELETE /v1/q/meetings/:meetingId/assistant  (http/meeting-assistant.ts:140)
    GET    /v1/q/memory  (http/memory.ts:38)
    POST   /v1/q/memory/:memoryItemId/forget  (http/memory.ts:53)
    PUT    /v1/q/presence  (http/work.ts:400)
    GET    /v1/q/profile-findings  (http/profile-findings.ts:32)
    POST   /v1/q/readiness-blueprints  (http/readiness-blueprint.ts:59)
    POST   /v1/q/rehearsals  (http/rehearsals.ts:152)
    GET    /v1/q/rehearsals  (http/rehearsals.ts:220)
    GET    /v1/q/rehearsals/:rehearsalId  (http/rehearsals.ts:306)
    POST   /v1/q/rehearsals/:rehearsalId/finish  (http/rehearsals.ts:380)
    POST   /v1/q/rehearsals/:rehearsalId/screen  (http/rehearsals.ts:342)
    POST   /v1/q/rehearsals/:rehearsalId/turns  (http/rehearsals.ts:320)
    GET    /v1/q/rehearsals/meetings/:meetingId  (http/rehearsals.ts:272)
    GET    /v1/q/rehearsals/partners  (http/rehearsals.ts:231)
    GET    /v1/q/rehearsals/persona/:counterpartKind/:counterpartId  (http/rehearsals.ts:242)
    GET    /v1/q/relationships/:relationshipId/errands  (http/errands.ts:43)
    GET    /v1/q/room  (room/routes.ts:38)
    POST   /v1/q/runs  (http/q-runs.ts:111)
    GET    /v1/q/standing  (http/standing.ts:44)
    PUT    /v1/q/standing/personality  (http/standing.ts:62)
    GET    /v1/q/usage  (http/usage.ts:18)
    POST   /v1/q/voice/sessions  (voice/routes.ts:551)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/end  (voice/duplex/routes.ts:212)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/heard  (voice/duplex/routes.ts:92)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/narration  (voice/duplex/routes.ts:162)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/rejoin  (voice/duplex/routes.ts:190)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/said  (voice/duplex/routes.ts:120)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/tool  (voice/duplex/routes.ts:62)
    POST   /v1/q/voice/sessions/:voiceSessionId/duplex/usage  (voice/duplex/routes.ts:139)
    POST   /v1/q/voice/sessions/:voiceSessionId/screen  (voice/routes.ts:274)
    GET    /v1/q/voice/sessions/:voiceSessionId/turn  (voice/routes.ts:230)
    POST   /v1/q/voice/speak  (voice/routes.ts:398)
    POST   /v1/q/voice/speech  (voice/routes.ts:323)
    GET    /v1/q/work  (http/work.ts:229)
    GET    /v1/q/work/:delegationId  (http/work.ts:291)
    DELETE /v1/q/work/:delegationId  (http/work.ts:313)
    DELETE /v1/q/work/:delegationId/lanes/:laneId  (http/work.ts:330)
    POST   /v1/q/work/:delegationId/lanes/:laneId/answer  (http/work.ts:347)
    GET    /v1/q/work/:delegationId/lanes/:laneId/report  (http/work.ts:369)
    GET    /v1/q/work/done  (http/work.ts:270)
    GET    /v1/q/work/since  (http/work.ts:255)
    GET    /v1/q/work/suggestions  (http/work.ts:243)
    POST   /v1/q/workforce/drafts/:draftId/retry  (http/workforce.ts:126)
    GET    /v1/q/workforce/jobs  (http/workforce.ts:77)
    GET    /v1/q/workforce/jobs/:jobId  (http/workforce.ts:107)
    GET    /v1/q/workforce/overview  (http/workforce.ts:93)
    GET    <approvalPath>  (http/q-approvals.ts:193)
    GET    <artifactPath>  (http/q-artifacts.ts:310)
    GET    <conversationPath>  (http/q-conversations.ts:100)
    POST   <dependencies.path>  (voice/interview-route.ts:77)
    POST   <dependencies.path>  (voice/think.ts:399)
    GET    <eventsPath>  (http/q-events.ts:197)
    POST   <MEETING_HOST_WEBHOOK_PATH>  (http/meeting-host.ts:49)
    GET    <runPath>  (http/q-runs.ts:165)
    POST   ${approvalPath}/approve  (http/q-approvals.ts:204)
    GET    ${approvalPath}/email-draft  (http/q-approvals.ts:315)
    POST   ${approvalPath}/email-draft  (http/q-approvals.ts:329)
    POST   ${approvalPath}/reject  (http/q-approvals.ts:270)
    GET    ${artifactPath}/export/:format  (http/q-artifacts.ts:428)
    POST   ${artifactPath}/placeholders  (http/q-artifacts.ts:524)
    GET    ${artifactPath}/progress  (http/q-artifacts.ts:494)
    GET    ${artifactPath}/slides  (http/q-artifacts.ts:375)
    GET    ${artifactPath}/versions/:version  (http/q-artifacts.ts:615)
    POST   ${conversationPath}/archive  (http/q-conversations.ts:115)
    POST   ${conversationPath}/messages/:messageId/hide  (http/q-conversations.ts:130)
    POST   ${dependencies.path}/chat/completions  (voice/think.ts:400)
    POST   ${runPath}/cancel  (http/q-runs.ts:207)
    POST   ${runPath}/messages  (http/q-runs.ts:175)
```

Unresolved local prefixes: `approvalPath = /v1/q/approvals/:approvalId`, `artifactPath = /v1/q/artifacts/:artifactId`, `conversationPath = /v1/q/conversations/:conversationId`, `runPath = /v1/q/runs/:runId`, `eventsPath = /v1/q/runs/:runId/events` (SSE), and `dependencies.path` = the voice "think" endpoint (OpenAI-compatible `/chat/completions` that ElevenLabs/Deepgram call back) and the interview route. These names were inferred from the contracts constants (`Q_RUNS_PATH`, `Q_RUN_EVENTS_SUFFIX`) imported in `apps/web/app/api/q-stream/.../route.ts:3-8`; the exact constant values were not all opened.

## 4. Authentication, actor context and sessions

Evidence: `evidence/architecture/auth-*.md`. Diagram: `diagrams/auth-permission-boundaries.md`.

| Layer                       | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Location                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Browser ↔ web               | Supabase Auth cookie session through `@supabase/ssr`. Cookies are `httpOnly`, `sameSite=lax`, `secure` per config (`apps/web/src/auth/cookie-options.ts:14-22`). `proxy.ts` refreshes the session and protects routes on its matcher (`apps/web/proxy.ts:14-48`)                                                                                                                                                                                                                                                                         | `apps/web/src/auth/*`                |
| Web server identity         | `getSessionUser` uses `supabase.auth.getClaims()`, verified locally with no Auth round trip (`apps/web/src/auth/session.ts`). `getSessionAccessToken` reads `getSession().access_token` for forwarding                                                                                                                                                                                                                                                                                                                                   | `session.ts`                         |
| Web → api/q-api             | `Authorization: Bearer <Supabase access token>` from the cookie session; never from client JS                                                                                                                                                                                                                                                                                                                                                                                                                                            | `packages/api-client/src/request.ts` |
| api / q-api authn           | `createSupabaseRequestAuthenticator` is bearer-only and reads no cookies (`apps/api/src/security/supabase-authenticator.ts:20-37`). It calls `client.auth.getUser(token)`, a **network call to Supabase Auth on every protected request, uncached** (`packages/security/src/supabase/access-token-authenticator.ts:69-89`)                                                                                                                                                                                                               | duplicated in both apps              |
| Actor context               | `requireActorContextHook`: authenticate → parse the `ORGANISATION_CONTEXT_HEADER` selector → `requireHumanActorContext(resolver)` against the DB (`packages/security/src/postgres/actor-context-resolver.ts`) → `request.actorContext`. Tenant, membership, role and actor-type headers are never read (`apps/api/src/security/actor-context.ts:78-137`)                                                                                                                                                                                 | api, q-api                           |
| Personal context            | q-api only: `requireActorContextOrPersonalHook` gives a person with no organisation a `personalActorContext(userId)` under a well-known personal tenant (`apps/q-api/src/security/actor-context.ts:141-215`)                                                                                                                                                                                                                                                                                                                             | q-api                                |
| Onboarding actor            | `apps/api/src/security/onboarding-actor.ts`: a person-only context for person-scoped app actions                                                                                                                                                                                                                                                                                                                                                                                                                                         | api                                  |
| Authorization               | `AuthorizationService` with capability/role policies from `permissions.*` (`packages/security/src/authorization/*`, `packages/security/src/postgres/authorization-policy-source.ts`), and per-action `authorize()` in `packages/app-actions`                                                                                                                                                                                                                                                                                             | packages                             |
| Suspension                  | `apps/api/src/security/suspension.ts`, `apps/q-api/src/composition/suspension.ts`; `q_runtime.person_standing.suspended_at`                                                                                                                                                                                                                                                                                                                                                                                                              |                                      |
| Admin step-up / break-glass | `/v1/admin/step-up`, `/v1/admin/break-glass*` (`apps/api/src/http/admin.ts:303,686-743`); `platform_ops.step_ups`, `break_glass_*`                                                                                                                                                                                                                                                                                                                                                                                                       | api                                  |
| Voice line binding          | A sealed **AES-256-GCM token** carries the resolved binding, _including the person's Supabase access token_, header `x-q-voice-session`, TTL 4 h (`apps/q-api/src/voice/session-token.ts:20-52`). The key is HKDF-derived from `SUPABASE_SECRET_KEY`, **or from `DATABASE_URL` when that is absent** (`apps/q-api/src/main.ts:5111-5114`). `.railway/railway.ts` declares no `SUPABASE_SECRET_KEY` for q-api (`railway.ts:166-184`), so in the declared configuration the voice token key is derived from the database connection string | q-api                                |
| Webhooks                    | Cloudflare Stream (`/v1/webhooks/cloudflare-stream`), Stripe (`/v1/webhooks/stripe`), Postmark inbound (`/v1/inbound/email/postmark`), Gmail Pub/Sub push (`/v1/integrations/google/gmail-push`), Recall meeting host (`MEETING_HOST_WEBHOOK_PATH`, `apps/q-api/src/http/meeting-host.ts:49`). Each verifies its own secret (`CLOUDFLARE_STREAM_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `INBOUND_EMAIL_WEBHOOK_SECRET`, `GOOGLE_PUBSUB_PUSH_*`, `RECALL_WEBHOOK_SECRET`). The webhook verifiers' internals were not inspected by A     |                                      |

Sessions in services are stateless (bearer per request). The only server-held session state is voice lines (sealed token plus an in-memory cache, `apps/q-api/src/voice/bindings.ts:28,130`), duplex lines, meeting-host sessions (`composition/meeting-host-runtime.ts:51`) and rehearsal frames. All of these are process-local (§6).

## 5. Storage, video and caching

- **Supabase Storage**: 4 buckets (`cq-documents-private`, `cq-extractions-private`, `cq-document-images`, `cq-profile-images`), created in migrations; 4 rows live. Access uses the privileged `SUPABASE_SECRET_KEY` in api ("without it the document upload boundary refuses to open", `railway.ts:140-143`) and workers (`railway.ts:207`). Uploads go through `document_upload_sessions` and signed URLs (`packages/evidence`).
- **Cloudflare Stream**: `packages/media/src/infrastructure/cloudflare-stream-video-provider.ts`. Env names `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`, `CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET` (`packages/config/src/video-providers.ts`). Playback goes through `POST …/pitch/:mediaAssetId/playback` (signed). Captions are proxied by `app/api/pitch-captions`.
- **Caching**: no shared cache (no Redis/Upstash; the grep hits are unrelated identifiers). React `cache()` per request in web (`session.ts`), `cache-control: no-store` on Q routes (`apps/web/app/api/q-room/route.ts:21,44`), and process-local maps in q-api (127 `new Map` sites outside `dev/`).

## 6. Realtime, streams and process-local state

| Channel                            | Transport                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Durable?                                                                                                                                                | Location                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Q run events                       | SSE `GET /v1/q/runs/:runId/events`, projected from `q_runtime.run_events`. `id:` is the sequence and `Last-Event-ID` resumes; 15 s heartbeat comments; limits of 8 streams/user and 4/run (`apps/q-api/src/http/q-events.ts:40-100`). Fan-out uses Postgres LISTEN/NOTIFY (`packages/q-runtime/src/infrastructure/postgres-run-event-notifier.ts:22-89`), so it is multi-instance safe. The web proxies it at `app/api/q-stream/v1/q/runs/[runId]/events/route.ts` | **Yes** (DB)                                                                                                                                            | IMPLEMENTED                       |
| Q room feed                        | Long poll `GET /v1/q/room?after&epoch&wait`, proxied by `app/api/q-room/route.ts`. Voice turn handlers publish answers, and typed runs are published via `watchRun` only while a reader is open (`apps/q-api/src/room/feed.ts:17-40`)                                                                                                                                                                                                                              | **No.** "Process-local and forgettable … the epoch names this process" (`feed.ts:35-37`). Lost on deploy or restart; a second replica would split rooms | IMPLEMENTED, single-instance only |
| Voice turn board                   | In memory (`apps/q-api/src/voice/turn-board.ts:7`)                                                                                                                                                                                                                                                                                                                                                                                                                 | No                                                                                                                                                      |                                   |
| Duplex lines                       | In memory in the broker (`apps/q-api/src/voice/duplex/broker.ts`). Transcript persisted to `q_runtime.voice_line_turns`                                                                                                                                                                                                                                                                                                                                            | Partly                                                                                                                                                  |                                   |
| Meeting host sessions              | "Sessions live in this process's memory: one q-api instance hosts a call" (`composition/meeting-host-runtime.ts:51`)                                                                                                                                                                                                                                                                                                                                               | No                                                                                                                                                      |                                   |
| Speech performance relay           | Process-local (`voice/speech-performance.ts:201`)                                                                                                                                                                                                                                                                                                                                                                                                                  | No                                                                                                                                                      |                                   |
| Workforce review grading           | "In memory and bounded: a restart between grading …" (`composition/workforce/review.ts:485`)                                                                                                                                                                                                                                                                                                                                                                       | No                                                                                                                                                      |                                   |
| Interview/onboarding raised checks | "A restart forgets them" (`voice/interview-agent.ts:301`, `voice/onboarding-conductor.ts:272`)                                                                                                                                                                                                                                                                                                                                                                     | No                                                                                                                                                      |                                   |
| Wake channels                      | Postgres NOTIFY: `Q_WORK_WAKE_CHANNEL` (`apps/q-api/src/main.ts:4505-4512`), instruction triggers, run events                                                                                                                                                                                                                                                                                                                                                      | Signal only                                                                                                                                             |                                   |

Consequence: with one replica and many deploys a day (`session-token.ts:22-27`: "We deploy many times a day"), every deploy empties the room feed, voice board, duplex lines and in-flight meeting-host sessions. The lead's 12:02-12:58 observation (duplex line "rejoined, then ended ~20s later") is consistent with, but not proven to be caused by, this design. The deploy log was not inspected.

## 7. Background work: workers, outbox and scheduled sweeps

**Outbox** (`packages/eventing`). Domain writes insert into `events.outbox` in the same transaction. The workers' `OutboxPublisher` claims rows (`FOR UPDATE SKIP LOCKED`), validates each payload against the **workers' event registry**, and sends it to the pgmq queue `domain-events` (`supabase/migrations/20260902190411_events_outbox_foundation.sql:76`). Failures back off up to `maxAttempts` (10) and then stay as stuck rows (`packages/eventing/src/publisher/outbox-publisher.ts:15-35,160-230`).

**DEFECT (live, confirmed):** `apps/workers/src/event-registry.ts:1-35` registers organisation, company, investor, evidence, capital, network, permissions, taxonomy, onboarding, media, verification and integrations events, but **not** `@capital-q/q-actions` events (q-actions is not even a workers dependency). q-api writes `q.action.prepared/approved/rejected/executed/execution_failed` (`packages/q-actions/src/events/index.ts:46-110`). Live, 657 outbox rows are unpublished, all `q.action.*`, all with `last_error` code `EVENT_SCHEMA_INVALID` and 10 attempts. Every q.action event since 2026-09-26 has been dropped (evidence/architecture/live-db-aggregates.md). The declared consumers `@capital-q/q` and `@capital-q/intelligence` (`q-actions/src/events/index.ts:35`) therefore never receive them. q-api compensates with its own 2-minute "approved action sweep" (`apps/q-api/src/main.ts:3808-3830`).

**pgmq queues**: `domain-events`, `documents` + `documents-dead`, `recommendation-refresh` + `-dead` (migrations `20260902190411`, `20260905210000`, `20260929090000`).

**Workers loops** (`apps/workers/src/main.ts:1338-1452`, one `Promise.all`): outbox runner; domain-event consumer (`documentEvents`); recommendation refresh; document pipeline (malware policy `REQUIRE_CLEAN`, so on staging "uploads are accepted and held, not parsed" until a scanner exists, `railway.ts:189-208`); Gmail reply poller; schedule ticker; notice-delivery ticker; document-job ticker; Q Daily ticker; company-embedding refresh every 30 min (only when an embedder is configured); deck read-again (1/min, ≤20/day); deck-reading heal (15 min, ≤$0.25/sweep); auto-verification requests (10 min); synthetic auto-verify (10 min, synthetic only). Event handlers live in `apps/workers/src/{network,verification,evidence,events,recommendations}/*` (chat-message notice, interest/outcome/commitment notices, relationship projection, Q work wake, newly-ready company, startup alerts).

**Schedulers inside q-api** (HTTP process, `setInterval(...).unref()`): standing-instruction sweep every 60 s (`main.ts:1892-1899`); approved-action sweep every 2 min (`main.ts:3808-3830`); orphaned-run sweep at boot and periodically (`main.ts:3844-3860`); meeting assistant enlist/collect (`main.ts:4141-4155`); errands tick every 60 s behind kill switch `q.autonomy.errands` (`main.ts:4268-4276`); Q work runtime tick every 60 s plus a LISTEN wake (`main.ts:4499-4515`); scout at 5 min and then every 6 h (`main.ts:5000-5001`). These are timer loops in a web-serving process with one replica: they are not leader-elected. The instruction sweep is "claimed in the DB" (`main.ts:1886`), and the orphan sweep says a second instance is safe (`main.ts:3840-3843`). The other loops' multi-instance safety was not verified.

## 8. Third-party integrations (env var NAMES only)

| Integration                    | Purpose                                                                               | Adapter                                                                                       | Env names                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase                       | Postgres, Auth, Storage                                                               | `packages/database`, `packages/security/src/supabase`, `@supabase/ssr`                        | `DATABASE_URL`, `DATABASE_CONNECTION_MODE`, `DATABASE_PRIVILEGED_URL`, `DATABASE_MIGRATION_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| OpenAI                         | Chat (primary since migration 20261008130000), Realtime duplex, transcription, images | `packages/model-gateway/src/providers/openai.ts`, `realtime/openai.ts`, `images/openai.ts`    | `OPENAI_API_KEY` / `OPEN_AI_API_KEY`, `CQ_TEST_MODEL_PROVIDER`, `CQ_VOICE_REALTIME*` (9 tuning vars, `apps/q-api/src/voice/duplex/config.ts:75-124`)                                                                                   |
| Google Gemini                  | Chat/classification                                                                   | `model-gateway/src/providers/google.ts`                                                       | `GEMINI_API_KEY`, `GEMINI_API_KEY2`/`_2`                                                                                                                                                                                               |
| Groq                           | Chat (rotating keys)                                                                  | `model-gateway/src/providers/groq.ts`                                                         | `GROQ_API_KEY`, `GROQ_API_KEY_2..4`                                                                                                                                                                                                    |
| Deepgram                       | STT, Voice Agent, TTS                                                                 | `apps/q-api/src/voice/providers/deepgram*.ts`, web `agent-socket.ts`                          | `DEEPGRAM_API_KEY`, `Q_VOICE_PROVIDER`                                                                                                                                                                                                 |
| ElevenLabs                     | Speech Engine, TTS, pronunciation                                                     | `apps/q-api/src/voice/providers/elevenlabs*.ts`                                               | `ELEVENLABS_API_KEY`, `ELEVENLABS_SPEECH_ENGINE_ID`, `ELEVENLABS_SPEECH_ENGINE_ID_MALE`, `Q_VOICE_EXPRESSIVE`                                                                                                                          |
| Tavily / Bright Data / SerpAPI | Public web research                                                                   | `packages/q-research/src/providers/tavily.ts`, `apps/q-api/src/composition/research.ts`       | `TAVILY_API_KEY`, `BRIGHT_DATA_API_KEY`, `SERP_API_KEY`                                                                                                                                                                                |
| Companies House / SEC EDGAR    | Investor research                                                                     | `apps/q-api/src/composition/investor-research.ts`                                             | `COMPANIES_HOUSE_API_KEY`, `SEC_EDGAR_USER_AGENT`                                                                                                                                                                                      |
| Cloudflare Stream              | Pitch video                                                                           | `packages/media/src/infrastructure/cloudflare-stream-video-provider.ts`                       | `CLOUDFLARE_*` (§5)                                                                                                                                                                                                                    |
| Recall.ai                      | Meeting bots, transcripts, vision                                                     | `apps/q-api/src/composition/recall-bots.ts`                                                   | `RECALL_API`, `RECALL_API_KEY`, `RECALL_REGION`, `RECALL_TRANSCRIBER`, `RECALL_SCREEN_VISION`, `RECALL_CAMERA_VISION`, `RECALL_WEBHOOK_SECRET`, `CQ_MEETING_HOST`                                                                      |
| Google Workspace               | Gmail and Calendar OAuth, Pub/Sub push                                                | `packages/integrations/src/google/{gmail,calendar}.ts`                                        | `GOOGLE_WORKSPACE_CLIENT_ID/SECRET/REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`                                                            |
| Email out                      | SMTP/Brevo via nodemailer                                                             | `packages/integrations`, `packages/email`                                                     | `SMTP_HOST/PORT/USER/PASS/SENDER`, `SMTP_API_KEY`, `BREVO_API_KEY`                                                                                                                                                                     |
| Email in                       | Postmark inbound                                                                      | `apps/api/src/http/inbound-email.ts`                                                          | `POSTMARK_INBOUND_ADDRESS`, `INBOUND_EMAIL_WEBHOOK_SECRET`                                                                                                                                                                             |
| Web Push                       | VAPID                                                                                 | `apps/api/src/http/push.ts`                                                                   | `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`                                                                                                                                                          |
| Stripe                         | Billing (no live subscriptions)                                                       | `packages/billing/src/provider.ts`                                                            | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                                                                                                                                                           |
| Pexels                         | Stock photos                                                                          | `packages/model-gateway/src/images/stock.ts`, `packages/q-daily/src/infrastructure/pexels.ts` | `PEXELS_API_KEY`, `PEXELS_API`                                                                                                                                                                                                         |
| TEI embeddings                 | Semantic retrieval                                                                    | `packages/q-embeddings`                                                                       | `Q_EMBEDDING_PROVIDER`, `Q_EMBEDDING_BASE_URL`, `Q_EMBEDDING_TIMEOUT_MS`, `Q_EMBEDDING_MAX_BATCH_ITEMS` (not deployed, §1)                                                                                                             |
| MCP                            | Q as MCP server/client                                                                | `apps/q-api/src/http/q-mcp.ts` (`POST /v1/mcp`), `packages/q-connectors`                      | `Q_MCP_SERVER`                                                                                                                                                                                                                         |

Other runtime flags read directly from `process.env`, bypassing `packages/config`: `CQ_DEV_PREVIEW`, `CQ_DOCUMENT_PIPELINE`, `CQ_DOCUMENT_CRITIC`, `CQ_INSTRUCTIONS_AUTO`, `CQ_REVIEW_PAGES`, `CQ_DESIGN_REVIEW`, `Q_DAILY_DISABLED`, `Q_DAILY_MAX_EDITIONS_PER_DAY`, `Q_WORKFORCE_MONTHLY_LIMIT_USD`, `Q_API_PUBLIC_URL`, `RAILWAY_SERVICE__CAPITAL_Q_WEB_URL`, `CAPITAL_Q_SYNTHETIC_*`, `CQ_SEED_ACCOUNT_PASSWORD`, `CQ_EVAL_DATABASE_URL`. Base runtime: `NODE_ENV`, `CAPITAL_Q_ENV`, `REGION`, `LOG_LEVEL`, `HOST`, `PORT`, `SERVICE_VERSION`, `CQ_API_URL`, `CQ_Q_API_URL`, `CQ_WEB_ORIGIN`, `CQ_MALWARE_POLICY`, `CQ_FOUNDER_ONBOARDING_ADAPTER`, `CQ_DOCUMENT_UPLOAD_MAX_BYTES`, `CQ_DOCUMENT_IMAGES*`, `Q_PERSONALITY`.

**Feature flags / kill switches**: DB table `platform_ops.feature_flags` (+`feature_flag_events`), admin routes `GET/POST /v1/admin/flags` (`apps/api/src/http/admin.ts:818,830`). Code checks found: `q.autonomy.errands` (`apps/q-api/src/main.ts:4270`), `q.autonomy.delegations`, `q.daily`. Most behaviour toggles are env flags, not DB flags.

**Model routing** is data, not code: `ai_ops.routing_policies` (`preferred_models`, `fallback_models`, `hedge_after_ms`) and `ai_ops.models/providers/model_prices`. Five migrations on 2026-10-08 changed routing: `20261008110000_ai_ops_dialogue_drop_dead_fallback`, `…120000_ai_ops_demo_routing_gemini_openai`, `…130000_ai_ops_openai_primary`, and `20261110000000_ai_ops_fast_classification_flash_lite_first`.

## 9. Errors and observability

- **Problem details (RFC 9457)**: `application/problem+json` (`packages/contracts/src/http/problem-details.ts:11,88`). Handlers are `apps/api/src/http/problem-handler.ts` (782 lines) and `apps/q-api/src/http/problem-handler.ts` (347 lines), two diverged implementations. App actions map unavailable ports to a problem (`apps/api/src/http/app-actions.ts:140-153`). Authorization denies on app actions return 404 (`app-actions.ts:186-189`).
- **Logging**: pino with path redaction (`packages/observability/src/logger.ts:8-38,113,137`) and request-id context (`withObservabilityContext`). Logs go to stdout → Railway, which "only keeps the current deployment's recent lines" (`docs/handoff/session-handoff-2026-10-08.md:11`). There is no log shipping.
- **Tracing/metrics**: `TELEMETRY_EXPORT_ENABLED = false`; "nothing is exported anywhere yet … spans are created and discarded" (`packages/observability/src/telemetry.ts:15-21`). Meters such as `q_sse_heartbeats_total` (`q-events.ts:175`) are no-ops. **CONFIGURED-UNUSED.**
- **De-facto metrics**: `ai_ops.model_usage` (13,172 rows; per-call tokens, latency, cost, error_code), `audit.material_actions` (4,315), `platform_ops.q_firewall_decisions`, and the admin Q monitor `/v1/admin/q/{monitor,errors,runs/:runId}`.

## 10. Component cards

| Component       | Purpose                                                                                               | Location                               | Callers                                                                  | Callees                                                                                                                                            | I/O contract                                   | State                                                                 | Permissions                                                        | Errors / known failures                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app         | UI, cookie session, proxy to services                                                                 | `apps/web`                             | Browser                                                                  | api-client → api/q-api; Supabase Auth; Deepgram/ElevenLabs/OpenAI realtime; Cloudflare HLS                                                         | Next routes, server actions, `/api/*` handlers | Cookie session; browser-side Q store                                  | Route policy in `proxy.ts` (UI gating only; services re-authorize) | Duplex fell back to the standard line in the lead's headless test; the opener used the generic `returning.ts` greeting (fixed today per RULES) |
| api-client      | Typed HTTP/SSE client                                                                                 | `packages/api-client`                  | web server code                                                          | api, q-api                                                                                                                                         | contracts Zod schemas                          | none                                                                  | bearer passthrough                                                 | Problem parsing in `problem.ts`                                                                                                                |
| apps/api        | Domain HTTP API, app-action registry, admin, webhooks                                                 | `apps/api/src/{main,app}.ts`           | web, q-api (private `CQ_API_URL`)                                        | domain packages, Postgres, Storage, Stripe, Cloudflare, Postmark, Web Push, q-api interview (`CQ_Q_API_URL`, `apps/api/src/q/interview-client.ts`) | `/v1/*` (§3.1-3.2)                             | stateless                                                             | actor context + `authorize()`                                      | `/health/ready` is static; writes `q_runtime.standing_instructions` directly (`q-work-port.ts:75-118`)                                         |
| apps/q-api      | Q runtime: runs, SSE, approvals, voice, work/instructions/workforce, rehearsals, meetings, daily, fit | `apps/q-api/src/main.ts` (5,895 lines) | web, speech providers (think callback), Recall webhooks, api (interview) | model gateway (OpenAI/Gemini/Groq), q-* packages, research providers, Deepgram/ElevenLabs/OpenAI realtime, Postgres                                | `/v1/q/*`, `/v1/fit/*`, `/v1/mcp` (§3.3)       | Process-local room, voice, duplex, meeting state (§6); DB runs/events | actor or personal context; Q tool authorize; approvals             | Live: unclear-speech turns returned SILENT, standing-instruction drafts below threshold (RULES live evidence); 1,225 of 2,822 runs CANCELLED   |
| apps/workers    | Outbox publishing, queue consumers, document pipeline, tickers                                        | `apps/workers/src/main.ts`             | none (DB-driven)                                                         | Postgres/pgmq, Storage, model gateway (Gemini/Groq), research, Gmail, SMTP                                                                         | events/jobs contracts                          | DB only                                                               | privileged storage key                                             | q.action events never publish (§7); documents held unparsed under `REQUIRE_CLEAN`                                                              |
| Outbox/eventing | Transactional outbox → pgmq                                                                           | `packages/eventing`                    | all domain writers                                                       | pgmq `domain-events`                                                                                                                               | `EventRegistry` Zod schemas                    | `events.outbox`                                                       | n/a                                                                | 657 stuck rows                                                                                                                                 |
| Model gateway   | Provider-neutral inference, routing policy, usage metering                                            | `packages/model-gateway`               | q-specialists, q-api, workers, gateq-intake, q-daily                     | OpenAI, Gemini, Groq SDKs                                                                                                                          | task class in → validated result               | `ai_ops.*`                                                            | Context Firewall upstream                                          | Config comment says OpenAI is diagnosis-only (stale)                                                                                           |
| Security        | Authn adapters, actor resolution, authorization                                                       | `packages/security`                    | api, q-api, most packages                                                | Supabase Auth, Postgres                                                                                                                            | `ActorContext`                                 | none                                                                  | —                                                                  | Uncached Auth round trip per request                                                                                                           |
| Database        | One postgres.js pool per process, transactions                                                        | `packages/database`                    | all repositories                                                         | Supavisor → Postgres as `postgres` (inferred)                                                                                                      | `RequestDatabase`                              | pool                                                                  | none at DB level (RLS bypassed; see 12 §2)                         | —                                                                                                                                              |
