# Q pronoun over-asking (QIQ-PRO-001): receipt, 2026-11-06

Branch: `fix/q-pronoun-clarify`. It was cut from `origin/fix/resume-asking-cv9ru3` @ `e5d6c5d`, which includes the reader head-start revert `2e1107b`.

The work was local only:

- no hosted DB, migration or deploy;
- no live model calls (every provider key was `disabled-locally-000000000000`).

The integration owner merges, runs CI, deploys and re-runs the live case.

## The defect

Seen live on two runs:

- **QIQ-PRO-001** (4c04b5f3e, live reader on). "Who are Silo Credit's CEO and CFO?" got the right answer. Then "When did she join?", "What did his career look like before?" and "How much are they raising?" each got "I'm not sure who or what you mean by …".
- **Production 1ef895999.** After Ledgerfold's founders were named, "What did the first one do before?" got the same question.

The bare model answers all of these.

## Root cause (verified)

- **(a) The ledger held none of the people.**
  - In Q-IQ the people come from authorised facts, which are free-text statements with no record ids.
  - In production they come from `company.get`. It names its company in `canonicalName`, which the ledger's name keys did not include. Its `team` members carry no person id, and the ledger only folded records with an id key.
  - So the ledger had no entry for Q's previous answer: no people, and often not the company either.
- **(b) The reader had one honest output.** Its v77 rule said to write a phrase with no refs when nothing fits, and to use only LEDGER refs, never names. So it wrote "she" with `entityIds: []`.
- **(c) Code asked by default.** `bindReferences` turned a phrase with no readings into `CLARIFY / NO_READING`, and `answer.ts` sent that question instead of answering.

## Commit 1 — `1176e8c`: never ask for "no reading"

- **No ledger match:** a phrase no ledger entry fits binds nothing. It goes to the answer with a note: read who or what is meant from the recent turns, and ask only if they leave it open. This is the behaviour before step 3.
- **Two readings:** Q asks one short question only for two plausible ledger readings (`TWO_READINGS`). One HIGH reading among guesses still binds.
- **Context Firewall:** a reading that carries a ref outside the ledger is refused whole, and nothing of it binds.
- **Page binding:** a binding code already made to the page (a list or a control) still stands.
- **Q-IQ world:** `createQIqWorldSubject` takes a `scriptedReader` for FAKE mode, so reference binding runs offline.

## Commit 2 — the ledger and reader v79

- **Ledger (`withFetchedRecords`, per turn, never stored):**
  - `canonicalName` is now a name key.
  - A team member in a record Q read becomes a PERSON entry: name; `of` the company's entry; the role (`businessTitle`/`role`) as `value`; id null, so no id is made up.
  - The rule is structural over the tool's output, never over anyone's words.
- **TURN_READER v79:**
  - v78 is kept whole, with one REFERENCES BY NAME rule after WHAT WAS ASKED.
  - A reference may carry `named: {name, kind}`: the name of a person, company, investor or document as written in RECENT TURNS, when no LEDGER entry is that one.
  - One clear reading is one HIGH entry. Two entries are only for two genuinely plausible readings.
  - `prompts.lock` gains only `turn-reader/v79`. v78 is DEPRECATED, and the active pins moved 78 → 79.
- **Code (`withNamedReferences`):**
  - It keeps a name only when that name is in the conversation's stored words (Q's or theirs).
  - A name the ledger already holds takes that entry, and its record id if one exists.
  - A new name is added to this turn's ledger as a name with no record behind it.
  - A name never said is dropped (no invention).
  - Refs the reader gave always win over a name.
- No gendered-word tables and no regexes over people's words: binding is the model's reading, checked by code against the ledger.

## Tests (failing first)

**Commit 1** (12 of them failed on the base source):

- `answer-conversation-state.test.ts`:
  - PRO-001's three turns with the live reader's shape (no refs), each answered and never asked;
  - "the first one" over the founders in Q's text;
  - a named company the reader wrote as an unbound reference is never asked about;
  - the firewall negative (E9: nothing bound, no E9 in the note);
  - Silo Credit vs Silo Health two-reading clarify still asks. This one passes before and after.
- `reference-binding.test.ts`: open phrases, mixed bound and open, two readings still asked, bounded and quoted note.
- `q-iq-references.integration.test.ts` (new): PRONOUNS_PEOPLE, AMBIGUITY and FOLLOW_UPS through the real runtime with a scripted reader that behaves like the live one.
  - On the base: 208 clarify replies, with QIQ-PRO-001 turns #1–#3 failing.
  - After: 180/180.

**Commit 2:**

- `conversation-ledger.test.ts`:
  - the `company.get` shape (company, plus two people with roles and no ids);
  - the per-turn view only;
  - `withNamedReferences` keeps a said name, drops one never said, reuses an existing entry and its id, and lets refs win.
- `answer-conversation-state.test.ts`:
  - the v79 reading binds Ngozi Eze, Tunde Bakare and Silo Credit with "no record behind it";
  - a never-said name is not bound;
  - two named readings still ask, naming both.
- `turn-reader-v79.test.ts`: v78 kept whole, the rule's content, and leniency (a malformed `named` costs only itself).
- The Q-IQ reference integration runs in two modes: LIVE_V78 and V79.

## Gates (exact results)

| Gate                                                                                            | Commit 1 (`1176e8c`)                                          | Commit 2                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm exec turbo run build --filter=./packages/*`                                               | 54/54                                                         | 54/54                                                                                        |
| root `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | exit 0                                                        | exit 0                                                                                       |
| `apps/q-api` tsc                                                                                | exit 0                                                        | exit 0                                                                                       |
| eslint (`NODE_OPTIONS=--max-old-space-size=6144`)                                               | q-specialists 0, q-evals 0                                    | q-specialists, q-evals, q-core, model-gateway, q-api: 0 each                                 |
| vitest                                                                                          | q-specialists + model-gateway + q-api: 6277 passed, 3 skipped | + q-core, q-evals, q-runtime: 7290 passed, 4 skipped; then the one v78 schema pin fixed, 7/7 |
| Scripted Q-IQ `CQ_Q_IQ_ALL=1`, local PG                                                         | 573/573, 0 fails; ADVERSARIAL passed                          | 573/573, 0 fails; ADVERSARIAL passed (reference and obeying, 0 fails)                        |
| Q-IQ references integration, local PG                                                           | LIVE_V78 180/180                                              | LIVE_V78 180/180, V79 180/180                                                                |
| prettier on changed files                                                                       | clean                                                         | clean                                                                                        |

## For the live re-run

- **Live QIQ-PRO-001 and the Ledgerfold "the first one" turn:**
  - with commit 1 alone, the answer resolves from the raw turns;
  - with v79, the reader should bind by name.
- **Watch:** if the live reader marks a named company as a reference and two names fit, Q now asks one question naming both. That is intended for a confusable pair only.
