# Research brief: consequential external actions for Capital Q (email, calendar, CRM, meetings, reminders)

Researched 2026-09-25. Every claim has a source link; I did not verify anything beyond those sources. Where sources disagree, or a date in your prompt looks out of date, it is marked **FLAG**.

---

## 1. Gmail API

**Scope classes (from Google's scope page):**
- **Sensitive:** `gmail.send`, which lets the app "Send email on your behalf".
- **Restricted:** `gmail.readonly`, `gmail.compose`, `gmail.metadata`, `gmail.modify`, `gmail.insert`, `gmail.settings.*` and `https://mail.google.com/`.
- **Non-sensitive:** `gmail.labels`.
- Source: https://developers.google.com/workspace/gmail/api/auth/scopes
- **FLAG:** `gmail.compose` is restricted, so creating a Gmail draft (`drafts.create`) puts you into the CASA security assessment. Keep the approved draft inside Capital Q, where the approval is bound to a hash of the exact payload, and call `messages.send` with only `gmail.send`. That fits Prepare → Recommend → Approve → Execute and avoids the assessment.

**Restricted-scope verification and CASA:**
- Any app that reads restricted data "from or through a third-party server must go through a security assessment". This is App Defense Alliance CASA, repeated "at least every 12 months" after the assessor's Letter of Assessment.
- Brand verification takes about 2–3 business days. Restricted verification "can potentially take several weeks".
- Exemptions: personal use, dev/test/staging, internal-only (the app's own Workspace org), and domain-wide installation.
- Source: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Cost, from third-party reports: about $500 up to roughly $4,500 a year depending on tier. https://deepstrike.io/blog/google-casa-security-assessment-2025 · https://www.agenticfabriq.com/blog/google-oauth-verification-casa
- Sensitive scopes need app verification but no security assessment. https://www.unipile.com/gmail-api-scopes-guide/

**Testing mode and unverified apps:**
- In Testing status an app is limited to 100 test users, and refresh tokens for External apps expire after 7 days. https://support.google.com/cloud/answer/15549945 · https://dev.to/ko-hi/googles-oauth-testing-mode-expires-refresh-tokens-in-7-days-publish-the-consent-screen-before-24hm
- An unverified app in production shows the "unverified app" screen and is capped at 100 new users over the project's lifetime. The cap cannot be reset. https://support.google.com/cloud/answer/7454865
- In production, refresh tokens last until revoked or unused for about 6 months. https://tech.queenofsandiego.com/posts/2026-05-06-2124.html

**Sending and threading:**
- `messages.send` and `drafts.send` take an RFC 2822 MIME message encoded as base64url. https://developers.google.com/workspace/gmail/api/guides/sending
- To land in an existing thread, a message needs three things: `threadId` set on the message resource, `References`/`In-Reply-To` headers that follow RFC 2822, and a matching `Subject`. https://developers.google.com/workspace/gmail/api/guides/threads
- Design point: if Capital Q generates its own `Message-ID` and stores the `threadId` returned by `messages.send`, it can send follow-ups on threads it started using only `gmail.send`, with no read scope.

**Limits:**
- Consumer Gmail: about 500 recipients a day.
- Workspace: 2,000 messages per rolling 24 hours, and at most 500 recipients per message through the API. https://www.gmass.co/blog/understanding-gmails-email-sending-limits/ · https://developers.google.com/workspace/gmail/api/reference/quota

**Reply detection (`watch` + Pub/Sub):**
- `users.watch` needs `mail.google.com`, `gmail.modify`, `gmail.readonly` or `gmail.metadata`, all of which are restricted. **Reply detection through the Gmail API therefore means CASA.** https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
- Setup: give `gmail-api-push@system.gserviceaccount.com` publish rights on your topic.
- A watch must be renewed at least every 7 days; Google recommends daily.
- Each watched user is limited to 1 notification per second, and excess notifications are dropped.
- Filter with `labelIds` plus `labelFilterBehavior`.
- On each notification, call `history.list` starting from the last stored `historyId`.
- Source: https://developers.google.com/workspace/gmail/api/guides/push
- A missed renewal fails silently. https://www.unipile.com/gmail-api-push-notifications/
- Ways to avoid CASA: stay in Testing or internal mode for the demo, or route replies with a platform-domain Reply-To address (see §6).

---

## 2. Microsoft Graph mail

**Permissions:**
- `createReply` needs **Mail.ReadWrite**; there is nothing less privileged. The draft is sent in a second call with `POST /messages/{id}/send`. `reply` does both in one call. JSON or MIME bodies are supported. https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0
- **Mail.Send** alone can send, and it saves a copy to Sent Items. https://graphpermissions.merill.net/permission/Mail.Send

**Admin consent (FLAG):**
- Since November 2025, Microsoft's managed default consent policy blocks *user* consent for Mail.Read, Mail.ReadWrite, Calendars.Read/ReadWrite, the EWS/IMAP permissions and Chat.* in tenants that still use the default policy. Enterprise customers will usually need an admin to consent.
- Consents granted before the change still work.
- https://blog-en.topedia.com/2025/11/microsoft-managed-default-app-consent-policy-now-blocks-20-additional-permissions/ · https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent

**Change notifications (FLAG, your 4,230-minute figure is out of date for mail):**
- The current table gives Outlook message, event and contact subscriptions **10,080 minutes (under 7 days)**. Subscriptions that include resource data get **1,440 minutes**. 4,230 minutes now applies to other resources such as onlineMeeting and Group conversation. https://learn.microsoft.com/en-us/graph/change-notifications-overview
- Limits: 1,000 active subscriptions per mailbox across all apps. Subscribing to messages needs Mail.ReadBasic or Mail.Read.
- Rich notifications need `includeResourceData`, `$select` and an encryption certificate.
- Subscribe to lifecycle notifications (subscription removed, missed notifications, reauthorization required).
- Identify users by object ID (OID), not UPN.
- Source: https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview
- Message notifications normally arrive in under a minute (maximum 3 minutes). Delivery can go to webhooks, Event Hubs or Event Grid. https://learn.microsoft.com/en-us/graph/change-notifications-overview

**Delta query:**
- Delta works per mail folder: store the `@odata.deltaLink` and keep following `@odata.nextLink` pages until you get one. https://learn.microsoft.com/en-us/graph/delta-query-messages

---

## 3. Calendar and scheduling

**Google Calendar:**
- To get a Meet link, call `events.insert` with `conferenceDataVersion=1`, `conferenceData.createRequest.conferenceSolutionKey.type="hangoutsMeet"` and a unique `requestId` (this acts as an idempotency key).
- The status can come back as `pending` and only later becomes `success`.
- Do not reuse conference data across events.
- Source: https://developers.google.com/workspace/calendar/api/guides/create-events
- Attendees who don't use Google only hear about the event if you set `sendUpdates=all` or `externalOnly`. https://developers.google.com/workspace/calendar/api/concepts/reminders
- `events.watch` channels expire and cannot be renewed; create a new channel and re-sync with `syncToken`. Free/busy uses `freebusy.query`. https://developers.google.com/workspace/calendar/api/guides/push
- Calendar scopes are sensitive, not restricted. Recall.ai's docs list `calendar.events.readonly` as sensitive. The scope list itself is at https://developers.google.com/workspace/calendar/api/auth and the classification at https://docs.recall.ai/docs/calendar-v2-google-calendar

**Microsoft Graph calendar:**
- Set `isOnlineMeeting: true` and `onlineMeetingProvider: "teamsForBusiness"`. Once set, you cannot turn it back off. https://learn.microsoft.com/en-us/graph/outlook-calendar-online-meetings
- Personal Outlook.com accounts cannot create Teams meetings this way.
- App-only tokens have been reported to silently create the event without a Teams meeting. https://learn.microsoft.com/en-us/answers/questions/5769380/microsoft-graph-creating-event-with-isonlinemeetin

**Scheduling links:**
- **Calendly:** the Scheduling API (Create Event Invitee) went live on 2025-10-16 and can book through the API without redirects or iframes. It **requires a paid Calendly plan.** https://community.calendly.com/api-webhook-help-61/scheduling-api-now-available-4825 · https://developer.calendly.com/schedule-events-with-ai-agents
- **Cal.com:** `POST /v2/bookings` creates bookings. Atoms are embeddable React components with managed users. It is AGPL and can be self-hosted. Cloud plans: Free, Teams $12/user, Orgs $28/user. https://cal.com/docs/api-reference/v2/bookings/create-a-booking · https://cal.com/integrate · https://cal.com/platform/pricing

**Unified APIs and whether they remove the CASA burden:**
- **Nylas v3:**
  - Free: 5 accounts. Essentials: $15/month. Pro: $49/month for 25 accounts, then $2.00 per extra account.
  - Notetaker bot hours: $0.70–0.80/hour.
  - https://www.nylas.com/pricing/
  - The **Shared GCP App** is Nylas's own GCP project, already through CASA Tier 3, so you skip Google verification. It is an add-on **for contract plans only**. https://developer.nylas.com/docs/provider-guides/google/shared-gcp-app/
- **Unipile** says it covers the CASA cost. https://www.unipile.com/email-api-guide/
- **Cronofy:** usage-based with a $99/month minimum, or $139/month (Starter) to $819/month (Emerging). https://www.cronofy.com/api-pricing · https://apiscout.dev/guides/nylas-vs-cronofy-vs-google-calendar-api-2026
- **Merge / Unified.to:** unified calendar APIs. For Gmail at scale you would still normally need your own verified GCP app. https://truto.one/blog/best-unified-calendar-api-in-2026-truto-vs-nylas-vs-cronofy-vs-merge/
- **Recall's calendar integration** also requires *your own* GCP OAuth client and verification. https://docs.recall.ai/docs/calendar-v2-google-calendar

---

## 4. MCP, agent frameworks and managed auth

**Spec status:**
- Current revision is **2026-07-28**. The release candidate locked on 2026-05-21.
- Changes: the protocol is now stateless (no `initialize` handshake, no `Mcp-Session-Id`). Streamable HTTP requests must carry `Mcp-Method` and `Mcp-Name` headers.
- Server-to-client input now goes through `InputRequiredResult` responses.
- New official extensions: MCP Apps and Tasks.
- Roots, Sampling and Logging are deprecated.
- Auth hardening: clients must validate `iss` (RFC 9207) and declare `application_type` during Dynamic Client Registration.
- Source: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- The authorization layer is OAuth 2.1. https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http

**Official security guidance:**
- **Token passthrough is forbidden.** Servers "MUST NOT accept any tokens that were not explicitly issued for the MCP server."
- MCP proxy servers MUST get per-client consent, match `redirect_uri` exactly, and use single-use `state` values; this prevents the confused-deputy attack.
- It also covers SSRF during OAuth discovery (block private IP ranges, use egress proxies), guessable state handles ("MUST NOT treat possession of a state handle as authentication"), and scope minimisation with step-up.
- Source: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- Tool poisoning, rug pulls and injection through tool output: https://checkmarx.com/learn/mcp-security-risks-real-world-incidents-and-security-controls/
- Real prompt-injection case: a calendar-invite title hijacked Gemini for Workspace ("Invitation Is All You Need", disclosed February 2025). Google's mitigations included confirmations for sensitive actions and injection classifiers. https://www.safebreach.com/blog/invitation-is-all-you-need-hacking-gemini/

**Official servers:**
- **Google Workspace remote MCP:** Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat and People. It is a **Developer Preview** with a gradual rollout from 2026-05-01.
  - The Gmail server needs `gmail.readonly` and `gmail.compose`, both restricted.
  - Its Gmail tool can **create drafts only; it cannot send.**
  - https://developers.google.com/workspace/guides/configure-mcp-servers · https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html
- **HubSpot:** remote MCP at mcp.hubspot.com, generally available since April 2026, with CRM read and write. https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available
- **Notion:** mcp.notion.com.
- **Salesforce:** hosted MCP servers.
- **Microsoft 365/Outlook:** exists but is not plug-and-play.
- Source for the last three: https://lagrowthmachine.com/best-mcp-servers/

**Recommendation for a multi-tenant SaaS:**
- Own typed connectors with Zod in/out and an explicit authorize step. Do not expose raw MCP to the model.
- Reasons: MCP tool descriptions and tool outputs are untrusted model input, and remote servers ask for broad scopes. The spec's own scope-minimisation guidance (above) supports this.
- If MCP is ever used, keep it behind the Capital Q gateway as an adapter, with per-tenant tokens whose audience is the gateway.

**LangChain / LangGraph:**
- LangChain v1 `HumanInTheLoopMiddleware` interrupts on tool calls, with approve, edit, reject or respond. State persists through the checkpointer. https://docs.langchain.com/oss/python/langchain/human-in-the-loop · JS: https://reference.langchain.com/javascript/langchain/index/humanInTheLoopMiddleware
- The Gmail toolkit (`GmailCreateDraft`, `GmailSendMessage`, `GmailSearch`, …) reads a local `credentials.json`. It is single-user and not built for multi-tenant use. https://docs.langchain.com/oss/python/integrations/tools/google_gmail
- An "edit" in the middleware modifies the payload. In Capital Q that must trigger re-approval, because approval is bound to the exact payload.

**Managed auth and token vaulting:**
- **Composio** (official pricing page):
  - Free: 100k tool calls a month.
  - Scale: $29/month, then $0.0003 per call.
  - Apps using Composio's own OAuth apps get only 20k free calls and cost $0.0005 per call; you can bring your own app.
  - Enterprise adds customer-managed keys.
  - https://composio.dev/pricing
  - **FLAG:** a third party reports a change on 2026-08-15 to about $4 per 1,000 calls. https://www.scalekit.com/blog/composio-pricing-change
- **Arcade:** Free is 2,000 auth events and 2,000 tool calls. Team is $25/month plus $0.10 per auth event and $0.01 per tool call. Enterprise can run in a VPC or air-gapped. https://www.arcade.dev/pricing/
- **Pipedream Connect:** 100 external users included, then $2 each. Workday closed its acquisition of Pipedream in February 2026. https://pipedream.com/pricing · https://newsroom.workday.com/2025-11-19-Workday-Signs-Definitive-Agreement-to-Acquire-Pipedream
- **Caveat:** if you use a vendor's shared OAuth app, users see the vendor's brand on the consent screen. If you bring your own OAuth app, CASA is still your responsibility. Nylas's Shared GCP App is the exception.

---

## 5. CRMs

**Which firms use what:**
- Affinity and 4Degrees dominate small and mid-sized VC firms.
- DealCloud (Intapp) and Salesforce are used by large funds and multi-strategy platforms.
- Attio and HubSpot are used by early-stage and tech-forward teams.
- Affinity starts around $100 per user per month.
- https://www.4degrees.ai/blog/the-best-crm-platforms-for-venture-capital-firms-in-2026

**Affinity:**
- v2 is "not at feature parity with v1". The API is only on some licence types. https://developer.affinity.co/docs/v2/
- v1 authenticates with the API key as a Basic-auth password or a Bearer token.
- Limits: 900 requests per user per minute. Monthly: 100k on Scale and Advanced, none on Essentials, unlimited on Enterprise.
- `POST /persons` takes `first_name`, `last_name` and `emails`. A notes endpoint exists (confirm the exact fields in the reference).
- https://api-docs.affinity.co/
- There are no per-user OAuth apps; each firm pastes an API key. Treat the key as a tenant secret.

**Attio:**
- OAuth 2.0 with scopes; for example, creating a record needs `record_permission:read-write` and `object_configuration:read`.
- `POST /v2/objects/{object}/records`.
- Limits: 100 reads and 25 writes per second, with 429 plus Retry-After.
- https://docs.attio.com/rest-api/endpoint-reference/records/create-a-record · https://docs.attio.com/rest-api/guides/rate-limiting

**HubSpot:**
- Notes: `POST /crm/v3/objects/notes` with an `associations` object.
- Private apps: contact read/write scopes are enough for notes.
- https://developers.hubspot.com/docs/api-reference/crm-notes-v3/guide · https://community.hubspot.com/t5/APIs-Integrations/Private-app-amp-Engagement-data/m-p/679184

**Salesforce:**
- REST API over OAuth. **Creating Connected Apps is restricted as of Spring '26**; use External Client Apps.
- API access is on by default in Enterprise, Performance, Unlimited and Developer editions.
- https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html

**DealCloud:**
- REST Data APIs cover create, read, update and delete on entry lists (Contacts id 10, Companies id 12). Each site has its own Swagger page. Intapp also publishes an MCP connector.
- https://api.docs.dealcloud.com/docs/data · https://www.intapp.com/mcp-documentation/

**Architecture note:** a CRM is an *export or projection target*, never a parallel truth. The Capital Q relationship row stays canonical.

---

## 6. Deliverability

**Sending from the user's mailbox (Gmail/Graph):**
- Uses the user's own domain authentication (SPF/DKIM) and reputation, and threads naturally.
- Bulk sender rules still apply, including for Workspace users: "All senders, including Google Workspace users, must meet the requirements". https://support.google.com/a/answer/14229414

**Google and Yahoo rules (February 2024), Gmail enforcement tightened November 2025:**
- A bulk sender is anyone sending close to 5,000 messages a day to personal Gmail accounts, and **the status is permanent**.
- Keep the spam rate under 0.1% and never at 0.3%.
- **One-click unsubscribe applies to marketing messages only; transactional messages are excluded.**
- https://support.google.com/a/answer/14229414
- Individual 1:1 investor-founder outreach from a user's own mailbox is not bulk. Platform digests and nudges are.

**Microsoft (Outlook.com, Hotmail, Live), from 2025-05-05:**
- More than 5,000 messages a day needs SPF, DKIM and DMARC (at least `p=none`) with alignment.
- Rejection code: `550 5.7.515`.
- https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%e2%80%99s-new-requirements-for-high%e2%80%90volume-senders/4399730

**RFC 8058:** uses `List-Unsubscribe` plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and both headers MUST be covered by the DKIM signature. https://www.rfc-editor.org/rfc/rfc8058.html

**Transactional providers:**
- **Resend:** 3,000 free emails a month; Pro is $20 for 50,000. Its inbound webhooks carry metadata only, so the body needs a second fetch.
- **Postmark:** $15 for 10,000 and $55 for 50,000. Its inbound webhook carries the full parsed message and it is known for strong inbox placement.
- https://postmarkapp.com/compare/resend-alternative · https://nuntly.com/versus/resend-vs-postmark

**Reply tracking without a read scope:**
- Set Reply-To to `reply+<token>@replies.capitalq…`, using plus addressing or VERP-style per-message tokens.
- An inbound webhook (Postmark Inbound) matches the reply to the relationship.
- Trade-off: the address is visible to the recipient, and a reply sent straight to the user's own address is missed.

**Open tracking:**
- Apple Mail Privacy Protection pre-fetches pixels through a proxy, which inflates opens. Postmark itself says opens are unreliable. https://postmarkapp.com/support/article/1257-open-tracking-and-apple-mail
- Tracking pixels also carry ePrivacy/GDPR consent risk. https://sendpulse.com/blog/email-tracking-pixel
- For Capital Q, where viewing is not interest, don't track opens at all.

---

## 7. Meeting bots and voice

**Recall.ai:**
- Pay-as-you-go $0.50 per recording hour (first 5 hours free), billed to the second.
- Transcription $0.15/hour. Storage free for 7 days, then $0.05/hour for 30 days.
- The startup programme is $0.25/hour for the first 10,000 hours.
- Calendar integration is free. The Desktop Recording SDK costs the same.
- https://www.recall.ai/pricing
- **Output Media API:** renders a webpage as the bot's camera or screen-share and plays its audio into the meeting. The meeting audio is fed back into the page's microphone, **so the bot can speak** (for example using the OpenAI Realtime API or ElevenLabs). https://docs.recall.ai/docs/stream-media · https://www.ycombinator.com/launches/M9k-recall-ai-output-media-api-ai-agents-that-talk-in-meetings
- A Send Chat Message endpoint supports consent notices. https://docs.recall.ai/docs/sending-chat-messages
- Calendar V2 handles Google and Outlook sync, deduplication and webhooks. https://docs.recall.ai/docs/calendar-v2-integration-guide
- The Desktop Recording SDK records Zoom, Meet, Teams and Slack locally with no bot, from an Electron app on Windows or Apple Silicon. Consent is the app user's responsibility. https://docs.recall.ai/docs/desktop-sdk

**Alternatives:**
- Skribby: from $0.35/hour.
- MeetingBaaS: token-based since late 2025, effectively about $0.63–0.68/hour.
- Nylas Notetaker: $0.70/hour including transcription.
- Vexa: open source.
- https://www.nylas.com/blog/best-meeting-bot-apis/ · https://skribby.io/blog/meeting-bot-api-comparison-2026
- **Attendee:** open source and self-hostable (Django, Postgres, Redis). Its site says Zoom, Meet and Teams; the GitHub README I fetched still lists Meet and Teams as roadmap. Licence reports conflict (MIT vs Elastic 2.0), so verify before relying on it. https://attendee.dev/ · https://github.com/attendee-labs/attendee

**Zoom (FLAG, big 2026 change):**
- Since **2026-03-02**, a Meeting SDK bot joining a meeting hosted by an *external* account needs two things:
  - a Marketplace-reviewed, published app;
  - an **OBF (On Behalf Of) token** from a user who has authorised the app with OAuth and is *present in the meeting*.
- If that user leaves, the bot is removed. SDK version 5.17.5 or later is required.
- https://developers.zoom.us/docs/meeting-sdk/obf-faq/ · https://www.recall.ai/blog/zoom-obf
- **RTMS (Realtime Media Streams)**, generally available since 2025-06-25, streams audio, video and transcript without a bot. It needs paid Build Platform credits. https://developers.zoom.us/changelog/rtms/june-25-2025/ · https://developers.zoom.us/docs/rtms/
- A bot must obtain local-recording permission, and Zoom then shows its recording-consent prompt, which cannot be suppressed. https://www.recall.ai/blog/zoom-sdk-suppressing-consent-prompt

**Google Meet:**
- The Meet Media API is still a **Developer Preview**. The GCP project, the OAuth principal *and every participant* must be enrolled.
- Participants see a start dialog and anyone can stop it. It does not connect when encryption, watermarks or underage accounts are present. It only receives media; I found no documented way to send audio.
- https://developers.google.com/workspace/meet/media-api/guides/overview
- Guest bots must be admitted by a host (with Host Controls on, only hosts see the request). Signed-in bots that are listed as invitees skip the waiting room. https://docs.recall.ai/docs/troubleshooting-google-meet-waiting-room

**Microsoft Teams (FLAG):**
- Under MC1251206, Teams **detects and labels third-party bots in the lobby, and the organiser must explicitly admit them**. General availability was June 2026.
- An admin policy can auto-block external bots.
- https://office365itpros.com/2026/03/16/third-party-recording-bots/ · https://www.bleepingcomputer.com/news/microsoft/microsoft-teams-will-tag-third-party-bots-in-meeting-lobbies/
- The native route is Graph cloud-communications bots with application-hosted media: C#/.NET on Windows Server in Azure.
- Compliance recording needs tenant policy, admin-consented `Calls.*` permissions and certificate auth.
- https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots · https://learn.microsoft.com/en-us/microsoftteams/teams-recording-compliance

**Voice and transcription:**
- **Deepgram** pay-as-you-go:
  - Nova-3 streaming $0.0048/min (a limited-time rate; third-party reports put the regular rate at $0.0077). Pre-recorded $0.0043/min.
  - Flux $0.0065/min. Aura-2 TTS $0.030 per 1,000 characters.
  - Voice Agent API $0.075/min (Standard) to $0.163/min (Advanced).
  - $200 free credit.
  - https://deepgram.com/pricing · https://convertaudiototext.com/blog/deepgram-nova-3-explained
- **ElevenLabs Agents:** about $0.08/min, with LLM usage billed on top. Telephony and SIP integrations exist, but **I found no native way to join Zoom or Meet**; pair it with Recall Output Media. https://elevenlabs.io/blog/weve-lowered-api-agents-pricing-and-introduced-pay-as-you-go · https://elevenlabs.io/agents/integrations
- **Vendors that support a bot speaking in the meeting:** Recall (Output Media), MeetStream, and Attendee (audio output). https://meetstream.ai/voice-agents

---

## 8. Recording consent law

**US:**
- All-party consent states: California, Delaware, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania and Washington.
- Connecticut, Michigan and Oregon have mixed or unsettled rules.
- The other states and DC are one-party.
- When participants are in different states, apply the strictest rule.
- https://www.recordinglaw.com/party-two-party-consent-states/ · https://www.layer3labs.io/guides/two-party-consent-states

**Otter.ai litigation:**
- *In re Otter.AI Privacy Litigation*, 5:25-cv-06911 (N.D. Cal.), consolidates suits filed from August 2025.
- Claims: ECPA, CFAA, CIPA, intrusion and UCL. The allegations are recording non-user attendees without their consent and training on transcripts.
- Still active as of April 2026.
- https://natlawreview.com/article/ai-notetaking-tools-under-fire-lessons-otterai-class-action-complaint · https://www.uctoday.com/security-compliance-risk/otter-ai-on-trial-and-the-ai-notetaker-industry-with-it/

**GDPR and UK:**
- A recording is personal data, so it needs a lawful basis (usually legitimate interests with a documented assessment), minimisation and retention limits.
- Using transcripts to train or improve models is a *separate* purpose.
- Voiceprint or speaker identification may count as biometric special-category data.
- The host's consent does not cover other participants.
- https://measuredcollective.com/ai-note-taking-tools-and-gdpr-do-you-need-a-new-lawful-basis/ · https://ico.org.uk/for-organisations/advice-and-services/innovation-advice/previously-asked-questions/

**EU AI Act Article 50:**
- In force since **2026-08-02**.
- 50(1): providers must disclose that people are interacting with an AI unless it is obvious. This applies to a speaking Q bot.
- Marking duties under 50(2) are deferred to 2026-12-02 for existing systems.
- Commission guidelines were adopted on 2026-07-20.
- Fines up to €15M or 3% of turnover.
- https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026 · https://artificialintelligenceact.eu/article/50/

**Practice:**
- Name the bot clearly (for example, "Capital Q notetaker (AI) for <user>").
- Post a chat notice with opt-out instructions when it joins, and repeat it when new people join.
- Consider an audio announcement and a pre-meeting email.
- https://www.recall.ai/blog/5-ways-to-request-recording-consent-with-meeting-bots

---

## 9. Reminders

**Web Push:**
- VAPID with a service worker.
- On iOS it only works from **iOS/iPadOS 16.4, and only for a web app added to the Home Screen and opened from there**.
- Safari 18.4 added Declarative Web Push, which needs no service worker; it is still Home Screen only.
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ · https://webkit.org/blog/16574/webkit-features-in-safari-18-4/

**Calendar reminders:**
- Reminders set through the API are private to the authenticated user and are not shared with attendees.
- At most 5 overrides; popup or email; 0–40,320 minutes.
- https://developers.google.com/workspace/calendar/api/concepts/reminders · https://googleapis.github.io/google-api-python-client/docs/dyn/calendar_v3.events.html
- ICS `VALARM` is defined in RFC 5545 §3.6.6, but Google often ignores alarms in imported invites. https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html · https://support.google.com/calendar/thread/9627602

**SMS (Twilio A2P 10DLC):**
- Fees: $4.50 brand registration, $15 campaign vetting, and $12.50 Authentication+ for public companies.
- Brands not verified by 2026-01-30 get their campaigns suspended.
- Unregistered traffic pays carrier surcharges or is blocked.
- https://help.twilio.com/articles/1260803965530 · https://help.twilio.com/articles/29499398652059
- For the MVP, prefer email and in-app or web push.

---

## Recommended first slice (smallest compliant demo)

1. **Gmail send from the user's mailbox** with only `gmail.send`:
   - Q prepares the message; Capital Q stores the draft and a payload hash; the human approves; `messages.send` runs with an idempotency key.
   - Store the returned `id`/`threadId` and your own `Message-ID` so follow-ups thread correctly.
   - Nothing is written to the user's Gmail drafts, so no restricted scope and no CASA for the send path.
2. **Reply detection**, choose one:
   - (a) Demo: keep the Google app in **Testing** (up to 100 test users, re-consent every 7 days). Add `gmail.metadata`, then `users.watch` to Pub/Sub, renewed daily, plus `history.list`. Fall back to polling `history.list` every few minutes if Pub/Sub isn't set up.
   - (b) CASA-free production path: a Reply-To address on the platform domain handled by Postmark Inbound.
   - Decide before the first real users arrive, because a restricted scope means CASA every year.
3. **Google Calendar:** `events.insert` with `conferenceDataVersion=1`, a `hangoutsMeet` create request, and `sendUpdates=all`. Uses the sensitive `calendar.events` scope, or `calendar.events.owned`.
4. **Recall.ai bot** on Google Meet:
   - Name the bot, post a disclosure chat message, record and transcribe.
   - Skip Zoom external meetings (they need OBF tokens and a Marketplace review) and Teams (lobby admission) for the demo.
   - Output Media (Q speaking) comes after the notetaker works.
5. **Reminders:** email through Resend or Postmark from a platform domain with SPF, DKIM and DMARC, plus in-app notifications. Web Push later.
6. **Keep all provider SDKs behind adapters.** No MCP exposed to the model. CRM export (HubSpot or Attio) comes later, as a projection.

**Accounts and keys the founder needs:**
- A Google Cloud project with the Gmail, Calendar and Pub/Sub APIs enabled; an OAuth client (Web); a consent screen in Testing with the demo users added as test users; a Pub/Sub topic that grants publish rights to `gmail-api-push@system.gserviceaccount.com`, plus a push subscription pointed at the API.
- A verified domain carrying the privacy policy and homepage (needed for verification later).
- A Recall.ai API key and region, and a webhook secret.
- Postmark (or Resend) with sending-domain DNS for SPF, DKIM and DMARC, plus an inbound domain or MX if using option 2(b).
- Optional:
  - Deepgram key ($200 credit).
  - ElevenLabs key.
  - Microsoft Entra app registration, if Outlook is needed. Expect an admin to consent to Mail.* and Calendars.* in enterprise tenants.
  - Zoom Marketplace app, only if Zoom external meetings are in scope.