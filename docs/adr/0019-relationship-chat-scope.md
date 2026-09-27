# ADR 0019 — Relationship chat (R34): scope, peer chat and transport

Status: **Proposed** (lead-owned, for review; peer chat needs a PADL amendment)
Date: 2026-09-27
Requirement: R34 (founder-requirements-2026-09-25.md), R33 (registry)

## Context

The founder asked (R34) for 1:1 chat between people who have a relationship:
founder↔investor, founder↔founder and investor↔investor, realtime, with text,
documents, voice notes and Q present on invocation.

The controlling sources say:

- Product Specification §6.6.6: "Messaging belongs to the Match. Once both
  sides have mutually agreed to connect, basic communication should be
  straightforward."
- Product Specification §8.6.2: "Capital Q will not operate as an
  unrestricted messaging network. Founder-to-investor access remains
  governed by GateQ; suitability; verification; Q-structured introductions;
  bilateral Match architecture." Rule 16: network quality over messaging
  volume. §8.x Consideration Requests "differ from direct messaging".
- Doc 13 §33: `communication.conversations` with a nullable
  `relationship_id`, participants and messages; private Q conversations
  stay out of that table.
- Doc 17 §87: "Messaging exists to facilitate relationship progression. Do
  not recreate Slack." Material outgoing communication stays human-controlled.
- CLAUDE.md: one canonical company↔investor relationship; no parallel truth.

## Conflicts

1. **Peer chat (founder↔founder, investor↔investor).** The only canonical
   relationship is company ↔ investor organisation
   (`UNIQUE (company_id, investor_organisation_id)`). There is no canonical
   company↔company or investor↔investor relationship, no Match between
   peers, and §8.6.2 forbids an unrestricted messaging network. Building
   peer chat would require inventing a new relationship kind (a parallel
   truth) or open DMs (forbidden). **Not built.**
2. **Chat before a Match.** §6.6.6 places messaging after mutual
   connection. Chat is therefore open only when the canonical relationship
   projects to `CONNECTED` (interest expressed and accepted). Earlier
   states see the panel with a plain sentence, not a composer.
3. **Browser Supabase Realtime.** The session token lives in an HttpOnly
   cookie by design (q-stream route, CQ-C5-R1 §13); a browser Supabase
   client needs that JWT in script. Not adopted.

## Decision (built now, conflict-free subset)

- One conversation per canonical relationship (`communication.conversations`,
  `UNIQUE (relationship_id)`), parties = the company's organisation members
  and the investor organisation's members, resolved from the canonical rows
  (never from client input). Tenant anchor = the relationship's tenant.
- Messages are append-only rows; an edit or an unsend is a new revision row
  (`revises_message_id`), a delete is a tombstone. Read receipts are a
  per-person cursor. RLS: only active members of either party organisation
  may SELECT; no client writes.
- `message_sent` is relationship **activity** (never moves state), payload
  names only the message id, scope `relationship_shared`.
- Transport: `/v1` list (cursor), send (Idempotency-Key), mark-read, unsend;
  the web panel polls the cursor while visible (3 s) and refreshes after
  each send. `communication.messages` is also added to the
  `supabase_realtime` publication under RLS so a server-held realtime
  channel (or an SSE bridge like q-stream over LISTEN/NOTIFY) can replace
  polling without a schema change.
- Attachments and voice notes are document references to the sender
  organisation's own documents that went through the existing upload
  pipeline (scan first); bytes never pass the app origin.
- Q: present, but acts only when a person invokes it (@Q or the Ask Q
  button). It reads a thread only for a party (list_messages tool), and
  sends only as a Prepare→Approve `chat.message.send`. Reminders and
  meetings from chat are prepared proposals; their execution returns
  `NOT_CONFIGURED` until BIZ-008 lands.

## Proposed amendment (needs founder/PADL decision)

Peer chat could be admitted only as a **consented peer connection**: a new
canonical `network.peer_connections (organisation_a, organisation_b)`
with its own request/accept events, GateQ-style controls and integrity
signals, and the same `communication.conversations` row keyed by it
(`relationship_id` nullable per doc 13 §33, plus `peer_connection_id`).
That is a new canonical entity, so it is a PADL amendment, not a worker
decision.
