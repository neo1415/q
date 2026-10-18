# ADR 0023 — Founder Investors page and Connection Requests

## Status

Accepted on 2026-09-29, by founder decision ("Full: page + requests").
Sources: PADL #98 (bilateral discovery) and the GateQ specification items
11–13 (investor Open / Gateway / Closed modes; founders reach investors only
through a structured Connection Request, never a cold message).
Migration: `20261023090000_founder_connection_requests`.

## Context

Founders could already see discoverable investors on Discover. They had no
way to reach one. Three things were missing:

- `network.interests` allowed only the INVESTOR party.
- The investor's onboarding answer "How should founders reach you?"
  (`I10.inbound_preference`: CLOSED / QUALIFIED / OPEN) was recorded but
  never enforced.
- Investor photos were readable only by the investor's own organisation.

## Decision

1. **One relationship, one mechanism.** A Connection Request is an interest
   on the one canonical relationship, expressed by the COMPANY party. The
   investor organisation answers it through the same path a company uses
   to answer an investor (`answerInterest`), recorded as
   `responded_by_party = 'INVESTOR'`. The history, match, state projection
   and chat are therefore the ones an investor's interest produces. There
   is no parallel request record.

   The `interest_expressed` payload carries `expressedByParty`, so the
   next step reads AWAIT_ANSWER for the sender and ANSWER_INTEREST for the
   receiver. Events written before this change carry no value and are
   treated as INVESTOR.

2. **The investor's own rule decides.** The rule lives in
   `core.investor_organisations.inbound_preference`, one of:
   - **OPEN:** any founder who can see the investor may send a request.
   - **QUALIFIED:** only when the company passes the hard rules of the
     investor's ACTIVE mandate. This uses the eligibility policy's own
     `evaluateHardEligibility` through `qualifiesForInvestor`. No investor
     actor is invented.
   - **CLOSED:** no requests.
   - **Not stated (NULL):** no requests. Unknown is never consent.

   Only ELIGIBLE qualifies: no active mandate, or a rule the company's facts
   cannot answer, does not.

   The column was backfilled from each organisation's current I10 answer.
   New investors set it through the onboarding confirmation, because the I10
   step's published definition is hash-locked and cannot gain a write
   target. They can also set it under Visibility, and Q can set it with the
   investor's approval (`investor.profile.update`).

3. **Who sees what.**
   - A founder sees only the investors discovery would show them
     (network-visible and admitted by disclosure). Any other investor is
     the same 404 as one that does not exist.
   - Investor photo and cover are minted as signed URLs only after the
     investor was returned to that reader.
   - The investor's inbox names the company's canonical name. The company
     page it links to shows only what disclosure allows. Nothing is
     founder-private.
   - A request carries no message: messaging opens on connection
     (ADR 0019).

4. **Capabilities.**
   - `company.connection.request` lets a company member send a request.
   - `investor.connection.view` and `investor.connection.respond` let an
     investor organisation's members see and answer requests.
   - All three are granted to `organisation_admin` and
     `organisation_member`.

5. **Surfaces.**
   - `/investors`: a founder sees investor cards; an investor sees
     "Founder requests".
   - `/investors/[id]`: the investor's visible profile and the request
     button.
   - Discover links investor names to their page, and Relationships links
     investors to their requests.
   - Q offers both acts (`offer.connection_request`,
     `offer.connection_request_answer`). Q never sends or answers a request
     itself.

## Consequences

- One open request per party per relationship still holds
  (`interests_one_open_per_party_idx`). A declined request stays declined:
  interests are not withdrawn in V1.
- A founder whose company does not qualify is told so in the investor's
  own terms. Nothing private about the mandate is disclosed.
- **Follow-up: GateQ precedence.** GateQ's published gateway has its own
  `inbound_mode`. When gateways are enforced for founders, the published
  gateway mode should take precedence over this column. That needs a
  GateQ-owned read port, and is flagged here rather than merged silently.
- **Follow-up: Q navigation.** Q's NAVIGATE hand has no INVESTORS
  destination yet. Adding one requires a new turn-reader prompt version.
  Until then, Q offers the act through Discover and Relationships.
