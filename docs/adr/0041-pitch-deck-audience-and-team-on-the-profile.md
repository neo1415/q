# ADR 0041: A pitch deck's download audience, and the team on a company's profile

- Status: Accepted (founder decision, 2026-10-02)
- Amends: `evidence.documents` (migration `20261118000000_document_download_audience.sql`), the company profile route (`apps/api/src/http/company-profile.ts`), the app-action registry (ADR 0040)

## Context

The company profile opened from Discover (build/profile-1) could offer a
pitch deck only where the founder had sent it in the relationship chat
(R34), because documents had no audience: every document is
`organisation_private`, and chat opens only on connection. It also showed
no team: team and founder-profile reads were owner-only, and the founder
profile's summaries are `founder_private` by default. Both were flagged
rather than built. The founder decided both on 2026-10-02.

## Decision

1. **A deck has one download choice, like the pitch.** A founder sets who
   may download a `PITCH_DECK` document as one choice in the pitch's own
   words: "Only my organisation" (`ORGANISATION`, the default) or
   "Investors who can find us" (`INVESTORS`). Stored as
   `evidence.documents.download_audience`; the database allows `INVESTORS`
   only on a `PITCH_DECK`, and a deck reclassified as anything else stops
   being shared.
2. **"Who can find us" is the pitch rule, unchanged.** An investor may
   download an `INVESTORS` deck exactly where media's
   `resolveViewableCompany` admits them to the company's pitch (their own
   investor organisation, its ACTIVE mandate, the company eligible now).
   The API reuses that function as-is; there is no second, looser rule.
   The download is a 60-second signed URL of the current, scanner-CLEAN
   version, browser to storage. The chat-shared path stays.
3. **It never widens anything derived from the deck.** It is a separate
   column, not `visibility_scope`: sources, evidence and Q knowledge
   extracted from the deck keep their own scope. Sharing the file is not
   sharing what Q learned from it.
4. **Recorded like any disclosure change.** `document.manage` (as
   `media.manage` is for the pitch), the version the screen saw, one audit
   entry `document.download_audience_changed` and one event
   `evidence.document.download_audience_changed` (ids and the new value
   only). Setting the value it already has records nothing.
5. **One action, two callers (ADR 0040).** `document.deck_audience.set`
   (tool `set_deck_audience`, CONSEQUENTIAL) generates
   `POST /v1/documents/:documentId/download-audience` for the documents
   page and Q's prepared, approved action.
6. **Team on the profile.** An investor who can find the company (the same
   rule as 2) and the owner see the current team: each member's name, how
   they relate to the company, their declared title, whether they
   represent themselves as a founder, and their declared professional
   summary bounded to 600 characters. Nothing else: no contact details, no
   background summary, no ids, no visibility label, nothing not declared
   for the team profile. The projection is an allow-list
   (`projectTeamForNetwork`). A founder viewing another company still sees
   only its identity and network videos.

## Consequences

- An investor whose mandate does not admit the company sees neither the
  audience deck nor the team, the same as its INVESTORS-audience pitch.
- The founder's choice to show professional summaries to investors who can
  find the company is this decision; the founder profile's own
  `visibility_scope` is unchanged and still governs every other read.
- Turning the deck back to "Only my organisation" revokes it on the next
  request; a URL already issued expires within 60 seconds.
