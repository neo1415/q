# The Q room: brief, 6 October 2026 (night)

Founder vision: the Q page is "the god room". Everything in Capital Q, for investors and founders, can be seen, done, opened, read and approved by talking to Q, fast, without visiting other pages. "Jarvis meets LinkedIn meets TikTok."

| Id | Ask |
|---|---|
| R0 | Diagnose from logs and fix: the 12 voice-line `NO_BINDING_FOR_TOKEN` errors; voice dropping; cards during voice still iffy; a card offered to open a company profile and it didn't open; "open the certificate of incorporation" failed, Q first claimed it was on screen when it wasn't, and could not read it. |
| R1 | Q sees the whole screen: everything on the current page (not only what is scrolled into view) and any open modal, every turn. |
| R2 | Q can do everything any page can do, for investors and founders: one action layer over every capability; deep links straight to the thing ("open the chat with Tobenna", "open Ledgerline's data room", "open the pitch deck", "open the certificate of incorporation"). |
| R3 | Documents in the Q room: mention a document and it opens on the Q page; Q reads it aloud, summarises it, pages through it ("next page"), edits it on request, downloads it; close and move on. |
| R4 | Cards everywhere: anything from any page can appear as a card while Q talks, open as a modal, be approved, then go away; smoother card choreography. |
| R5 | Q as a colleague on work: "we already have this", "should I go ahead", the plan, what will need you; calendar not connected: say so, still suggest dates, and offer a connect card right in the Q room. |
| R6 | Web and news as cards; long results offer a PDF (yes or no); downloads work from the Q room. |
| R7 | Never an awkward silence: while Q works, it hums, says what it is doing, or brings back something remembered from earlier small talk; particles move around the page while it creates; a low working sound. Wide, long-lived memory. |
| R8 | Document and pitch-deck creation: research how Claude, Gemini and ChatGPT create documents (design, fonts, downloads); a multi-agent pipeline (writer, designer, auditor, asset finder) iterating until right; image generation (Gemini image models through the Model Gateway if the current key allows); placeholders plus a floating upload button in the Q room; endless edit rounds by voice. During onboarding, Q offers to create the pitch deck. |
| R9 | Speed: everything above is fast and works on weak networks. |
| R10 | Research first (technical and executive, enterprise-grade on a small budget), then design pictures and video, then build. |

## Founder clarifications (6 October, night)

- **Cards close when the conversation moves on.** A card stays only while we are on its subject; on a topic change Q closes it straight away, and opens it again if the subject comes back. The person can also say "close it". A document being read stays while we are on that document. (This replaces the research doc's "stays on screen until closed" proposal for ADR 0044.)
- **Documents are found by meaning, not exact name.** "This company's incorporation document" resolves by company, document type, folder, title and text; Q suggests the likely match ("Is this the one?") when unsure, then opens it.
- **Stock photos come from Pexels** (`PEXELS_API` is already set on q-api and workers), not Unsplash.
- **Gemini billing:** the founder may add about $5. Check periodically whether image generation works; keep live tests to the minimum and log each call's cost.
