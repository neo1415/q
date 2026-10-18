# Intelligent onboarding — lane ob1 (2026-10-16)

This note covers the onboarding coverage model and conversational behaviour for founders and investors. Lane ob2 owns registration, role and workspace choice, and form parity. Lane ml owns Arabic.

Branch: `claude/ob1-oct16`. The lead integrates.

## As found

- **Definitions.** Founder v5 (`FOUNDER_DEFINITION_CURRENT`, a superset of v1–v4) and Investor v1 are published manifests. Each has steps, branching and write targets.
- **Writes per step.** Every step answer writes into the canonical services (company, capital, team, mandate) inside the onboarding transaction. A refused write rolls the step back.
- **The interview (ADR 0016) is a tool-calling Q run** in `apps/q-api/src/voice/interview-agent.ts`. The voice path runs the same loop.
  - Its tools are `record_answers` (batched, any steps, verbatim-quote checked), `correct_answer`, `recommend` / `accept_recommendation` (grouped approval, up to 6), `set_aside`, `confirm_as_stated` and `confirm_and_finish`.
  - Multi-fact extraction and corrections already existed.
- **Turns.** `onboarding.interview_turns` is append-only and server-only. It was a display record only, and no later question could reach it.
- **Documents.** Uploads mid-conversation go through the evidence path. Founder document review then made suggestions from **any** company document, and the conversation filed every upload as a deck or company profile.
- **Research.** Founder and investor public research is offered as Q recommendations with their sources. A rejected value could be offered again. A company was matched by name alone.
- **Preferences.** Stated communication preferences go through the memory Write Gate. They are visible and forgettable at `/settings/memory`.
- **Progress UI.** One strip showing a "n of m covered" step count.

## Gaps closed

| Gap                                         | Change                                                                                                                                                                                                                                                                 | Commit             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| No canonical coverage                       | `OnboardingCoverageSchema` (8 field states, priority, provenance, held-save flag, evidence wanted, dependsOn). `deriveOnboardingCoverage` / `selectNextFields` in `@capital-q/onboarding`. Founder and investor coverage profiles annotate the definitions' own steps. | c0fb73df           |
| Q did not see coverage                      | Q's onboarding state carries per-step coverage, priority, `savePending`, `offered` (with source) and `next`                                                                                                                                                            | 807e13a1           |
| UI and form could not read coverage         | `GET /v1/onboarding/sessions/:id/coverage` (own session only), plus a quiet coverage view in the conversation screen                                                                                                                                                   | 807e13a1           |
| Transient save failure lost answers         | `onboarding.pending_writes` (migration 20261227232000, pgTAP 963). `HELD_FOR_RETRY` is never claimed as saved and is replayed next turn. Replays are duplicate-safe: no resubmit when the original landed, and a row+version idempotency key.                          | 807e13a1           |
| Sensitive documents were read               | Review reads only PITCH_DECK, COMPANY_PROFILE, PRODUCT, FUND_DECK and INVESTMENT_THESIS, and never anything highly confidential. Other uploads are acknowledged by metadata only. The conversation files uploads by name and asks when the name says nothing.          | 807e13a1, 05ccf487 |
| Rejected proposals came back                | `SUGGESTION_REJECTED_BEFORE` on Q recommendations and on internal suggestions                                                                                                                                                                                          | 807e13a1           |
| Research matched namesakes                  | A page counts only when it is on their website, is a link they gave, or names their founder's full name or their country. Otherwise Q asks for the website.                                                                                                            | 58ded6b1           |
| Conversation answers credited to "the form" | `onboarding.responses.channel` (FORM / CONVERSATION; migration 20261227232500, pgTAP 962). Q writes send CONVERSATION.                                                                                                                                                 | 58ded6b1           |
| Transcript not retrievable                  | `recall_my_setup` (Home Q, own conversation scope). It keeps answers on the record, their words (statements, not facts) and what Q said apart.                                                                                                                         | 58ded6b1           |
| Investor upload had no coverage key         | `I.materials` (OPTIONAL). FUND_DECK and INVESTMENT_THESIS may propose I2/I3/I4/I6/I8 fields. LP_LETTER is metadata only.                                                                                                                                               | 58ded6b1, 05ccf487 |
| Language                                    | Confirmation copy goes through `onboardingCopyFor(locale)` with `ONBOARDING_COPY_CATALOGS`. Lane ml adds `ar`.                                                                                                                                                         | c0fb73df           |

## Still open

- **Communication preferences opt-in.** Stated preferences are explicit, visible and forgettable. The memory learner also infers them with no consent switch. Making learning opt-in changes behaviour for every existing user, so it needs a product decision. The coverage view links to `/settings/memory`.
- **Investor document review.** Investor uploads settle `I.materials`. No reader yet turns a fund deck into mandate suggestions (founder review only).
- **Form submits** should send `channel: "FORM"` (ob2). Older answers fall back to modality.
- **Live.** Nothing from this lane is deployed. Live checks need integration, then the two migrations applied after pgTAP.
