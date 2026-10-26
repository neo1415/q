# Conversation log — 2026-10-25/26 (coordinator, owner and agent lanes)

A curated record of what was said, decided and why, for a session with none of
this context. The raw chat transcript is not committed because it contains
credentials the owner pasted into chat; nothing here quotes a secret. Read
`HANDOFF-2026-10-26.md` first for state and procedure; this file explains the
reasoning behind it.

## The people and agents

| Who             | Role                                                               | Session (old account)            |
| --------------- | ------------------------------------------------------------------ | -------------------------------- |
| Owner (Daniel)  | Product owner and founder; pays every provider                     | —                                |
| Coordinator     | Ran the lanes, merged, gated, deployed, measured production        | session_01SxtUYQjYXwv8hH5D5RGfsK |
| S8              | Web search, answer writer speed, guard fallback, readiness, F-135  | session_011s3rqy32JGFBg5ybKyEHJ2 |
| S9b             | TURN_READER owner (only owner), drafting routing, same-model hedge | session_01KctFpZXsXmBPZyuHQjKh9W |
| Lane 4          | Ranking, compare table, investor fit, DB round trips, email turn   | session_01YWifU5JkN4FbUyx6ZPQFKC |
| Onboarding lane | Founder and investor onboarding (web + q-api conductor)            | session_01Lu7zuVFv4PFdSPNRy6RkV9 |
| QA lead         | Browser QA on production; owns the premium scorecard               | session_01DrdU6xEd4TzjqBiVCUoBxw |

A new account cannot message these sessions. Treat this table as history.

## Owner directions (in substance, in order)

