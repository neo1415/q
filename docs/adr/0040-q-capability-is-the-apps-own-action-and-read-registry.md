# ADR 0040: Q capability is the app's own action and read registry

- Status: Proposed. The founder asked for it on 2026-10-02: per-gap patching kept missing things. The latest gap: Q had no idea Nixo's pitch existed and couldn't change its playback, and the parity audit had missed it.
- Amends:
  - doc 12 §Tools (how tools come to exist);
  - doc 22 §Routes (how mutation routes come to exist);
  - the R20/R33 parity guard (`apps/q-api/test/route-capability-parity.test.ts`);
  - the action-parity audit (`docs/handoff/research/q-action-parity-2026-10-02.md`).
- Does not amend:
  - the Approval Engine (ADR via doc 12 §Authority);
  - the Context Firewall;
  - the turn reader.

## Context

A screen and Q could do the same thing through two hand-written paths:

- an HTTP route for the button;
- a Q tool, sometimes calling a different port, with its own idea of who may do it.

Every new screen action needed someone to remember to write the tool. The audit found the misses one at a time. Live, Q told a founder there was "no record" of a pitch on their own pitch page.

## Decision

### 1. Declare each user-initiated action once

Each action is declared once in `@capital-q/app-actions`. The declaration holds:

- a stable dotted name;
- a Zod canonical input;
- the authorize step, the same check the route applies;
- the one service call;
- a classification:
  - READ;
  - INSTANT: the person's own word, done at once;
  - CONSEQUENTIAL: Prepare → Approve, bound to the exact payload;
- the approval card's summary and preview, and its targets;
- Q's sentence afterwards;
- the HTTP shape: its own method and path, never a catch-all, plus the response contract;
- the tool shape: name, model input, and which fields are references;
- two phrasings for the eval.

### 2. Generate routes, tools and approved actions from the declaration

- **Routes** (`apps/api/src/http/app-actions.ts`): parse the declared input, run its authorize step and service call, and answer in the route's existing contract. Every refusal is the same 404.
- **Q tools** (`packages/q-tools/src/tools/app-actions.ts`): run in-process as the actor, through the same service. The model never makes an HTTP call, so the tool rules hold: typed, authorized, bounded, no raw credentials.
  - INSTANT runs at once.
  - CONSEQUENTIAL is prepared on the approval board.
  - The idempotency key comes from the run, the action and the input.
- **Approved actions** (`apps/q-api/src/composition/app-actions.ts`): each CONSEQUENTIAL declaration becomes `app.<name>` in the Approval Engine. On approval it runs the same authorize step and service call, as the approver.

### 3. Resolve names in one place

A field typed as a COMPANY, RELATIONSHIP, DOCUMENT, MEDIA or REHEARSAL reference accepts the name as said, misheard included. One coercion (`resolveReference`, `closestByName`) matches it among the records of that kind the person can already see. Rules:

- It takes only one clear match. Several matches are asked about; none means nothing is done.
- A pointing phrase ("my pitch video") with exactly one record of that kind means that record.
- An id from the model is taken only when this turn's plan targets it (a company), or when it is one of the person's own records. The model can name, never widen.

### 4. One read tool: read_my(kind, filter)

`read_my` returns what the page shows, through the page's own service and authorization. Kinds in this slice: media, documents and rehearsals.

A compact WHAT EXISTS index is read every turn: per kind, a count and up to three titles with their state. HARDEN's `ownIndex` port carries it into the answer, so Q never says "no record" about something on the person's screen.

### 5. The guard becomes structural

- Hand-written mutation routes may only shrink (`LEGACY_MUTATION_ROUTES_MAX`). A new action must be declared, and its route and tool are generated.
- Every declaration must have a capability entry for its tool.
- The capability registry builds those entries from the declarations, so the tool, the capability and the parity guard all come from one list.

### 6. The parity eval (`scripts/evals/q-parity/run.mjs`)

For every declaration it generates three cases: two phrasings with a real record's name, and one with the name misheard. Every read kind gets two questions. Each case runs as a fictional account and asserts the right action was prepared or executed, or the right read answered. It outputs a pass/fail table.

The eval is not in CI because it costs model calls. Run it on demand and nightly. The current slice is 17 cases, about 34 model calls, at most about $0.70 per run.

## Consequences

- A screen action without Q parity becomes a build failure rather than a live report.
- The screen and Q share one authorize step and one service call, so they can no longer disagree about who may do what.
- Route-level concerns stay per action, in the declaration: idempotency keys, response contracts, and a refusal as the one 404.
- Areas migrate one at a time. Until an area migrates, its hand routes stay under the legacy count, and its hand tools stay as they are.

