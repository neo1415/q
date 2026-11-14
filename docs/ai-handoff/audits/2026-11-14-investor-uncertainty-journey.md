# Investor uncertainty journey: what exists (read-only audit, 14 Nov 2026)

Directive: `directives/2026-11-14-addendum-resolving-investor-uncertainty.md`, with decisions 91–97.

## By step

1. **Public research reaching the investor: PARTIAL.**
   - What exists:
     - Turns about a named company do research the web (`q-core/src/conversation/general-turn.ts:150-160`).
     - The research tool's guidance is in `q-tools/src/tools/research-public-web.ts:254-286`.
     - Prompt voices say "never say you have no information without first calling the tool" (`model-gateway/src/q/index.ts:1450,1965,2381`).
   - The gap:
     - Reuse covers only the last 3 Q turns and 8 pages of the current conversation (`earlier-research.ts:24-29`).
     - ADR 0009 makes an investor's research on a company it does not own TRANSIENT, so there is no durable public-claim store for later answers or tracking.
2. **Evidence standing: PARTIAL.**
   - The vocabulary (`contracts/src/evidence/vocabulary.ts:17-35`) has no value for "founder confirmed a third-party figure".
   - Independence and corroboration exist only in deep research (`q-research/src/domain/cross-check.ts`), and only for the actor's own subject. The chat path shows company-versus-page conflicts only (`figure-conflicts.ts`).
   - "I don't have … on record" was a firewall pass, because the founder's chat figure is private. But neither that wording (`conversation-receipts.ts:258`) nor `claim-check.ts:1009` says whether public sources were checked or what they report.
3. **Materiality: MISSING.**
   - The analyst output has findings, plus `missingEvidence` and `contradictions` as plain strings.
   - No field records why an uncertainty matters or how to resolve it. Offers are unconditional (`company-analyst.ts:580`).
4. **Diligence actions: EXIST, but are not connected to uncertainty.**
   - The actions:
     - `diligence.document.request` requires the investor side and IN_DILIGENCE. There is no prepare-time check, so an unauthorised request still gets an approval card and is refused only after approval.
     - `data_room.access.request` requires CONNECTED and an ON_REQUEST title.
     - `diligence.questions.send` sends a diligence request while in diligence, otherwise a chat message.
   - C3 offers (`offer-binding.ts`) bind a "yes" to the tool. Nothing ties an offer to the uncertainty it resolves, or chooses the authorised route before offering.
5. **Tracking and re-assessment: PARTIAL.**
   - What exists:
     - `network.diligence_requests` holds a title and a note, with no link to a question or claim.
     - Diligence questions carry an assumption id and the answer's evidence status.
     - Notifications fire on request, fulfilment and answer.
   - The gap: there is no "since you asked" note and no comparison of the earlier standing with new evidence. The conversation ledger tracks entities, not open questions.
6. **Verification categories: PARTIAL.**
   - KYB (`evidence.verification_claims`) is not exposed in Q's company tools. Q cannot say "identity verified, revenue not".
   - No adopted-from provenance exists yet (decision 93).

## Scenarios: today and needed

| Scenario                                | Today                                                                | Needed (slice)                                    |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Public claim, no company figure         | Research only on named-other turns; "not on record" can still appear | Absence wording names public sources (1)          |
| Independent corroboration               | Chat path cannot tell independent publishers from syndicated copies  | Cross-check in the research tool output (2)       |
| Conflicting public reports              | Only company-versus-page conflicts                                   | Page-versus-page contradictions (2)               |
| Founder-confirmed, unverified           | Looks the same as an unconfirmed USER_CLAIM                          | A provenance flag; ADR-001 amendment proposal (3) |
| Request prepared → approved → fulfilled | Actions and notifications work; no link back and no re-assessment    | (4–6)                                             |
| Unauthorised request                    | Card prepared, approved, then refused                                | Prepare-time check, no offer (4)                  |
| New evidence changes the assessment     | Missing                                                              | (6)                                               |

## Slices

1. **Absence wording.** Scoped to Capital Q's records, plus what public sources were checked and what they say. The private-figure firewall test stays.
2. **Evidence standing in chat.**
   - A versioned `research_public_web` output with a cross-check per source.
   - Page-versus-page contradictions in `figure-conflicts.ts`.
3. **COMPANY_ANALYST v34 `uncertainties[]`.**
   - Each uncertainty carries a statement, a standing, `material`, `mattersFor` and `resolveBy`.
   - Possible standings: REPORTED, CORROBORATED, CONTRADICTED, FOUNDER_CONFIRMED, DOCUMENT_SUPPORTED, INDEPENDENTLY_VERIFIED. None is ever derived from KYB.
   - An offer is made only for a material uncertainty.
4. **Choose the route and refuse before the card.**
   - The diligence request checks side and state when it is prepared.
   - The gateway picks the route in this order:
     1. a diligence document request, when IN_DILIGENCE;
     2. a data-room access request, when CONNECTED and the title is ON_REQUEST;
     3. questions to the founder, when connected;
     4. otherwise no offer, and a plain line saying what relationship is needed.
5. **Link the request to the question.** An additive nullable `about` on `diligence_requests` (a migration) and its contract. The relationship brief lists answered and fulfilled items with their evidence status.
6. **Re-assessment note.** On the investor's next turn about that company, a code-built note gives the earlier standing and the new evidence. Q then says what changed, what is resolved and what is still open. It never upgrades anything to verified.
