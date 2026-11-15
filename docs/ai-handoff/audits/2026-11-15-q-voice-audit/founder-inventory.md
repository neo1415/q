# Deliverable A (founder): inventory of the owner's founder testing sessions, 1–15 Nov 2026

Directive: `docs/ai-handoff/directives/2026-11-15-q-voice-conversation-audit.md`, Phase 1. This audit is read-only: hosted SQL (`hosted-read.mjs`), Railway logs and the handoff notes. No model calls, browser or messages.

Data cut-off: 15 Nov 2026, 18:05 UTC. Per-turn records are in `founder-turns.jsonl` (deliverable B). Findings and latency are in `founder-findings.md` (deliverable C/D).

## 1. Which accounts are the owner's founder accounts

The owner's sign-in email was used only to find their user ids and linked accounts. No email address is written here.

| Account (profile id)                   | Persona / organisation                                    | Basis for ownership                                                                                     | In scope                                                                                              |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cb2b58ab-5a3d-4af0-9195-8e7614187bdb` | "Priya Khandelwal", founder of **Nixo** (company)         | The founder test account is named in `LEGACY-RECONCILIATION.md:64` and "Priya" in `HANDOFF-LOG.md:2210` | **Yes**                                                                                               |
| `801f52ed-8af3-4e72-ab21-2434f7ccb50e` | "Daniel Park", co-founder/CTO of **Tensorgate** (company) | Plus-address of the owner's own email (seeded persona set, 6 Oct)                                       | **Yes**                                                                                               |
| `56e3adff-bc0d-42aa-a161-e1fa522a901b` | Owner's own account, Zino Aviation (investment firm)      | The owner's sign-in account                                                                             | **Only** its founder-role GateQ application (F6). Investor sessions are covered by the investor audit |
| `44aedde4-f05c-4754-8287-21d587a6b3f8` | "Marcus Delgado", Tensorgate                              | Plus-address of the owner's email                                                                       | No owner turns. 3 standing-instruction runs (2, 4, 6 Nov), system-initiated, all `APPROVAL_EXPIRED`   |
| 86 other plus-address persona accounts | Seeded 6–8 Oct                                            | Plus-address of the owner's email                                                                       | No runs, voice segments, onboarding or GateQ rows since 1 Nov                                         |

**Excluded:**

- **Ownership unconfirmed:**
  - `43e3fe92…` ("zion omoju", accelerator): investor-journey voice onboarding on 9–10 Nov, 194 segments. Different email, not linked in the handoff notes.
  - `66df5105…` ("David", Personal Investing): an investor account with a different email.
  - 9 GateQ applications created since 1 Nov with no contact and 0 turns: `0450dfa6`, `e494c363`, `8114bb42`, `7e4b8368`, `5a2c70f9`, `2d27025f`, `7b812448`, `283a5502`, `7640a053`.
- **Real third party:** Kathryn Outlaw (Spheros) `f042c12e…`.
- **Fictional:** every `@fictional.capitalq.local` account. All 54 founder and investor onboarding sessions active since 1 Nov are fictional e2e/v1 accounts.

**Founder onboarding:** no founder onboarding session (typed or voice) exists on any owner account in the window.

## 2. Sessions

The deployed SHA comes from the handoff log or ledger (Railway keeps only the current deployment, `84ac9afa7`, deployed 14:36 UTC 15 Nov).

| Session | Account                                                     | Surface / channel                                   | Start–end (UTC)                             | Deployed SHA                                                           | Turns (owner / Q)                                                                                    | Runs | Tool calls | Model calls (run-linked)                                            | Actions (status)                                          | UI intents                    | Completion                                                                                                        | Evidence available                                                                                                                                                  |
| ------- | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- | ---------- | ------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1**  | Priya / Nixo                                                | Q home, typed + 3 button prompts + 4 card approvals | 9 Nov 07:53:42–09:41:47                     | `a9be2ffc6` (inferred: batch 17 was committed 09:17 and live by 11:35) | 14 typed + 4 approvals / 41 Q messages                                                               | 17   | 110        | 77                                                                  | 4 (all EXECUTED/APPROVED)                                 | 5 (nav, offers, show-section) | Complete. The plan job ran asynchronously to 08:35                                                                | messages, runs, run_events, tool results, actions/approvals, model_usage. **No logs** (deployment gone)                                                             |
| **F2**  | Priya / Nixo                                                | Q rehearsal (voice) with the Zino persona           | 9 Nov 08:41:56–08:45:43                     | `a9be2ffc6` (inferred)                                                 | 3 / 5 (2 sessions)                                                                                   | —    | —          | 8 (REHEARSAL purpose)                                               | —                                                         | —                             | `387a85e6` ended by the founder after the opening. `11ec48d8` adjourned ("emergency"), but status is still ACTIVE | `q_runtime.rehearsals.turns`. No timing or logs                                                                                                                     |
| **F3**  | Priya / Nixo                                                | GateQ application to Zino's gateway (text)          | 9 Nov 11:57:48–12:03:37                     | `c92789167`                                                            | 6 / 7                                                                                                | —    | —          | (GateQ latency_ms per turn)                                         | SUBMITTED 12:03:37                                        | —                             | Submitted while Q's revenue read-back was still unanswered                                                        | application_turns, facts, synthesis, session. Turn-readings table empty                                                                                             |
| **F4**  | Priya / Nixo                                                | Q home typed → GPT-Live voice                       | 9 Nov 12:57:00–12:58:57                     | `c92789167`                                                            | 1 typed + 10 voice segments (2 utterances) / 13 Q messages + 12 voice segments                       | 3    | 19         | 19 + 7 realtime                                                     | 0                                                         | 1 (Work)                      | **Interrupted**: Q's final Work answer was never spoken. The end reason is not retained                           | voice_line_turns, mirrored messages, runs, tools. No logs                                                                                                           |
| **F5**  | Daniel / Tensorgate                                         | Q home typed + 2 approvals                          | 12 Nov 15:00:12–15:11:03; approval 18:08:06 | `5ba018530` (live 14:35–16:05 UTC)                                     | 2 typed + 2 approvals / 12 Q messages                                                                | 5    | 14         | 11                                                                  | 3 (2 EXECUTED, 1 WITHDRAWN/REVOKED)                       | 0                             | Complete (plan executed). Resumed 3 h later for one approval                                                      | messages, runs, actions. No logs                                                                                                                                    |
| **F6**  | Owner (Zino account) applying as founder of "The Vaultlyne" | GateQ form + interview                              | 15 Nov 06:55:38–06:59:54                    | `30c99ccc5`                                                            | 0 / 1 (opening only)                                                                                 | —    | —          | —                                                                   | IN_PROGRESS                                               | —                             | **Abandoned** after the opening                                                                                   | facts, statements (FORM), turns                                                                                                                                     |
| **F7**  | Daniel / Tensorgate                                         | Q home **GPT-Live voice** (code-routed delegations) | 15 Nov 17:22:23–17:42:13                    | `84ac9afa7`                                                            | 32 voice segments (26 utterances) / 70 voice segments + 30 Q messages (27 mirrored user transcripts) | 25   | 207        | 157 + 80 realtime (+131 classifier/dialogue calls with no run link) | 2 (send EXECUTED by spoken "Yes"; plan AWAITING_APPROVAL) | 5 (3 unrequested nav, cards)  | **Interrupted**: the line ended at `max_length` (1,202 s), 13 s after the last answer                             | voice_line_turns, runs, run_events, tools, actions, model_usage. Logs from 17:31:44 (turns 10–25 of 25 delegations; the first 9 fell outside the 5,000-line window) |

## 3. Reconciliation (stored counts vs audited records)

| Store                                                                                                                    | Rows in scope       | Mapped to a turn record             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------- |
| `q_runtime.conversation_messages` (conversations `0659178b`, `26824faa`, `962f0c7a`, `c92788cc`, `edcdb687`, `2185e078`) | 150 (54 USER, 96 Q) | 150                                 |
| `q_runtime.voice_line_turns` (voice sessions `0aed6d84`, `da745fd5`)                                                     | 124 (42 USER, 82 Q) | 124                                 |
| `gateq.application_turns` (`7c9b7f4f`, `73fefa27`)                                                                       | 14 (6 PERSON, 8 Q)  | 14                                  |
| `q_runtime.rehearsals.turns` (`387a85e6`, `11ec48d8`)                                                                    | 8 (3 YOU, 5 THEM)   | 8                                   |
| **Total rows**                                                                                                           | **296**             | **296**: 0 missing, 0 double-mapped |
| `q_runtime.runs` by Priya and Daniel since 1 Nov                                                                         | 50                  | 50, each in exactly one record      |

The 70 records break down as:

- 51 owner turns;
- 2 voice-only owner turns (no Q run);
- 7 approvals (6 card taps, 1 spoken "Yes");
- 10 Q-initiated records (openings, a plan-step card).

How many records each session has:

- F1: 19
- F2: 5
- F3: 7
- F4: 5
- F5: 6
- F6: 1
- F7: 27

The mapping is checked by the builder (`missing 0, extra 0, runs missing []`). Voice segments are grouped into utterances: one record per utterance as Q received it. Every segment id is listed in `context_ref.segments`. On 9 Nov the B1 mirror stored copies of voice segments as conversation messages. Those copies are mapped to the same utterance record as the segments.
