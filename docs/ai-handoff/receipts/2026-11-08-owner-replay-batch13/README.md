# Replay of the owner's 8 Nov session on batch 13 (06be34c81), fictional investor savanna-seed, labs, 1440

Run 11:46–11:50 UTC. All four services are on 06be34c81: web deployed at 11:46 after the GitHub releases outage (504/503 on Railway's builder download, 10:22–11:46) and seven retries.

| #   | Said                               | Pane                                                              | Verdict                                                                                       |
| --- | ---------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2   | whats happening with my capital?   | /relationships?view=capital (1.1 s)                               | **FIXED**: was OFFER (2/3 split) on the owner's run                                           |
| 3   | who has viewed me so far?          | /analytics (5.6 s), "I've opened Analytics." first                | **FIXED**: was OFFER                                                                          |
| 5   | tell me about clinicrest (on Work) | Clinicrest company page (4.6 s)                                   | OK. The answer still ends with a stale "Want me to open Clinicrest's profile…" (W4, batch 14) |
| 6   | take me to their chat              | /relationships/company/Clinicrest/messages (0.3 s)                | **FIXED**: the investor side comes from the organisation (the owner got UNRESOLVED)           |
| 7   | what do i have in my pipeline?     | /relationships?view=pipeline (4.1 s)                              | OK                                                                                            |
| 9   | find paystack for me online now    | stays; web research RAN (Brave + Tavily, 17–19 hits, 3–4 sources) | **search FIXED**; the answer misframed it as discovery (W3, batch 14)                         |
| 10  | what can you find online about me? | stays; early web search with own identity, an honest answer       | OK                                                                                            |

Layout: at a ~820 px pane the Discover card keeps two columns with a 210×375 video (was ~60 px). Below ~700 px it switches to the phone layout (receipts/batch13-pane-width).
