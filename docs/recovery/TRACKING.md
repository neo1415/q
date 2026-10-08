# Recovery tracking (RECOVERY-2026-10)

Status values (implementation, integration and live verification are tracked separately; Live = verified in production or private staging with real providers or a real microphone):

- **Impl:** TODO / SPEC / WIP / DONE
- **Integ:** NO / MERGED
- **Local test:** NONE / UNIT / LOCAL-E2E (real UI, server state checked)
- **Live:** NO / STAGING / PROD

Grades follow SPEC §5. Updated by the lead at each merge.

| #   | Capability                                                                      | WS         | Paths                                    | Impl | Integ  | Local test | Live | Blockers | Evidence    |
| --- | ------------------------------------------------------------------------------- | ---------- | ---------------------------------------- | ---- | ------ | ---------- | ---- | -------- | ----------- |
| 0   | Lead contracts (turn, ui-act, attention, agent-capability) + UI act seam        | Lead       | contracts/q/_.ts, web ui-act-controller  | DONE | MERGED | typecheck  | NO   | —        | this commit |
| A1  | `silent` tool-result contract (C-01)                                            | A          | contracts voice.ts, broker               | TODO | NO     | NONE       | NO   |          |             |
| A2  | Facts through timing wrapper (C-02)                                             | A          | turn-timing.ts                           | TODO | NO     | NONE       | NO   |          |             |
| A3  | Routing: no model-only business answers (C-03, B-01)                            | A          | routing.ts, duplex-line.ts               | TODO | NO     | NONE       | NO   |          |             |
| A4  | Terminal disposition per voice turn + watchdog (C-06, E-04)                     | A          | duplex-line, deepgram-session            | TODO | NO     | NONE       | NO   |          |             |
| A5  | Reconnect/transport-change result recovery (C-04)                               | A          | duplex-line                              | TODO | NO     | NONE       | NO   |          |             |
| A6  | Stale reply guard (C-05)                                                        | A          | duplex-line                              | TODO | NO     | NONE       | NO   |          |             |
| A7  | Barge-in during generation (C-07) and short words (C-11)                        | A          | duplex-line                              | TODO | NO     | NONE       | NO   |          |             |
| A8  | Relay transport: sideband or deadline-bounded relay (C-08)                      | A          | broker, duplex-_                         | TODO | NO     | NONE       | NO   |          |             |
| A9  | Duplex levels, idle notice (C-09, C-10)                                         | A          | duplex-session                           | TODO | NO     | NONE       | NO   |          |             |
| A10 | Natural delivery (C-17, speakable)                                              | A          | instructions.ts, speech.ts               | TODO | NO     | NONE       | NO   |          |             |
| A11 | Duplex state survives deploy (C-16/A-05)                                        | A          | broker                                   | TODO | NO     | NONE       | NO   |          |             |
| B1  | Attention report (all sources, unread ≠ empty) + tool                           | B          | q-tools attention, model-gateway own-day | TODO | NO     | NONE       | NO   |          |             |
| B2  | Untrusted research out of SYSTEM (F-03)                                         | B          | model-gateway/src/q/index.ts             | TODO | NO     | NONE       | NO   |          |             |
| B3  | Conversation-core state persisted (B-02)                                        | B          | answer.ts                                | TODO | NO     | NONE       | NO   |          |             |
| B4  | Budgets per task class for analysis (B-04)                                      | B          | model-gateway q/index.ts                 | TODO | NO     | NONE       | NO   |          |             |
| B5  | Cheap path for small talk / greetings (B-05)                                    | B          | answer.ts                                | TODO | NO     | NONE       | NO   |          |             |
| B6  | Reference resolution across pages/modalities                                    | B          | answer.ts, turn reader                   | TODO | NO     | NONE       | NO   |          |             |
| B7  | Discussing vs executing; plan ≠ done                                            | B          | prompts                                  | TODO | NO     | NONE       | NO   |          |             |
| C1  | Control registry + page registrations                                           | C          | web control/**                           | TODO | NO     | NONE       | NO   |          |             |
| C2  | operate_screen tool + receipts to server                                        | C          | q-tools client-actions, wire             | TODO | NO     | NONE       | NO   |          |             |
| C3  | Navigation to every route/tab/record                                            | C          | follow-navigation, destinations          | TODO | NO     | NONE       | NO   |          |             |
| C4  | Document control (find/open/read/search/download/rename/archive/delete-confirm) | C          | app-actions document-manage              | TODO | NO     | NONE       | NO   |          |             |
| C5  | Forms through app actions with persistence confirmation                         | C          | app-actions                              | TODO | NO     | NONE       | NO   |          |             |
| C6  | Capability parity matrix (generated)                                            | C          | docs/recovery/capability-parity.md       | TODO | NO     | NONE       | NO   |          |             |
| D1  | Executor registry; planner limited to registered roles (D-02)                   | D          | workforce                                | TODO | NO     | NONE       | NO   |          |             |
| D2  | Lapsed approval escalation (D-01)                                               | D          | instructions, q-actions                  | TODO | NO     | NONE       | NO   |          |             |
| D3  | Durable jobs with leases (D-08)                                                 | D          | workforce jobs                           | TODO | NO     | NONE       | NO   |          |             |
| D4  | Honest states (D-03, D-04, D-05, D-06, D-09, D-11)                              | D          | engine, review, errands                  | TODO | NO     | NONE       | NO   |          |             |
| D5  | Q-sent marking (D-07)                                                           | D          | app-actions chat (request to C)          | TODO | NO     | NONE       | NO   |          |             |
| D6  | Work page shows persisted state (D-13, D-15)                                    | D          | web work                                 | TODO | NO     | NONE       | NO   |          |             |
| E1  | Cards persist beside Q while speaking (E-01)                                    | E          | q-conversation, briefing                 | TODO | NO     | NONE       | NO   |          |             |
| E2  | Investor arrival: new matches + Q view (E-02)                                   | E          | briefing                                 | TODO | NO     | NONE       | NO   |          |             |
| E3  | Partial block validation (E-07)                                                 | E          | result-blocks.ts                         | TODO | NO     | NONE       | NO   |          |             |
| E4  | CHART / MAP / TABLE / TIMELINE / investor cards                                 | E          | result-block contracts + web             | TODO | NO     | NONE       | NO   |          |             |
| E5  | Promises Q.01–Q.08                                                              | E (+B,C,D) | various                                  | TODO | NO     | NONE       | NO   |          |             |
| F1  | q.action events registered (A-01)                                               | F          | workers event-registry                   | TODO | NO     | NONE       | NO   |          |             |
| F2  | CI on integration branch + deploy gating                                        | F          | .github/workflows                        | TODO | NO     | NONE       | NO   |          |             |
| F3  | RLS runtime role: verify + plan (A-02)                                          | F          | report + ADR                             | TODO | NO     | NONE       | NO   |          |             |
| F4  | Readiness probes (A-04)                                                         | F          | app.ts                                   | TODO | NO     | NONE       | NO   |          |             |
| F5  | Aggregate spend caps (F-08)                                                     | F          | gateway                                  | TODO | NO     | NONE       | NO   |          |             |
| F6  | Retention (A-09, F-10)                                                          | F          | workers                                  | TODO | NO     | NONE       | NO   |          |             |
| F7  | Stale tests fixed (F-04, pgTAP 010/240/450/591)                                 | F          | tests                                    | TODO | NO     | NONE       | NO   |          |             |
| F8  | Error monitoring / telemetry export hook (F-07)                                 | F          | observability                            | TODO | NO     | NONE       | NO   |          |             |
| G1  | Local full stack harness (providers faked)                                      | G          | tests/, scripts/recovery                 | TODO | NO     | NONE       | NO   |          |             |
| G2  | Scenarios A–H browser tests                                                     | G          | apps/web/e2e                             | TODO | NO     | NONE       | NO   |          |             |
| G3  | Promise acceptance tests                                                        | G          |                                          | TODO | NO     | NONE       | NO   |          |             |
