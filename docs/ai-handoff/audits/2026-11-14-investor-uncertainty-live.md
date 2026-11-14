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

## Live re-check 14 Nov (d2ce8c91e): scenarios 3–6

Production d2ce8c91e (includes 7fb21f2c5). Investor `investor.savanna-seed@fictional.capitalq.local` (app user d2ac720a), 17:02–17:08 UTC, four Q turns. Cost: 43 model calls, USD 0.2241 (reservation 8155cb17). Nothing approved, sent or created: no `q_runtime.actions`, no `network.diligence_requests` rows since 17:02. The old chat.message.send approval 7850ac2b was not touched.

| #   | Scenario                                              | Result           | Evidence |
| --- | ----------------------------------------------------- | ---------------- | -------- |
| 3   | Ajopot (3fa64633, IN_DILIGENCE): offer → yes → approval card with `about` | FAIL | Conversation 46bcc0db. Turn 1, run 8039bfd5: good substance ("a directional signal, not … decision-grade traction evidence"; findings typed USER_CLAIM/SELF_REPORTED; resolveBy "a reconciled six-month cohort table … reconciled to partner-bank or transaction records"), but **no offer**: Q told the investor to "ask Ajopot" and offered nothing (`open_threads` empty). Turn 2 "Yes, please prepare that request to Ajopot.", run c5fbdd3f: a NAVIGATION_OFFER "Messages is ready to open", then "What would you like me to do with Ajopot's request? … Would you like me to draft the request to Ajopot for your approval?" Turn 3 "Yes.", run b6e565fb: "I couldn't do that from this conversation: that action isn't available to me here, so nothing was prepared or changed." (gap DECLARED_NOT_OFFERED). No action, no approval card, no `about`. |
| 4   | Track/re-assess the item                              | NOT RUN          | No request exists to track (scenario 3 produced none); turn cap. |
| 5   | Kazikit (0989a281, INTEREST_EXPRESSED), same ask      | PARTIAL          | Conversation 122975cb, run dea2efd9. Refused correctly and leaked nothing: "Diligence hasn't started with them, so a document request can't go yet. Questions can go in your connected chat, or you can ask for a document once diligence starts." No action, no request. But the substantive part (how solid the revenue figures are, what the investor may see) was not answered at all: the action's not-open line replaced the answer. "Connected chat" is offered at INTEREST_EXPRESSED, before CONNECTED. |
| 6   | New evidence changes Q's assessment (addendum item 7) | NOT RUN          | Needs a fulfilled request; none could be created. |

### Defects, ranked

1. **D5 (high): no offer on the material uncertainty.** Run 8039bfd5 names materiality and resolveBy but makes no offer, so there is nothing for a yes to bind to and the 7fb21f2c5 re-binding never runs. Check whether the model's offer was dropped as unbound in `packages/model-gateway/src/q/offer-binding.ts` (an offer of a tool this run does not hold is "not said") and whether the home-page run's tool plan includes the diligence vehicle (`uncertainty.ts` route chooser, run tool focus in `q/index.ts`).
2. **D6 (high): the investor's explicit request is not executed.** "Prepare that request to Ajopot" became a Messages navigation offer plus a clarification. The clarification's yes was refused as DECLARED_NOT_OFFERED (`couldNotDoLine`, `q/index.ts` ~13262): the model reached for the diligence tool but the run did not offer it. A diligence request from /home on an IN_DILIGENCE relationship should be in the plan. A CLARIFICATION_REQUEST is also not recorded as an offer, so its yes binds to nothing.
3. **D7 (medium): a stage refusal replaces the answer.** On Kazikit, `DILIGENCE_REQUEST_NOT_OPEN` (`packages/app-actions/src/actions/diligence.ts:429`) is the whole reply; the addendum's "answer first" needs the authorised analysis followed by the refusal.
4. **D8 (low): wrong alternative at INTEREST_EXPRESSED.** The same line points to "your connected chat" before the pair is connected. The line should name what is available at that stage.

Screenshots: /tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/unc/{r3,r3b,r3c,r5}/
