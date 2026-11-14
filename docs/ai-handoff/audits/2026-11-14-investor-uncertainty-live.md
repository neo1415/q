# Investor uncertainty: live certification (14 Nov 2026)

Production b6f3d7fbb (includes afd1ba264). Migration 20261231550000 is applied (`network.diligence_requests.about`, `about_standing` present).
Investor `investor.savanna-seed@fictional.capitalq.local`, conversation `fca08ca4-1b88-40e0-8cd6-95edd64328f7`, 13:32:31–13:39:35 UTC.
Cost: 45 model calls, USD 0.2516 (reservation b1a319b3 recorded). Five investor turns used (cap).

Diligence pair: Ajopot × Savanna Seed, relationship `3fa64633-9902-4aef-bcf8-4b67af184dac`, IN_DILIGENCE. All members are fictional (founder.ajopot@, member.ajopot.yusuf-danladi@).

| #   | Scenario                                         | Result       | Evidence                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Maji Loop MRR Oct 2026                           | PASS         | Run e37644af. Reply: "MRR isn't on record… KES 58 million revenue for 2025 (annual, not MRR)… What I checked: Capital Q's records you can see on Maji Loop. Public sources weren't read this turn because the web search was unavailable". No USD 120,000, 42,000 or 110,000.                                                                                        |
| 2   | Material figure (Ajopot 18,700 of 52,000 active) | PASS (minor) | Run 76234bfc. Standing ("company-reported; definition and period not established"), materiality (supports or weakens the thesis), resolveBy (a cohort table reconciled to the partner bank), and one offer ("Want me to draft that focused diligence request to Ajopot?"). Defect D3: the public-search absence is said twice.                                       |
| 3   | yes → approval → `about`                         | FAIL         | First yes, run b58ece1a: FAILED, NORMAL_DIALOGUE INVALID_MODEL_OUTPUT, but shown as "can't reach my reasoning service". Re-offer, run ec736742, then yes, run 28635630: action 5d8bec51 is **chat.message.send** ("Message Ajopot…", approval 7850ac2b, AWAITING_APPROVAL). This is not diligence.document.request. Not approved. No diligence_requests row created. |
| 4   | Founder fulfils                                  | NOT RUN      | There was no request to fulfil. The UI path is /documents → "Share a document you have".                                                                                                                                                                                                                                                                             |
| 5   | "since you asked"                                | NOT RUN      | Turn cap                                                                                                                                                                                                                                                                                                                                                             |
| 6   | Unauthorised request                             | NOT RUN      | Turn cap. Candidate: Kazikit (INTEREST_EXPRESSED, members all fictional).                                                                                                                                                                                                                                                                                            |

## Defects, ranked

1. **D1 (high): the route is wrong on yes.** The relationship is IN_DILIGENCE and Q offers "a focused diligence request", but the yes prepares a chat message (the email fallback). The route rule "diligence_documents when in diligence" did not hold live, so `about` can never reach a request. Check what the offer record bound for run ec736742 (action name) and the route chooser in model-gateway `uncertainty.ts`.
2. **D2 (high): a failed turn drops the standing offer.** In answer.ts around line 9230, any outcome without an offer deletes the ACTION offer. The person's retried "yes" after a transient failure cannot bind.
3. **D2b (medium): the failure message is misleading.** INVALID_MODEL_OUTPUT is reported to the person as Q_UNAVAILABLE ("can't reach my reasoning service").
4. **D3 (low): the absence line repeats.** The answer says the public-search absence and then the code line says it again. The guidance not to say it twice is not honoured.
5. **D4 (info): web search is unavailable.** It was unavailable on all 4 analysis turns. The FAST_CLASSIFICATION calls time out on attempt 1 and fall back (attempt 3) at about USD 0.06–0.07 each, which is most of the cost.

## Records created

- One pending chat.message.send approval (7850ac2b), Savanna Seed → Ajopot, both fictional. It is not approved and expires 2026-11-15 13:38 UTC.
- No messages were sent and no diligence requests were created.

Screenshots: /tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/unc/{s1,s2,s3,s3b}/
