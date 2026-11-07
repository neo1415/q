# Owner live session findings, 7 November 2026 (16:07–16:34 UTC)

Source: the owner's own Q conversation on production `041e754f0` (workspace labs on). The evidence is in `q_runtime.conversation_messages` / `q_runtime.runs` (actor 56e3adff…) and `ai_ops.model_usage`, plus the owner's screenshots.

The owner's instruction: **do not patch. Find the root problem and fix that**, whether it is context, memory, intelligence or UI.

## Evidence: what was said, and what Q did

| Time     | Owner said                                                          | Screen                                                                                           | Q did                                                                                 | Problem                                                            |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 16:10    | "i want to see tensor gates pitchdeck"                              | —                                                                                                | "Tensorgate's seed pitch deck … was opened" (a document viewer)                       | should open Tensorgate's company page, **Pitch deck tab**          |
| 16:14    | "okay take me tensorgates profile"                                  | —                                                                                                | "Opening your profile…", i.e. **the owner's own** /profile                            | wrong subject: "profile" matched like a keyword to my profile      |
| 16:15    | "i want to rehaearse"                                               | —                                                                                                | "The Tensorgate rehearsal page is being opened **on the person's screen**."           | picked a company unasked; third-person internal narration          |
| 16:16    | "i want to talk to spheros"                                         | —                                                                                                | "Spheros relationship conversation was opened on screen."                             | narration voice                                                    |
| 16:17    | "i'm curious about tensorgates team" → "can i see it?"              | relationship                                                                                     | listed the names again                                                                | did not open Tensorgate › Team                                     |
| 16:22    | "can i see their elevator" (talking about Spheros)                  | COMPANY (Spheros)                                                                                | opened **Tensorgate's** elevator                                                      | wrong referent; ignored both the conversation focus and the screen |
| 16:22    | "we were talking about spheros, why tensorgate"                     | —                                                                                                | "The previous screen action opened … **The user** had been discussing Spheros…"       | third-person narration leak; no fix or apology                     |
| 16:21–23 | "ask spheros some questions" / "send those questions to kathryn"    | COMPANY, Spheros (page shows **Next step: Send 3 questions to Kathryn Outlaw [Send questions]**) | drafted its own 4 questions as a second action                                        | **no page awareness**: the page's own action was ignored           |
| 16:25    | "who has viewed my profile?"                                        | COMPANY                                                                                          | "You viewed Spheros once today…"                                                      | wrong direction; should be Analytics: who viewed **you**           |
| 16:25    | "whats happening in my work?" → "can you just … take me to work?"   | —                                                                                                | summary, then only moved on an explicit command                                       | no topic-driven move                                               |
| 16:32    | "what can you find about e online?" (typo of "me")                  | DISCOVER                                                                                         | listed companies starting with "E"                                                    | —                                                                  |
| 16:33    | "i meant me, what can you find about me online"                     | DISCOVER (Clearwater)                                                                            | "**You mean Clearwater Assurance.** …"                                                | "me" resolved to the **on-screen company**; no web research run    |
| 16:34    | "where is Zino aviation located in nigeria?" (the owner's OWN firm) | —                                                                                                | "I don't have a location … company search didn't return a matching Capital Q profile" | Q doesn't know the person's own organisation                       |

UI, from the screenshots:

- Discover result cards in the chat don't reflow to the Q pane's width; text breaks per letter ("nc / e / Seri A…").
- The empty input box is very tall.
- There are two scroll indicators.
- The Q pane and page pane don't respond well to width.

## Hard facts from the database

1. **The model-led navigation decision (D78) never ran.** Since the batch-5 deploy, `0 of 36` runs carry `screen.workspace`. That includes the owner's runs and the integration owner's fictional labs test after the Settings toggle. Without `screen.workspace`, `createQPageMoves` never starts, so every move the owner saw came from the **older explicit-command paths**: client actions and fast navigation.
   - That explains "it only goes there if I tell it explicitly".
   - It also explains the keyword-like target errors ("profile" → own profile; "rehearse" → some company).
   - Prime suspect: the q-api workspace gate (`apps/q-api/src/security/workspace-gate.ts`) reads `user_metadata.cq_workspace` from the **access token**. A Supabase JWT keeps the claims from when it was issued, so turning the preference on doesn't reach the token until it is refreshed. The web renders from a fresh read, so the person sees the workspace, but q-api drops the hint. **Verify; don't assume.** The web may also not be sending it.
2. Model calls look healthy: FAST_CLASSIFICATION had 2 timeouts of 43 for this person. So the failures above are mostly **context, resolution and routing**, not provider outages.

## Root-cause questions each lane must answer with evidence (no patches before the answer)

- **R1 (navigation never ran):** why `screen.workspace` is absent, end to end: web send → gate → persistence. The fix must make the model-led decision run for opted-in users. The explicit-command fast paths must not pre-empt it with keyword matching (DECISIONS 75: no keywords).
- **R2 (who and what is being talked about):** one source of truth for the conversation's focus entity. "their/it/that/me" must resolve through conversation focus, then the screen, then the person themself. "me" is the person, never the on-screen company. Today something resolves "their" to an older entity and "me" to the screen subject. Find the component (turn reader, fast navigation, client-action resolver) and why.
- **R3 (self-knowledge):** Q must know the person and their own organisation (name, firm, website, HQ, mandate) as first-class context, and answer "where is my firm", "who viewed me" and "find me online" from that. "Find me online" must run the web research tool with the person's name, firm and website.
- **R4 (page awareness):** Q must read the current page's manifest, including its primary actions (e.g. "Send 3 questions to Kathryn Outlaw"), and use the page's own action when the request matches it, instead of inventing a parallel one.
- **R5 (topic-driven placement):** when the conversation is about something that has a place (a company's pitch deck, team, elevator; who viewed me → Analytics), Q opens that exact place. This is the D78 decision once R1 is fixed. Measure it live.
- **R6 (voice):** Q must never narrate in the third person ("the user", "the person's screen", "the previous screen action"). Find which path emits these strings: client-action acknowledgements and receipt facts leaking into replies.
- **R7 (UI):** result cards use container queries keyed to the Q pane's width. Input height is content-sized. One scroll owner per pane.