## First slice (this change)

- **Pitch:** `pitch.details.set` (CONSEQUENTIAL for Q). One choice for title, audience and playback. It replaces the hand route `POST …/pitch/:id/details`. Q's tool is `set_pitch_sharing`.
- **Discovery:** Save, Unsave, Pass and Undo pass (INSTANT). They replace the hand routes and the hand Q tools. The tool names stay `save_company`, `unsave_company`, `pass_company` and `unpass_company`.
- **Reads:** `read_my` covers media (pitch status, who can watch, whether investors can play it), documents and rehearsals. These feed the WHAT EXISTS index.
- **Documents:** the person's only screen mutations on documents are the brand kit and uploads, which take a file. They migrate with the documents area. Revising a document stays a Q-only tool until it has a screen action.

## Migration checklist (the rest), sized by area

Sizes:

- S: up to 2 actions, about half a day for a worker.
- M: 3 to 5 actions.
- L: 6 or more.

Each area follows the same steps:

1. Declare the actions.
2. Delete the hand routes and hand tools; the guard count drops.
3. Add the area's read kind to read_my.
4. Run the eval.

A form with several operations (a raise: create, update, close, replace) is one family (`defineAppActionFamily`): each operation keeps its own declaration and route, and Q gets one tool for the form, because a run offers at most MODEL_TOOLS_MAX tools and the operations are one thing to the person.

Exempt routes stay exempt, each with its reason: webhooks, Q transport, the operations console, public surfaces, the player, commitments, billing and meeting-assistant consent.

Profile and records (L, highest value; Q already proposes these through hand tools):

- [x] Profile: `me`, `companies`, `investors` PATCH; `company-team` ×3; `q-cards` ×2. **L** Done 2026-10-02: eight routes generated and nine generated tools replace `propose_profile_change`, `propose_team_change`, `propose_handle_claim` and `propose_q_card_change`. The two `me` routes stay hand routes, because they serve a person who has no organisation yet and a generated route needs an organisation's actor context; `person.profile.update` is declared for Q only.
- [x] Capital (raise): `capital-objectives` ×4. **M** Done 2026-10-02: four declarations, one family tool `change_my_raise` replacing `propose_raise_change`.
- [x] Mandate: `investor-mandates` ×3. **M** Done 2026-10-02: four declarations (activate and close are two), one family tool `change_my_mandate` replacing `propose_mandate_change`.
- [x] Visibility and shares: `companies` visibility, `investors` visibility, `visibility` ×2. **M** Done 2026-10-02: four routes generated; `set_investor_visibility`, `share_my_raise` and `stop_sharing_my_raise` (the investor named as said) replace the hand tools. The company's visibility stays on the turn reader's SET_VISIBILITY hand (`viaHand`) until its owner retires the hand.

Relationships:

- [ ] Interest and connection requests: `network-interests` ×3. **M** Step 1 done 2026-10-02: six declarations (express; accept and decline interest; send, accept and decline a Connection Request) with generated routes. Q still uses its relationship tools (`legacyTool`), which errands and the pending-decision path build on; step 2 needs their owner.
- [ ] Chat: send, unsend, block, unblock, report. Unsend, block and report stay the person's own: INSTANT for the author, never Q-initiated. **M**
- [ ] Schedule: meetings, cancel, reminders, dismiss. **M**
- [ ] Errands and Q work: `errands`, `work` ×4. **M**

Media and documents:

- [ ] Pitch: create, upload session, cancel and delete. These need the person's file, so they are declared as READ plus an offer. The playback-policy route folds into `pitch.details.set`. **M**
- [ ] Documents: upload sessions ×3 (file: offer) and the brand kit ×4 (`q-documents`). **M**
- [ ] Profile images ×3 (file: offer). **M**

Settings and the rest:

- [ ] Settings: notification settings, Q personality, Q Daily ×2. **M**
- [ ] Onboarding: 9 routes, kept on the ADR 0016 loop's own tools. Declaring them is mostly mapping. **L**
- [ ] Approvals: approve, reject and email-draft edit. **S**
- [ ] Integrations: Google connect and disconnect (OAuth: offer). **S**
- [ ] Verification and KYB. **S**

Read kinds to add to read_my, each where its page already reads:

- [ ] relationships;
- [ ] saved and passed;
- [ ] meetings and reminders;
- [ ] Q work;
- [ ] Q Daily;
- [ ] plan and billing;
- [ ] verification;
- [ ] notifications;
- [ ] settings.
