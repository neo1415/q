# GateQ founder interface — 2026-10-13

IMPLEMENTED / LOCAL TESTED on `codex/gateq-founder-interface`; integrate with the lead's backend race/contact repairs before release. No deployment or browser acceptance claimed.

- The existing form checks the frozen published qualification, then enters the existing `ApplyExperience` without submitting.
- Confirmed contact gates the interview. Guests use the email-code route; authenticated applicants use the existing account-contact route. Neither creates membership.
- Authoritative ordered transcript and deterministic coverage drive the interview and review. Review exposes answered/unknown/declined/missing dimensions, contradictions, qualification and selected document names. Submit remains explicit.
- Gateway-specific sessionStorage retains the scoped bearer, form progress, pending turn text/ID and submission ID within the tab. Resume reads the existing application. No token in a URL or localStorage. Denied browser storage falls back to current-page memory.
- Failed or interrupted turns retain their ID/text and block replacement until recovered. Submit retries keep their ID and recover a lost successful receipt before attempting legacy material attachment again.
- The legacy selected-document action runs only at explicit Submit, because it also joins a canonical relationship. Document selection locks after a submission attempt; its additive attachment semantics must not disclose previously deselected documents on retry.

Validation: frozen install PASS; all 52 package builds PASS and the updated API-client target rebuilt PASS; focused form/interview/API-client/fit suite 29/29 PASS; app typecheck PASS; changed formatting and diff checks PASS. Changed lint passed all files except an unnecessary async form handoff; that handoff was made synchronous and its targeted lint PASS and form tests 10/10 PASS on the corrected handoff. Combined root typecheck was started before the lead reclaimed that gate and is not claimed as PASS; the lead owns the integrated root check with backend QA fixes.

Remaining integration: private replaceable application Evidence attachments and guest uploads; document-derived question/source acceptance; complete confirmed-contact details in resumed review; voice/Tavus authorization; real guest/authenticated browser journeys and performance measurement. No paid provider call, fake membership, migration or contract change in this slice. API-client additions consume existing schemas.
