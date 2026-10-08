# 05 — Memory and Context: what the model sees (investigator B)

HEAD `520bd123`. Read-only. Companion to `03-Q-BRAIN.md`. Excerpts are in `evidence/brain/`.

**Not inspected** (claims about these are marked): the memory learner implementation (`apps/q-api/src/composition/memory-learner.ts`), the `MEMORY_EXTRACTOR` and `PREFERENCE_POLARITY` callers, any `note_preference` tool, `packages/q-knowledge` retrieval SQL, embedding row counts (no DB access was used), the duplex voice broker, and `references.ts` / `hand-over.ts` internals.

---

## 1. Three different history windows for one turn

| Consumer                                  | Window                                                                                                                                                                                                                                     | Code                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Repository read (every path)              | newest **64** messages of the run's **conversation**. Excludes messages carrying any mark (`NOT_ADDRESSED_TO_Q`, hidden by owner) and runs whose spoken utterance was superseded by a later USER line with the same `provider_message_ref` | `postgres-q-runtime-repositories.ts:621-648`, `261-276`; `domain/utterances.ts:23-49` |
| Turn reader                               | last **6** turns (5 + Q's `[Q context]` reference note), each cut to **400 chars**; utterance cut to 2,000                                                                                                                                 | `answer.ts:247-287`, `turn-reader.ts:249`, `269-272`                                  |
| Pending-decision reader                   | last 6 turns                                                                                                                                                                                                                               | `answer.ts:2016-2022`                                                                 |
| Company Intelligence specialist           | last **12** turns, each ≤ **4,000 chars**                                                                                                                                                                                                  | `answer.ts:649-671`                                                                   |
| Conversational analyst (COMPANY_ANALYST)  | **all earlier messages** in the 64-window (≤63), each up to 32,000 chars (schema), rendered as one JSON array inside an UNTRUSTED fence **in the USER message**, not as chat turns                                                         | `index.ts:2495-2499`; `schemas/common.ts:59-66`; `renderer.ts:197-200`                |
| Tool context (research query composition) | latest user text plus the user's own last **3** earlier lines                                                                                                                                                                              | `index.ts:1641-1649`                                                                  |

Consequences:

- There is no token budget on the analyst's conversation. A long conversation of large Q answers (32,000-char limit per answer, `index.ts:317`) can reach roughly 63 × several KB in one prompt. I found no summarisation or compaction (UNVERIFIED RISK B-R3).
- The reader sees much less than the answerer. A reference to something 4+ turns back may be misclassified even though the analyst could resolve it.
- Marks are append-only (`conversation_message_marks`, `postgres-...:581-592`). Nothing is deleted, but marked lines disappear from every read-back.

---

## 2. Reconstructed assembled request for a new typed message (RECONSTRUCTED FROM CODE, not captured)

> Scenario: a founder on Home types "What needs my attention today?". The run has no subject; the plan grants OWN_Q_CONVERSATION, OWN_ONBOARDING, NETWORK_VISIBLE_DATA, PUBLIC_EXTERNAL_DATA, GENERAL_MODEL_KNOWLEDGE (`purpose.ts:162-176`). Names and values are placeholders.

Model call 1: TURN_READER v44 (FAST_CLASSIFICATION, reasoning LOW, 1,200 output tokens; `turn-reader.ts:282-313`)

```
SYSTEM: <Q_SYSTEM v2 charter, OPERATING MODE: ASSESSMENT, default communication guidance,
         ENVIRONMENT: "You classify one turn and nothing else; Capital Q decides what follows from it.">
USER:   <TURN_READER v44 template>
        ACTIONS: "Relationships: propose_express_interest (...); ...\nNot available here, ...: ..."
        MODALITY: TEXT
        RECENT TURNS: <<<UNTRUSTED_CONTENT source="recentTurns">>> [{"role":"Q","text":"<≤400 chars>"}, ...] <<<END_UNTRUSTED_CONTENT>>>
        WHAT THEY JUST SAID: <<<UNTRUSTED_CONTENT source="utterance">>> What needs my attention today? <<<END...>>>
→ JSON {kind:"QUESTION_TO_Q", question:{kind:"THEIR_OWN_RECORDS",...}, confidence, transcript:"CLEAR", heardAs:null, ...}
```

Model call 2+: COMPANY_ANALYST v21 (task class from capability ANSWER, which is NORMAL_DIALOGUE: 4,096 output tokens, $0.10/call, `index.ts:425-431`)

```
[0] SYSTEM  Q_SYSTEM v2 charter (evidence/brain/prompts-active-texts.md) with
            OPERATING MODE: DEBRIEF
            COMMUNICATION PROFILE: <profile guidance + optional etiquette guides, ≤4,000 chars>
            ENVIRONMENT (standing notes): LIKELY_INTENT_NOTE SAVE_NOT_VERIFY_NOTE OWN_DAY_NOTE EXPRESSIVE_NOTE
              "A userStatements knowledgeKey must start with one of: ..." DISPLAY_NAME_NOTE
              "No scoring or ranking service is available; do not produce scores."
              WHO IS ASKING: <founder name>, <title> of their own company <Company> (<website>). ... NAME_NOTE
              WHO YOU ARE WITH THIS PERSON: <chosen personality>      (index.ts:971-991; main.ts:3700-3713)
[1] USER    COMPANY_ANALYST v21 template, with THIS TURN filled:
            Capability requested: ANSWER. Subject: <assembled.subjectDescription>.
            NOTES (Capital Q, trusted): NEXT_STEP_NOTE "<N> authorised fact(s) were supplied up front; ..."
              "This conversation has no platform subject." "Tools available to you ...: <~up to 127 names>. ... Tools only read."
              GENERAL_KNOWLEDGE_NOTE RESEARCH_NOTE CAPABILITIES_NOTE [onboarding nudge]   (index.ts:992-1028)
            INSTITUTIONAL NOTES: <assembled.institutionalNotes or "Nothing was established in advance for this request.">
            MEMORY: <<<UNTRUSTED?>>> <memoryLearner.recall(...) text, ≤4,000 chars, or NOTHING_REMEMBERED>   (index.ts:1561-1585)
            AUTHORISED FACTS: <<<UNTRUSTED_CONTENT source="authorisedFacts">>> [
               {scope:"OWN_ONBOARDING", statement:"<name, role, setup progress>", truthClass, evidenceStatus, ref:"F1"},
               {..."own day": now in their zone, calls & reminders next 7 days, pending approvals, Q work, rehearsals ...},   (index.ts:1961-2003)
               {..."own standing": relationships by state, saves/passes ...},                                                (index.ts:2044-2076)
               {..."own index" ...}, ...assembled.facts ]                                                                 (index.ts:2469-2485)
            CONVERSATION SO FAR: <<<UNTRUSTED_CONTENT source="conversation">>> [{"role":"Q","content":"<opening/briefing>"},
               {"role":"USER","content":"..."}, ... ≤63 entries ] <<<END...>>>
            THE PERSON'S MESSAGE: <<<UNTRUSTED_CONTENT source="userMessage">>> What needs my attention today? <<<END...>>>
[2] SYSTEM  capabilityNote(request.capabilities, offered tools, receipts, screen)        (index.ts:3131-3140)
[3] SYSTEM  TOOLS_FIRST_NOTE ("TAKE THEM THERE ... LOOK IT UP FIRST ... THEN ANSWER IN THE SAME TURN ...")   (index.ts:498-502, 3144-3147)
[4] SYSTEM  OWN_MANDATE_NOTE (because own onboarding facts exist)                        (index.ts:3170-3172)
tools:  offered.map(t => t.definition)  (registry.eligible: core first, then focus/purpose; ≤127)   (registry.ts:245-304)
output: STRUCTURED CompanyAnalystResult JSON schema (OpenAI) or tools only (Gemini/Groq)          (index.ts:3233-3248)
```

Then come the tool rounds (≤2 chained + recovery/sayDo/gaps/load, ≤10 calls) and a final structured call if needed (`index.ts:3178-3683`).
Which fence the `memory` variable sits in depends on the template's `untrusted` list. I did not check whether `memory` is declared untrusted (schema `company-analyst.ts:54-56` lists userMessage, conversation, authorisedFacts …; the remainder was not read).

**Relevance to today's live failure ("nothing is waiting" while an investor message was unanswered since 7 Oct).** The facts the code prefetches for "what needs me" are `list_schedule`, `list_pending_approvals`, `list_q_work` and rehearsals in the _own day_ fact (`index.ts:1981-2002`), plus `list_my_relationships` standing (`index.ts:1697-1706`). An inbound chat message awaiting the founder's reply is not one of the prefetched day categories. It can only reach the answer through standing (the lead added `lastMessage` today) or through a model tool call. The live trace shows the model called `relationship.own.list` but still answered "nothing is waiting". Root cause **unverified** (B-R1). Whether `ownStandingFact` renders who-wrote-last as needing attention was not read.

---

## 3. Conversation state, long-term memory and the Write Gate

| Kind                                                                                                                                                                  | Where                                                                                                                                             | Durable?                                             | Status                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Messages                                                                                                                                                              | `q_runtime.conversation_messages` (+ blocks)                                                                                                      | yes                                                  | IMPLEMENTED                                                             |
| Marks (not-for-Q, hidden)                                                                                                                                             | `q_runtime.conversation_message_marks`, append-only                                                                                               | yes                                                  | IMPLEMENTED (`answer.ts:1825-1853`; route `q-conversations.ts:128-148`) |
| Pending declared app action awaiting a reply                                                                                                                          | `createPostgresAwaitingActions`                                                                                                                   | yes                                                  | IMPLEMENTED (`q-intelligence.ts:458-460`)                               |
| Approval cards                                                                                                                                                        | Approval Engine tables                                                                                                                            | yes                                                  | IMPLEMENTED                                                             |
| Conversation core state: failure counts and notices, unclear-in-a-row, last action ("try again"), question series, tool focus, early readings, actions key, `reheard` | JS `Map`/`Set` in the `createSpecialistQAnswer` closure, LRU 500                                                                                  | **no**: lost on restart, not shared across instances | PARTIAL (`answer.ts:749-822`, `1679-1717`)                              |
| Proposal boards between answer and `action_prepare`                                                                                                                   | in-memory per run, TTL                                                                                                                            | process-local (same invocation, acceptable)          | IMPLEMENTED (`profile-change-board.ts:186-234`)                         |
| Warmed prepare reads                                                                                                                                                  | `warming` Map ≤64                                                                                                                                 | process-local                                        | IMPLEMENTED (`index.ts:2192-2209`)                                      |
| Long-term memory recall                                                                                                                                               | `dependencies.memory = memoryLearner.recall` (`main.ts:3732`), text ≤4,000 chars into `MEMORY` (`index.ts:1561-1585`)                             | yes (implementation not read)                        | IMPLEMENTED per wiring; internals UNVERIFIED                            |
| Memory learning                                                                                                                                                       | orchestrator wrapped `withLearning(…, memoryLearner)` (`main.ts:3786-3799`); MEMORY_EXTRACTOR v2 and PREFERENCE_POLARITY v1 active                | not read                                             | UNVERIFIED                                                              |
| User statements (claims about own company)                                                                                                                            | `recordUserStatements` through `dependencies.statements` (knowledge gate), only when the quote is in their message and the turn `statesSomething` | yes                                                  | IMPLEMENTED (`index.ts:3744-3762`)                                      |
| Profile changes                                                                                                                                                       | proposal → approval, never written by the model                                                                                                   | yes                                                  | IMPLEMENTED (`index.ts:3771-3809`)                                      |

**Write Gate.** The model never persists facts directly. Statements pass a quote check plus the knowledge gate, and profile edits become approval cards. The charter says "nothing you say updates Capital Q's records until it passes the relevant review" (Q_SYSTEM v2 BOUNDARIES). The analyst template tells the model to treat memory "as told, not verified" (COMPANY_ANALYST v21). Whether memory writes pass the same deterministic gate is **not verified** (memory learner not read).

---

## 4. Knowledge retrieval (hybrid)

- Composition: `createAuthorisedRetrievalService({ lexical: createPostgresLexicalSearch(), semantic: createPostgresSemanticSearch(), embeddings? })` (`q-intelligence.ts:287-298`). The comment says lexical and semantic are "parallel components of one step, each already constrained in SQL by the plan's envelope". RRF fusion and SQL were not read.
- Embeddings: local TEI with `QWEN3_EMBEDDING_CONFIGURATION` (`q-intelligence.ts:256-271`). Semantic retrieval is reported only when embeddings are composed (`q-intelligence.ts:553`). **Embedding and chunk counts were not measured** (no DB access).
- Knowledge statements: `createKnowledgeQueryService` (`q-intelligence.ts:303-307`). Both feed `createQEvidenceRetrieval` → `evidence.port` (graph retrieval node) and `evidence.context` (the analyst's `context.assemble`) (`q-intelligence.ts:309-326`, `546-548`).
- **Observation:** the graph hands the answer seam `retrieval: { kind: "AUTHORISED_REFERENCES", referenceCount: 0 }` regardless of what was retrieved (`graph.ts:377-380`). The retrieval node's result is reduced to `outcome.kind` (`graph.ts:341-349`). The analyst re-assembles its own context in `prepareTurn` (`index.ts:1656-1668`). The graph's retrieval step may therefore be redundant work whose result is not consumed (UNVERIFIED RISK B-R4: depends on `evidence.port` caching, which was not read).

---

## 5. Continuity

- **Within a conversation (voice ↔ text):** voice turns are their own runs in the same conversation, and every reader reads by conversation, not by run (`index.ts:1599-1611`, `answer.ts:3077-3085`). A spoken line carries `utteranceRef`, which makes the turn `spoken` (`answer.ts:2178`), the reader modality `VOICE` (`answer.ts:265`), `SPOKEN_TURN_NOTE` (`index.ts:866-867`, `997-999`), and supersession for re-recognised utterances (`utterances.ts:23-49`). heardAs inserts a second USER line `utteranceRef:heard`, so the **garbled original stays in history** too (`answer.ts:2355-2367`). Duplex (realtime) continuity was not inspected. Live evidence shows the duplex opener did not come from this path.
- **New conversation:** `opening` (the welcome or briefing text shown) is kept as Q's first line, so "what are these companies?" resolves (`packages/contracts/src/q/request.ts:168-177`). It is ignored on a continuing conversation.
- **Across conversations:** only through long-term memory recall and canonical records (standing, day, onboarding, mandate) prefetched every turn. No earlier-conversation transcript is read. In-memory conversation-core state is keyed by conversation id and does not carry over.

---

## 6. Reference resolution

| Utterance                               | Code path                                                                                                                                                                                                                                                                                                                                                                                                               | Deterministic?                                                | Tests seen (not run)                                               | Status                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| "the second one" (cards on screen)      | `pageAnswer`: `ordinalOf(text)` → `cardsOnScreen(history)` → `cardAt` → OPEN_RECORD_PAGE COMPANY + spoken facts (`answer.ts:1615-1645`); otherwise reader `reference.open` with `shown` number → `openReferenced` → `openTarget(reference, shown, side)` → `open_page` authorize (`answer.ts:2470-2483`, `1861-1911`)                                                                                                   | yes for companies on a card block; reader-dependent otherwise | `page-request.test.ts`, `answer-references.test.ts`                | IMPLEMENTED (company cards only for the ordinal shortcut, `answer.ts:1619`) |
| "do the first thing instead"            | No dedicated handler. "Try again" and "same for X" use `reference.retryLast` + `lastActed` (`answer.ts:2484-2498`, `1919-1958`). "The first thing" among Q's offered options relies on the reader's "yes to Q's offer" rule (template line 13) and on the analyst reading the conversation                                                                                                                              | model-dependent                                               | none specific found                                                | PARTIAL                                                                     |
| "compare those two"                     | `namedCompanies`: names in the latest line **plus Q's last reply**, matched against the person's own known companies from standing, prefetched via `get_company` (`index.ts:1818-1854`). Non-owned or unknown companies depend on the analyst plus `search_companies`                                                                                                                                                   | partial                                                       | not identified                                                     | PARTIAL                                                                     |
| "book a meeting with him"               | Reader `handOver {kind: MEETING, counterpartName: null}` (pointing) → `actOnHandOver(port, request, handOver, timeWindow)` uses the subject on screen (`answer.ts:2862-2899`). If the analyst asks "who?", there is a re-round with `screenSubjectNote` (`index.ts:533-549`, `3328-3362`). With no screen subject and a pronoun for someone named earlier, it relies on the reader (6 turns × 400 chars) or the analyst | partial                                                       | `answer-turn-reading.test.ts` (has a known failing case per RULES) | PARTIAL                                                                     |
| "remember what I told you"              | `MEMORY` variable from `memoryLearner.recall` (≤4,000 chars) plus the 63-message conversation. The template says to honour preferences and corrections and "never claim to remember what is not here"                                                                                                                                                                                                                   | depends on memory learner (not read)                          | not identified                                                     | UNVERIFIED                                                                  |
| "that one" / "it" after Q named records | `referenceNote(shownItems(history), lastAction)` appended as a `[Q context]` turn for the reader (`answer.ts:2180-2181`, `2280`)                                                                                                                                                                                                                                                                                        | reader-dependent                                              | `answer-references.test.ts`                                        | IMPLEMENTED                                                                 |

`lastActed`, which "try again" depends on, is **in-memory** (`answer.ts:758-785`). After a deploy or on another instance, "try again" has nothing to repeat (B-02).
