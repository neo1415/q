# Q Pitch v6: owner direction (2026-10-16, night). Authoritative.

Q Pitch is Q presenting Capital Q itself, live in the app, as a guided, step-based tour that Q narrates while it acts on screen. It is triggered by asking Q in any wording ("pitch Capital Q", "explain Capital Q to us", "what can you do?", "show me what this is"). There are no keywords; it is resolved by meaning, and the existing Q Pitch button or page stays too. It works from any account; the track depends on the side (investor or founder).

## Principles

- **Zero latency, "gaming the system".** On entering pitch mode, preload everything: the script, step graph, routes, section anchors, the data each step shows, voice lines (pre-render where possible), and the Q&A answer bank. Navigation and actions are deterministic code. Q narrates; the model is not consulted to decide where to go. Leaving pitch mode returns Q to normal.
- **Section-level navigation, not just pages.** Every step targets a page AND a section. Q scrolls to it, expands or collapses it, opens it and closes it, and highlights the section being discussed with the existing golden highlight. Highlighting is mandatory for each section Q talks about.
- **Steps.** The tour is a list of numbered steps. The viewer can say or type "next", "go back", "back two steps", "forward three steps", "go to step 7", "skip this", "pause" or "resume" at any time, and Q obeys exactly and instantly.
- **Discover in pitch mode is muted.** Video sound is never played by the tour.
- **Language** follows the viewer's chosen language (existing translation layer).
- **Honesty.** Q presents Capital Q as it is: pre-seed and bootstrapping. Don't invent traction, team or customers; say plainly that the team and other items are not important right now. Fictional demo companies stay labelled as demo data.
- **Q&A afterwards.** Once the tour ends (or anytime it's paused), the viewer can ask questions. Prepare a bank of the investor/founder questions people are likely to ask (product, market, why now, moat, business model, pricing, competition, data privacy, AI accuracy, scores methodology, go-to-market, team, roadmap, ask, risks, etc.), with grounded answers drawn from the product sources and specs (docs/product-sources, docs/architecture, the InvestIQ methodology, the landing promises). Retrieve by meaning, instantly (an embedding or keyword index loaded in memory at pitch start), and answer immediately. Fall back to normal Q only when nothing matches.

## Investor track (e.g. the Savanna account)

1. Q introduces Capital Q in a sentence or two.
2. **Matching companies:** "With Capital Q you find companies that match your mandate". Three company cards appear. Each card expands in turn to the biggest view while Q explains that company, its Investability and Suitability scores, what each score means, and why they rank that way (use the methodology script).
3. **Two places to browse:**
   - Discover: a TikTok-style feed, muted. Scroll 1, 2, 3.
   - Open a company profile. Walk the tabs:
     - Overview: explain that it is built from the deck and pitch. Scroll it and highlight sections.
     - Diligence: scroll, expand and collapse items.
     - Elevator pitch.
     - Data room.
     - Pitch deck.
     - Team.
4. **Explore:** scroll the mosaic, then explain Express Interest, and that once they accept, the founder appears in your CRM.
5. **Relationships/CRM record:**
   - each tab of a relationship (chat, diligence, calls, notes, etc.);
   - chatting, booking a meeting, and Q joining the meeting (describe it; no live meeting);
   - after the meeting, Q asks you to confirm any commitments.
6. **Capital:** "where the business actually happens". Commitments appear here. Highlight each section.
7. **CRM:** Overview (Needs you), Pipeline, Capital. "This is where you monitor everything."
8. **Q Work (agents):** you can tell Q to act for you (watch your mandate, express interest, chat, book meetings, within your approval rules). Show a demonstration plan or job, then the team view with the agents working (planner, drafter, reviewer, etc.) and what each does.
9. **Q Daily:** news and stories based on your mandate and interests.
10. **GateQ (investor side):** the GateQ inbox. Open an application or message, scroll it, highlight each section (Q's reading, the founder's own words, the dossier), and explain it.
11. Anything else important in the app. Review the entire application and include every feature worth showing.
12. Hand-over, then Q&A.

## Founder track (a founder account; Capital Q's own founder account, or whichever founder is signed in)

- Subject is Capital Q itself (pre-seed, bootstrapping). Q pitches it using the 14-section Overview template: problem, solution, how it works, business model, why now, etc. Add market research for "why now" from the sources (docs/product-sources, landing research). Omit team-size claims.

1. Q explains itself and what it does for founders, and why it matters.
2. **Matching investors:** "Q finds investors whose mandates you match". Three investor cards; each expands while Q explains the investor and why they match.
3. Discover (investors) and open an investor profile page (the redesigned one, with full investor info). Walk its sections.
4. Explore: other founders' pitches. Note that founders can't express interest; that's an investor action.
5. **CRM (founder view):** how it differs. Walk it like the investor journey, including Capital (the raise and commitments).
6. **GateQ (founder side):**
   - Open an investor's gateway, show the form, and fill it instantly, field by field. Q is a bot here, so it should take seconds; if filling would waste time, just describe it.
   - Then open the interview. If possible, show a Q-to-Q video interview: Q as the applicant presenting Capital Q, answering the GateQ interviewer persona (Tavus).
   - If that isn't feasible, show the interview screen and describe it.
7. **Relationships and meetings:** chatting; a meeting booked; the notification arrives.
8. **Rehearsals:** go to rehearsals for that investor and start a rehearsal.
   - If possible, a Q-to-Q rehearsal: Q presents Capital Q as the founder to the investor persona. All its words must show it is presenting.
   - Otherwise show a completed rehearsal's results and assessment, and explain how Q coaches.
9. Q Daily and the agents (as in the investor track).
10. Hand-over, then Q&A.

## Q-to-Q (GateQ interview and rehearsal)

Q plays the presenter (founder of Capital Q) talking to the Q-run persona. The presenter's lines are preloaded and scripted from the Capital Q pitch facts and stay in character as presenting. Keep paid video within budget: Tavus has an 85-minute monthly safeguard, about 17 minutes used. Total testing is at most 2 short sessions (≤90 s each); prefer voice-only or a recorded or precomputed exchange if video isn't reliable.

## Definition of done

Done means all of the following hold in a real browser:

- Both tracks run end to end on production in a real browser.
- Step commands work: next, back N, forward N and go to N.
- Every section Q talks about is highlighted.
- No waits beyond the narration itself.
- Discover is muted.
- Q&A answers instantly from the bank.
- Triggered from a natural-language request.
- Certified with the existing CERTIFICATION_MANIFEST approach.
