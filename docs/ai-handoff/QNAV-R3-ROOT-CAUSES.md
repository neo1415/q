# q-nav dev round 3: root causes of the remaining misses

Round 3 ran live on `6b07e3e` (receipt `receipts/2026-11-07-qnav-dev-r3.json`).
Results: 491 turns, 43 misses, 91.2% pass, wrong-page 2.44%, forbidden 0, $2.03.

The labs gate is ≥98% move-target exact and ≤0.5% wrong-page, and it is not met. Moves therefore stay OFFER-only (`CQ_Q_NAV_MOVES_ALLOWED` is unset). Per the stop criteria there is no more tuning against dev until the owner decides. This is analysis only: nothing here has changed code, prompts or the dataset.

**Method.** I paired each miss with its case from the dataset at `6b07e3e`, and read the model's own proposal and reason from the receipt.

**Caveat.** That export used today's site map (W3 `cd46eae` made RESULTS reachable), so some COVERAGE ids from about 087 onward are shifted. For those I used the live grader reason and the model's reason text, which restates the ask, and I name the ask rather than the id.

## 1. `sure` is too conservative: 15 OFFERs where a MOVE was wanted (the largest cost)

The model sets `sure:false` whenever it had to infer anything, not only when two places compete:

- "the gateway" → GateQ;
- "my plan" / "the plan tab" → the only tab titled plan;
- "voice settings" → How Q speaks for you;
- "What is Tamarind Pay raising?" → its overview;
- "yesterday's Daily" → the 5 November edition.

In each case it names one place and gives no rival.

Genuinely two-way cases are rarer:

- Q Pitch: /q-pitch (the tour) or /q-pitch/capital-q (the pitch);
- "search": People search or Explore;
- readiness and action plan asked together;
- "what did Savanna Seed ask me": the thread or the diligence questions.

**What would close it (owner decision; NAVIGATION_DECISION v5).** Make "unsure" falsifiable. Replace `sure` with an optional `alternative`: the other place, in the same shape as `place`. Code then:

- offers only when the alternative resolves to a different place the person may open;
- otherwise treats the proposal as sure.

This keeps the protection where two places really compete and stops self-doubt from costing a move. On r3's proposals that would turn about 10 of the 15 back into MOVEs. The rest are genuinely two-way and stay OFFERs, which is right.

## 2. STAY where a MOVE was wanted: 12

| Ask                                                          | Cause                                                                                                                          | What closes it                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Q's team map", "the map of Q's team" (my round-3 rewording) | The tab is titled just "Team" in the digest. With the no-substitution rule the model refuses a name that isn't listed.         | W2 titles the /work Team tab "Q's team" (asked); or the dataset uses "Q's team". A dataset/W2 mismatch, not the model.                                           |
| "Open the Ledgerline diligence brief"                        | The model put the document's title in `document` with route /documents and no `record`; code needs a record before a document. | Code: on a route whose record page is DOCUMENT, resolve `document` against their records' things. A small change; it only matches a titled record they may open. |
| "Rehearse a meeting with X" (every round)                    | The model insists a booked meeting is needed; the digest says "Rehearse with a company you are connected to".                  | W2 purpose line: "Rehearse a meeting with a company you are connected to (no booking needed)", if true in the app. Not a prompt rule.                            |
| "Open today's Daily" → /daily                                | /daily shows today's edition, so to a person it's the same place.                                                              | Owner decision: grade DAILY ≡ DAILY_EDITION(today) as the same place (like SEARCH ≡ EXPLORE), or keep the record and accept the miss.                            |
| "Which investors could fund us?"                             | Read as analysis made for the question.                                                                                        | Genuinely open: a list Q composes vs the Investors page. Leave it.                                                                                               |
| "Not sure we're ready for diligence, honestly."              | Reflective, not a request.                                                                                                     | A defensible STAY. Consider re-labelling this LOOKALIKE case as an OFFER.                                                                                        |
| "who runs led your line" (voice)                             | Garbled; Ledgerline vs Ledgerfold.                                                                                             | A correct STAY by our own rule (a name that fits two equally). The dataset should expect STAY here; I recommend that change, documented.                         |
| "briefing"                                                   | Q Daily editions vs other briefs.                                                                                              | A correct STAY.                                                                                                                                                  |

## 3. Wrong page: 12 (2.44%; the gate is 0.5%)

