# Uncertainty offers: root cause of scenario 3's three live failures (14 Nov 2026)

Scenario 3 is the investor at Ajopot (IN_DILIGENCE, `diligence_started`). They ask how solid a figure is, Q answers and offers, they say yes, and an approval card for a diligence document request appears carrying `about`. It failed live three times. Each fix passed its tests and failed again live. See [2026-11-14-investor-uncertainty-live.md](2026-11-14-investor-uncertainty-live.md).

| Live run                       | What happened                                                                                            | Fix shipped                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| b6f3d7fbb, ec736742            | The offer was bound to the wrong vehicle: the model named `propose_email`.                               | 7fb21f2c5: message → vehicle rebind  |
| d2ce8c91e, 8039bfd5 / c5fbdd3f | No offer was made. Then "please prepare that request" became a clarification.                            | 0701fac1a: code's own offer (D5), D6 |
| 06910b145, d2da404e            | The model offered via `propose_chat_message`. The decision was **PASS** and the yes made a chat message. | this change                          |

## Shared cause

Code was meant to choose the vehicle from the relationship's stage. It actually decided from incidental details of the model's output and of the run, each read separately:

1. **The tool the model named.** A vehicle was kept or dropped, an email or message passed untouched, and an unheld tool vanished. Each fix added one more tool name to a list (7fb21f2c5 added the message tools).
2. **Which item backs the offer.** For the model's offer, `materialUncertaintyFor` needed either an `about` that matched an item, or exactly one material item. The 06910b145 answer, "until Ajopot defines "active"…", carried more than one material item: the definition and period, and reconciliation to bank records. With `about` null or reworded, nothing backed the offer, so `decideUncertaintyOffer` returned PASS. Code's own offer (D5) already read the backing item more leniently (the first material open item settled through the founder). So whether an offer appeared depended on whether the model had offered first.
3. **Whom the turn is about.** `subjectCompany` needed exactly one complete profile read by the run, or a single relationship read. An investor's run reads the named company and often another one too (their own records named in the turn, a peer, the bound focus). With two profiles the subject was null, the vehicle was null, and the result was PASS (model offer) or no offer at all (D5). The reader's own `namedOther` ("Ajopot", already used for the "What I checked" line) was never consulted.

Evidence: the regression replays in `packages/model-gateway/test/q-answer-tools.test.ts`, under "root cause replays". They use the live shape: Ajopot plus a second company read, two material items, the model's `propose_chat_message` offer with `about` null, and no relationship read by the model. All three live shapes fail on 939ad92d0 (06910b145 PASS, d2ce8c91e no offer, explicit-request PASS) and pass with this change. Points 2 and 3 each independently produce PASS on the old code. The live log line carried only `decision`, so it cannot say which one fired on d2da404e. The new log line can.

## Invariant (adopted, checked against the code)

> On an investor's turn, the vehicle for an offer whose purpose is to obtain information from the counterparty company is chosen by code from the relationship stage's route: diligence documents while diligence is open, then an on-request data-room document, then questions to the founder. The tool the model named does not choose it. Before the pair is connected, no request offer stands, and the step is said once.

"Purpose is to obtain information" is read from structure only:

- the offer is a message or vehicle to the company, **and**
- one of these holds: a material, still-open uncertainty settled through the founder backs it (the item `about` names, else the first such item); or the offer's own `about` says it resolves an uncertainty; or the turn reader read the turn as asking for a vehicle (`askedAction`).

A message with none of these stays a message, for example "message them to set up a call". Every vehicle still runs its own authorize step at prepare time, approval binds to the exact payload, and the yes runs only the bound tool. Whom the turn is about is the reader's `namedOther` company wherever the run read it. Only otherwise is it the single profile or relationship read.

## What changed

- `packages/model-gateway/src/q/uncertainty.ts`:
  - `offerBacking` is one rule for the model's offers and for code's own: the named item, else the first material open item settled through the founder.
  - The message branch of `decideUncertaintyOffer` reads `seeksInformation` and `askedVehicle`. It re-binds to the stage's vehicle, or returns NO_ROUTE before connection.
  - `offerDecisionTrace` records, for the log, the counts, the backing kind, `offerAbout`, the subject, the state, whether diligence is open, and the vehicle.
- `packages/model-gateway/src/q/index.ts`:
  - The subject comes from `namedOther` first.
  - The decision log line carries the trace and `holdsDiligence`.
  - A new line, "a material uncertainty closed with no offer of code's", carries the predicates that held code's offer back.
- D10 (`packages/q-tools/src/tools/profile-material.ts`): a LOCKED room returns no `documents` list, and its line says the room is not open yet, never that it is empty.
- D11 (`offer-binding.ts` `closingLineNote`): when code closes the answer with its own line, such as a stage limit or a plan offer, the answer is told the line word for word and told not to say any of it. It is then said once.

## Live re-check (next deploy)

As `investor.savanna-seed`, use a new conversation on /home.

1. Ask "How solid is Ajopot's active users figure?". Expect the answer first, then exactly one offer. In the q-api log, "held against its materiality and route" should show `decision: REBIND` (or KEEP), `vehicle: diligence_documents`, `subject: KNOWN`, and `diligenceOpen: true`. If the model made no offer, the log should show "code made the offer".
2. Say "Yes.". Expect a **diligence_documents** approval card (REQUEST) whose payload `resolves`/`about` names the active-users item. Do not see a chat.message.send card.
3. In a new conversation, ask about Kazikit: "How solid are their revenue figures? Ask them for accounts.". Expect analysis first, the stage line once, no diligence card, and no "no documents" claim.
