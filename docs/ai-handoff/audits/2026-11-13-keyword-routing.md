# Audit: keyword-driven interpretation in Q (13 Nov 2026, read-only)

Owner addendum: `../directives/2026-11-13-addendum-semantic-intelligence.md`. Line numbers are at `23bfe795f`.

`index.ts` means `packages/model-gateway/src/q/index.ts`; `answer.ts` means `packages/q-specialists/src/answer.ts`.

## To move to the turn reader (C = words are the primary interpreter; D = mixed)

Ranked by user impact.

1. **Pre-reader code lanes (D).** These lanes answer before the reader runs (`answer.ts:5053,5199-5205`), so nothing corrects a misread:
   - page requests: `pageRequestOf` / `PAGE_VERB` (`page-request.ts:307,543`);
   - tabs and screen acts;
   - fit rankings: `fitRankingLaneOf` (`fast-lane.ts:525`);
   - Daily ordinals: `dailyLaneOf` (`fast-lane.ts:470`);
   - mandate recall: `asksForOwnMandate` (`own-mandate-answer.ts:41-58`);
   - records opened by name: `namedRecordRequestOf`;
   - page-offer replies: `offerReplyOf`;
   - pleasantries: `pleasantryOf`.

   Keep only the exact short closed-set utterances (pleasantries; yes/stay of 60 characters or less) as documented latency shortcuts. Route fit rankings and open "show me X" through the reader.

2. **Words override the reader's navigation (C).** `wordsNamePage` vetoes NAVIGATE (`answer.ts:4047`); `asksToGoExplicitly` (4088); `onlyAMove` (1635); 7298; `questionAfterMove` splits on punctuation (9115). The reader needs a navigation mode (GO, SHOW, OFFER) and a negation flag; use `parts`.
3. **Fit ranking: words before the reader (C).** `fitSweepAsk` runs before `request.fitQuestion` (`index.ts:4639`). Scope, place and count come from regexes, place by capitalisation (`fit-sweep.ts:86-121,232,251`). Read the reading first; add `fitQuestion.scope` and `.place`.
4. **Comparison falls back to words even when the reader said no (D).** `compareAsked ?? asksToCompare(words)` (`compare-table.ts:303`, `index.ts:11944`); the early-lead `asksForComparison` (`early-lead.ts:82`); the name cap (`index.ts:5138`). Use `readAsComparison` and `compare.names`; pass `compareAsked: false` whenever a reading exists.
5. **Attached document: summary vs critique decided by words (C)** (`attached-document-intent.ts:16-40`). Add a document ask, or derive it from `answerKind` and `parts`.
6. **"Put those in a table" overrides the reading (C)** (`re-render.ts:34`, `answer.ts:6642`, `index.ts:6263,6280,6607`). Use `fromShown.reshow`, `asksForWeb` and `excludeShown`.
7. **Platform vs company, on-screen subject (D).** `namesOnlyCompany` and `isSingleCompanyQuestion` (`index.ts:7111,11775`); `capitalQAsCompanyAsked` with `PLATFORM_USE` (`named-company-fact.ts:749-771`). Use `namedOther`, `references` and `retrievalFocus`; add a PLATFORM kind.
8. **One-fact company answers from regex (C/D)** (`companyFactAskOf`, `named-company-fact.ts:60-100`; `index.ts:6163,8568`). Use `answerKind=LOOKUP` with `namedOther` and a fact aspect.
9. **Name candidates by capitalisation and stop words (D)** (`companyNameCandidates`, `lowercaseNameCandidates`). Use `namedOther`, `compare.names`, `references` and `retrievalFocus`; keep the candidates only for prewarming.
10. **Chart metric and companies from words (D)** (`figure-chart.ts:241-271` revenue-first; `index.ts:4365`). In progress: a typed reader `chart` intent.
11. **Maps entirely word-driven (C)** (`companies-map.ts:37-70`, `index.ts:8534`). Add `asksForMap` with a scope.
12. **Pipeline-summary early lead (C)** (`early-lead.ts:13,56-63`). Use `question.kind=THEIR_OWN_RECORDS`.
13. **Reference binding parallel to the reader (D)** (`conversation-entities.ts:113-189`). Use the reader's `reference`, `fromShown` and `references`; ordinal parsing itself is fine.
14. **Follow-up subject and freshness (D)** (`research-follow-up.ts:12`, `read-cache.ts:45`). Use `references`; add `wantsFresh`.
15. **Arrival and Daily follow-ups answered by code from words (D)** (`arrival-answer.ts:46-62`).
16. **Behaviour and prefetches keyed on words (D):**
    - `asksOnlyToReviewOwnPitch` changes behaviour;
    - `asksWhoCanSeeDataRoom`, `asksChequeFit` and `asksAboutOwnPitch` gate prefetches only;
    - `deferred-work.ts:39` reads "yes" where the reader has `acceptsOffer`.
17. **Privacy: other investors' interest (D)** (`others-interest.ts:11`; `index.ts:7075,8000`). Keep the word rule as defence in depth, and also trigger it from a reader field.

## Stays: structured-data validation (A) or bounded fallback (B), to be documented in code

- **`fastLaneOf`:** the skim decides; the regexes only narrow it (B).
- **Fallbacks used only when there is no reading (B):** `namesToCompare` and the word branch of `compareTargets`.
- **The `companyNameCandidates` prewarm:** latency only; the reads are authorised and memoised (B).
- **Hallucination checks on the reader's names:** `heardNames`, `namedInTheirWords` and the sentence-opening guard (A/B).
- **Parsing, mapping and model-output checks (A):**
  - `navigation-decision.ts` `NAME_STOP`/`byName`: resolves a model-proposed name and refuses when ambiguous;
  - `discover-filter-rule.ts` `QUALIFIERS`: maps reader fields onto tool arguments;
  - `asksForMessage` / `MESSAGE_TOOLS`: an enum check on reader output;
  - date, decimal, currency, UUID and country parsing;
  - `nameKey`, `itemsOf` and `profileOf`;
  - output guards: `OFFERS_TO_COMPARE`, `withoutMarkdownTables`, `withOthersInterestWithheld` and the deferred-work OFFER/PROMISE scrubbers;
  - `pending-decision.ts`, which works on the model's reading;
  - `WEB_ADDRESS` URL detection.
- **Closed-set confirmations (A/B):** `held-accept.ts` `isPlainYes`; `pleasantryOf` and `offerReplyOf` as anchored closed sets of 60 characters or less.
- **`mentionsOwnBoard`:** only adds a tool to the offer (B).

## Sequence

The reader prompt and schema have one owner at a time. Order:

1. chart intent (in progress);
2. item 4 (no reader change);
3. item 3;
4. item 2;
5. item 17 (privacy);
6. item 1;
7. the rest.

Each slice: paraphrase, follow-up and negative tests, and a small live eval of the reader.