| Ask                                                                    | Model's place                             | Cause                                                                                                                                                  | What closes it                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "what Q needs from me" / "what needs my attention" / "what Q is doing" | /work with no tab, or the In progress tab | The tab titles (Needs you, In progress, Done) aren't tied to everyday wording, and the page-level WORK is always valid.                                | W2: per-tab purposes on /work (Needs you = what waits for you to decide or do; In progress = what Q is running now; Done = what Q finished). Digest clarity.                            |
| "is my data room ready", "what's missing" (founder)                    | /company/data-room, no section            | `missing` is listed only on /company/[companyId]; the founder's own route lists no sections. ownPlace already maps the page; only the section is lost. | W2: list the data room's sections on /company/data-room too (it shows the same view).                                                                                                   |
| "the team tab on my public profile"                                    | /profile#team                             | "Your profile" (/profile) vs the company profile (/company/[id]) are confusable for a founder.                                                         | W2 purpose: /profile = "your own details and settings you edit"; /company/[id] = "how a company's profile looks to others".                                                             |
| "Tamarind Pay's application to my gate"                                | /gateq inbox + section, no record         | The model named the list, not the record (the opensOn route is /gateq).                                                                                | Code: a THING record named on its opensOn route already resolves; here the model gave no record. A v5 prompt line: "a listed record goes in record, even when it opens on a list page". |
| "my companies in Discover"                                             | /discover (For you)                       | The tab title "Your companies" isn't matched to "my companies".                                                                                        | W2 tab purpose; the v4 tab rule wasn't enough.                                                                                                                                          |
| "billing"                                                              | /settings/plan, so STAY                   | W3 dropped SETTINGS_PLAN. The /settings section is "billing" (Plan and billing); the route is /settings/plan.                                          | Code: map a sub-route to the parent section whose title it carries (plan → "Plan and billing"), or W3 restores a target.                                                                |
| "what did savannah seed ask me" (voice)                                | the diligence page                        | The same "ask" ambiguity I reworded in the text cases; the voice row wasn't reworded.                                                                  | Dataset: reword the voice row too (documented).                                                                                                                                         |

## 4. A target on a STAY: 6 (ACCESS and NO_SUCH_PAGE)

| Ask                                                                  | Cause                                                                                                                                                                                          | What closes it                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder: "my GateQ inbox", "GateQ find" → /gateq                     | The model moves to their own GateQ (applications) in place of an investor-only tab. That's the substitution the v3 rule forbids, and it still happens because /gateq is a valid page for them. | Policy (owner): is this a helpful move or a substitution? If a substitution, code could compare the asked tab's title with the move. I recommend leaving it to the model; the cost is an OFFER while moves are off. |
| Investor: "my GateQ applications" → the inbox                        | To an investor, "applications" are the ones received, which is the inbox. Genuinely the same thing to a person.                                                                                | Dataset: drop this ACCESS case (documented), like "visibility settings".                                                                                                                                            |
| Investor: "my action plan" → Work's Needs you (sure:false, so OFFER) | Substitution.                                                                                                                                                                                  | Covered by the v5 `alternative` rule (no rival, so the model would have to decide).                                                                                                                                 |
| "Who's looked at my deck?" (both languages) → /company/interest      | The product invariant "viewing is not interest" isn't in the prompt.                                                                                                                           | v5 prompt: "Viewing is not interest: a question about who viewed something has no page until one shows views." Grounded in CLAUDE.md, not in the case.                                                              |

## 5. Summary: what would get to the labs gate

- **Code (small, general):**
  - a titled document on its route;
  - a sub-route to its parent section by title;
  - optionally, the DAILY ≡ today's edition alias (owner decision).
- **W2 digest clarity:**
  - per-tab purposes on /work and /company/[id];
  - "Q's team";
  - sections listed on /company/data-room;
  - the /profile vs company-profile purposes;
  - "no booking needed" on rehearsal.
- **Prompt v5:**
  - `alternative` in place of `sure`;
  - a listed record goes in record;
  - viewing is not interest.
- **Dataset (documented):**
  - the voice "ask me" row;
  - the investor "GateQ applications" ACCESS case;
  - "led your line" expects STAY.

My estimate, if all of these land: about 96–97% move-target, wrong-page about 1%. That's still under the labs gate. The remaining misses are asks that are genuinely open to a person, where an OFFER is the right outcome. With moves off, every miss today is at worst a wrong OFFER, which is harmless.
