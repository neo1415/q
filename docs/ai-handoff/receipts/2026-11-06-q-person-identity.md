# Person identity on the public web (no namesakes): receipt, 2026-11-06

Branch `fix/q-person-identity`, cut from `origin/fix/resume-asking-cv9ru3` @ `b6d32ae`. All work was local:

- no hosted DB, no migration, no deploy;
- no live model or search calls: provider keys were `disabled-locally-000000000000` and every web result was scripted.

The integration owner merges, runs CI and deploys.

## The defect

Production `6c8d108cf`, as the fictional investor:

1. **"Who are Ledgerfold's founders?"** Q answered Adaeze Nwachukwu (CEO) and Obinna Eze (CTO). This was correct.
2. **"What did the first one do before?"** Q gave the fictional record correctly. It then added: "Public sources also describe an Adaeze Nwachukwu as having worked in economic intelligence at Access Bank, risk measurement at UBA Group…".
   - That profile never mentions Ledgerfold. Ledgerfold is fictional, so this is a real, unrelated private individual's career.
   - It was hedged, but it was still a stranger in an investor's answer.

## The rule (`packages/model-gateway/src/q/person-anchor.ts`)

Public-web facts may speak about a person Capital Q holds against a record only when the page **ties** them to it:

- the page names the person **and** the company, as whole words; or
- the page names the person on the company's own site, meaning the site's name is the company's name.

A bare name match is never enough. Matching is over public page text only, never over anyone's words.

**Where the company comes from.** `personAnchorOf` (in `q-specialists/src/conversation-ledger.ts`) reads the conversation ledger, which code built from the stored turns and tool results. It is computed only when the turn reader says the turn is about a PERSON:

1. the person's ledger entry `of`, which is the record they were read from;
2. otherwise, for a person Q introduced (from a record or in its own words), the one company in play in those turns;
3. a person only the asker named, such as a public figure asked about by name, gets no anchor and is searched as before. Two companies in play also give no anchor.

The result reaches the gateway as `QAnswerRequest.namedOtherAnchor`, a new optional field in `q-runtime`.

**Where it applies.** `aboutThemOnly` is the one filter every public search of the run already passes through: the early search, the model's own calls, Sources and the picture evidence. It now also applies `tiedToRecordPerson` to any search whose entity name or query names that person.

- Pages that do not tie the person are left out, along with Capital Q's comparison notes on them.
- With no tied page, the tool result carries a trusted line: say nothing from the public web about them, and "You may offer to look for public profiles of {person} that mention {company}."
- The log line `q public pages that do not tie the person to their company left out` carries the count only, never the name or the text.

**The claim check backs it up.** The namesake's pages never enter the run's corpus. A sentence that repeats a namesake fact from model memory, for example "Access Bank", names something no source holds, so it is removed.

**Web discovery** admits a founder by the same `pageTiesPerson` rule. The names and the whole-word check (`namedIn`, `normalForm`) now live in `person-anchor.ts`, and `web-discovery.ts` uses them from there.

## Tests

- **`model-gateway/test/person-anchor.test.ts`**, 6 tests:
  - a namesake page without the company is excluded;
  - a page naming both is included, and so is the person named on the company's own site;
  - the company alone, or a longer word containing it, does not count;
  - a search about someone else is unchanged;
  - with nothing tied, the trusted note is added;
  - discovery admits a founder only from a page naming both.
- **`q-specialists/test/person-anchor.test.ts`**, 3 tests: the ledger `of` tie, the one company in play, and no anchor for a person only the asker named or with two companies in play.
- **`model-gateway/test/q-answer-research.test.ts`**, 4 new tests through the real answer path with a scripted model:
  - the namesake page never reaches the model, and the tied page does;
  - the model's draft repeats the namesake career and **the claim check removes it** (no "Access Bank", no "UBA Group"), while the tied fact stays;
  - with only the namesake page, the model is told nothing ties them and may offer the anchored search;
  - a person with no record behind them is searched as before.

## Gates (exact results, at `f837c99` plus this receipt)

| Gate                                                                                                                        | Result                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec turbo run build --filter=./packages/*`                                                                           | 54/54 successful                                                                                                                                                                           |
| Root tsc `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`                         | exit 0                                                                                                                                                                                     |
| `apps/q-api` tsc                                                                                                            | exit 0                                                                                                                                                                                     |
| eslint on the touched files (`NODE_OPTIONS=--max-old-space-size=6144`) / `npx prettier --check apps packages docs supabase` | exit 0 / all files pass                                                                                                                                                                    |
| vitest `packages/model-gateway packages/q-evals packages/q-runtime` / `packages/q-specialists` / `apps/q-api`               | 217 files, 1889/1889 / 85 files, 1534/1534 / 335 files passed (1 skipped), 3123 passed (3 skipped)                                                                                         |
| Integration on local PG (q-api, model-gateway, q-evals, q-specialists, q-research, q-tools) with `CQ_Q_IQ_ALL=1`            | **30 files, 114/114**                                                                                                                                                                      |
| Q-IQ through the runtime                                                                                                    | **Core: 573 turns, no fails**, `actionClaimsKept: 0`, `promiseRewrites: 0`. **ADVERSARIAL:** score 1 with both the resisting and the obeying model. **DISCOVERY:** score 1. `liveGaps: []` |

## What a live re-run should show

Ask "Who are Ledgerfold's founders?", then "What did the first one do before?".

- **The reply:** the record's fictional background only. There is no Access Bank, UBA Group or Proshare, and Q may offer to look for profiles of Adaeze Nwachukwu that mention Ledgerfold.
- **The q-api log:** `q public pages that do not tie the person to their company left out`, with a non-zero `dropped`.

## Limits

- **The anchor is a company name** (or the company's own site). A LinkedIn URL held in the record and the company's declared domain are not used yet. They would be further anchors.
- **A person with no ledger tie and several companies in play** gets no anchor, so the old behaviour applies.
- **The person-search lane** (W2 identity cards, "Tell me about {person}") has its own identity checks. It is not changed here.
