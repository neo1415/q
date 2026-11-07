# Owner replay on batch 8 (1a669b58c), fictional investor savanna-seed, workspace labs on, 1440

Every run carries screen.workspace, and the navigation decision runs: 3 NORMAL_DIALOGUE/OTHER calls per turn, 2–4.5 s each, all successful (ai_ops.model_usage, q_run_id null).

| #   | Said                                  | Pane                                                                                                 | Verdict                               |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 2   | harbourline cargo's pitch deck        | stayed /discover; "has no deck I can open"                                                           | MISS (should be Harbourline › deck)   |
| 3   | take me to harbourline cargos profile | /company/Harbourline (3.3 s), but the reply says "I can't open … from here right now"                | move OK; reply contradiction PERSISTS |
| 4   | i'm curious about their team          | stayed on Overview                                                                                   | MISS (team tab)                       |
| 5   | can i see it?                         | stayed                                                                                               | MISS (team tab)                       |
| 6   | tell me about clinicrest              | stayed on Harbourline                                                                                | MISS (Clinicrest)                     |
| 7   | can i see their elevator              | Harbourline ?tab=elevator (7.9 s)                                                                    | wrong record ("their" = Clinicrest)   |
| 8   | send those questions to them          | page action; approval card with the page's 3 questions, first person ("approve on the card")         | OK but slow (61 s)                    |
| 9   | who has viewed my profile?            | /analytics (10 s); "Fewer than three founder organisations viewed your profile in a completed week…" | OK                                    |
| 10  | what can you find about me online?    | stayed; "I don't have a public-web search result about you"                                          | stay OK; NO web research ran          |
| 11  | where is my firm located?             | stayed; "Savanna Seed Partners, is based in Lagos, Nigeria"                                          | OK                                    |

Key hypothesis: the live A/B and replay evals (8/8) ran on Anthropic Sonnet, but production routes NORMAL_DIALOGUE to OpenAI first (routes v2). The production model may decide differently, or the decision's MOVE is lost after it (guards: INEXACT_NAME with production open_page; settle).