1. 10-25: get to **≥95%** on the premium scorecard ("95 is the least, 100 is the
   target"); a proper MVP. Onboarding must be solid.
2. 10-25: be prudent with spend (OpenAI balance fell from $28 to $6 in two days;
   the founder pays for every provider). Arabic deferred, English first.
3. 10-25: new Serper key with 2,500 credits put in Railway `SERP_API_KEY`. It
   works; the earlier 402s were the previous, spent key. Brave, ScrapingBee and
   Tavily are exhausted. An unused `RESERP_API` variable exists on q-api/workers.
4. 10-25: approved one fresh founder + one fresh investor e2e (done by QA:
   Tamba Freight / Harmattan Ventures, `*.qa-e2e-10251954@fictional.capitalq.local`).
5. 10-25: picture-cache backfill — "if the pictures are giving you issues, leave
   it for now". Not applied.
6. 10-26 ~03:15: angry that the weekend went in circles ("fix something without
   breaking another"). The coordinator froze all lanes; the owner corrected that
   — a complaint is not a reason to stop real fixes; latency people feel must
   still be fixed. Lanes were unfrozen for user-facing work.
7. 10-26: approved changing the turn reader to cut its fixed cost ("you can
   change this step").
8. 10-26: asked whether ~700–1,000 DB round trips per ranking is normal (it is
   not; good systems do 10–50). Decision: **finish the current work first, then
   remind the owner**; the next account may do it. Plan is in the handoff §7.
9. 10-26: keep the handover continuously updated and complete, including the
   agent conversations (this file).

## Decisions taken by the coordinator, and why

- **Research stays parallel for compares.** Declined three times (S8, lane 4,
  and a line sent to S9b then withdrawn) to stop web research for comparisons of
  on-screen companies: the owner's rule is "records and web always in parallel;
  never trade intelligence for speed". Cost accepted: compare settles 13–16 s;
  the table appears at ~3 s.
- **Prompt-injection boundary kept.** S8 proposed folding an already-landed web
  result into the first tool round to save ~1.5 s; refused because retrieved
  pages must never precede a model round that holds tools.
- **Approvals bind to what is visible.** Onboarding "That's right, keep all N"
  keeps exactly the readings rendered at that moment (by id), never one that
  arrives later; partial failure leaves the review unconfirmed.
- **Outward messages are never guessed.** Email/chat proposals that name the
  counterparty more than once must resolve to the same relationship, else they
  are refused (DIFFERENT_COUNTERPARTS) — #550.
- **No silent widening of disclosure.** #540 (raise disclosure batching) and
  #547 (pitch playback rule) required negative tests through real adapters:
  denied stays denied, other tenants never resolve, decisions identical to
  one-by-one.
- **Fit levels come from code only** (#530): a model may not set "Partial"
  sector fit by adjacency; unknown stays unknown.
- **No broad "crypto" alias** (F-137 A0): mapping "crypto" to the red-flag
  Speculative Crypto node would misclassify a founder's "crypto payments
  company". Instead unmatched words are kept in the investor's own words and Q
  may not claim they were saved as a category (#557).
- **Ship risky changes alone.** The reader change (v68, #545) was deployed by
  itself and accepted only after the full guard (31/32, every routing case
  unchanged). Rollback is one registry line.
- **No live provider keys in the sandbox.** The reader eval needs OpenAI in
  q-api's Railway environment; the coordinator did not pull provider keys into
  the sandbox and used the full production guard instead.
- **Spend caps per fix:** ≤6 live turns per lane, ≤25 for a QA re-score, eval
  ≤$0.50 (not run), shadow-reader comparison (≈$0.05) skipped.
- **Same-model hedge** only for the small argument/router calls at 3 s (#548):
  fires on ~0.6% of calls; worst case 8 s → ~4.5 s.

## What each lane found (root causes worth remembering)

- **Drafting regression (F-106):** #529's router saw every registry action, so
  replies were routed off the fast path; then a NOT_THIS_ACTION refusal's
  guidance was dropped (#538 follows it); then the reply detoured through
  answer_investor_question (#541 hides inapplicable declared actions).
- **"Top two stack up" slow:** the reader didn't map "top N of a shown list" to
  compare (#539, reader v67); the conversation context cut long lists at 3,200
  chars (outlined now). Writer output was ~1,500 tokens (#544 narrowed it).
- **False "Capital Q doesn't match companies and investors" line:** the
  recommendation guard's fallback was streamed as an interim sentence, and the
  guard lacked the run's computed fit grounds (#536).
- **Typed answers waited ~16 s:** the cards walked through at voice pace with no
  voice (#534).
- **Readiness 43 s:** a whole structured answer was refused over side fields
  (userStatements over cap, displayName/proposalStatus types) and rewritten twice
  (#551); the main writer also emitted fields conversations never show (#554).
- **Reader cost:** latency was driven by output length (all 29 fields written);
  v68 writes only fields that apply (−0.85 s/turn). v68 occasionally nested
  `nextSteps` inside `question` (2/49) — fixed in v69 (#553).
- **Email slow/failing:** the first propose_email carried `reason`, a field
  every other proposal tool accepts (#555); identifiers named twice were refused
  (#550).
- **Duplo founders missing + Lego Duplo picture (F-135):** company.get's own
  team schema lacked `source`, so every company whose founders come from public
  claims failed company.get; the profile and figures were dropped and the picture
  check had no identity (#558).
- **Investor "take me to Discover" failed (F-138):** the handoff step was saved
  against the session cursor (left on I0.website), so completion was refused
  with founder-only words (#556).
- **DB round trips:** raise disclosure resolved one by one (#540), the pitch
  playback rule ran four times per pitch (#547), deck views per company (#549).
  Remaining ~500–800 in fit_top_candidates — next slice.

## Scores

- 10-25 (5630e086f): 90/96 = 93.75%.
- 10-26 08:45 (5e922566c): 91/96 = 94.8% — Investor 40/44, Founder 30/30,
  UI 18/18, Onboarding 3/4. Below 2: I9 (F-135 Duplo), O2 (F-138, F-137), I21
  (first visible change 5.2 s), I19 (voice, not testable). F-135 alone → 95.8%.
- Receipts: `docs/ai-handoff/evidence/qa-premium/` on branch `qa/premium-scorecard`.

## Mistakes the coordinator made (so the next one doesn't)

- Let a slow wrong path pass because a guard case accepted any card list.
- Merged PRs while a gate was running, producing false failures and once a
  half-merged tree; always let the gate finish before merging more.
- Pushed a guard-file edit that failed Prettier; always run prettier on JSON too.
- Asked a lane to stop research for compares, then withdrew it — keep the
  owner's rules in front of you before sending instructions.
- Gave padded estimates; report measured numbers instead.
