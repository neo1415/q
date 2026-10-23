# Capital Q premium QA scorecard

The owner's mandate (23 Oct 2026): use Capital Q on production the way a demanding investor and a demanding founder would, and try to break it. Find what bites, fix the underlying causes (not patches), and keep going until Capital Q scores **at least 95%** for completeness and premium feel. This file is the living checklist. Every QA pass updates it.

**Rules**

- **Test on production as a real user.** Talk to Q (typed and spoken), click buttons, navigate, expand cards, try odd orders and odd places.
- **Evidence for every finding:** the run id, a screenshot, or the exact reply.
- **Fix the cause.** Owner rule: no keyword or phrase lists decide behaviour (a cheap hint for speed is fine). Use the Context Firewall, the truth classes, and approval for outward actions.
- **Accounts:** only fictional `@fictional.capitalq.local` accounts in automation. The owner's own accounts are tested only with the owner's explicit OK in that session.

**Scoring.** Each item is scored 0, 1 or 2:

- 0 = missing or broken
- 1 = works but not premium (slow, clumsy, generic, needs extra steps)
- 2 = premium (fast, smart, right first time, looks great)

Score % = sum ÷ (2 × items).

## Investor: the day-to-day and what bites

| #   | Job                                                                                                                                     | Score | Last checked | Notes / finding ids                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------ | ---------------------------------------------------- |
| I1  | Morning: "what needs my attention today": new matches, replies, meetings, approvals, deadlines                                          | 2     | 23 Oct       | Good plan-style answer                               |
| I2  | Deal flow: the best N companies for my mandate, the count honoured, ranked with reasons                                                 | 0     | 23 Oct       | F-01 (asked 5, got 1); fix in reader v58             |
| I3  | Filtered lists (sector, country, stage, raising) ranked by fit, with the real count                                                     | 0     | 23 Oct       | F-02; fix in reader v58                              |
| I4  | Discover feed: infinite, fair, video plays, Save, Pass and Interest feel instant                                                        |       |              | Continuation verified by API, not by browser         |
| I5  | Screen one company fast: one line, team, traction (company-stated figures), raise, fit, red flags, evidence                             | 1     | 23 Oct       | Figures OK; team often unknown                       |
| I6  | Compare 2–3 companies: a TABLE plus the real differences                                                                                | 0     | 23 Oct       | F-03 (no table via the FIT path)                     |
| I7  | Cheque compatibility, same and cross currency (estimate labelled)                                                                       | 2     | 23 Oct       | Silo Credit "Yes …"                                  |
| I8  | Risks and diligence questions for a company                                                                                             | 2     | 23 Oct       |                                                      |
| I9  | Founder and team background: public web, LinkedIn, photo, sources                                                                       | 1     | 23 Oct       | Person lane OK; photo fixes deploying                |
| I10 | Market and competitor research on a company's space → a document                                                                        | 0     | 23 Oct       | F-04; Q Analyst #370 pending                         |
| I11 | First contact: a note to founders → Express Interest with the note shown, approve to send                                               | 0     | 23 Oct       | F-05 (routed to "open page")                         |
| I12 | Schedule a call; prep for a call; follow up after                                                                                       |       |              |                                                      |
| I13 | Pipeline: track companies by stage, notes, reminders; Q saves its outputs (plans, memos, lists) to the Work board and acts on its items |       |              | Owner example: "save the 12-month plan to the board" |
| I14 | Investment or IC memo for a company → a shareable document                                                                              |       |              |                                                      |
| I15 | Data room: request access, read documents, Q answers from them with citations                                                           |       |              |                                                      |
| I16 | Memory and preferences: Q remembers what I like and pass on, and never silently rewrites my mandate                                     |       |              |                                                      |
| I17 | Mandate: view and update; recommendations change accordingly                                                                            |       |              |                                                      |
| I18 | Meetings: notes, transcript, action items; the rehearsal or meeting face                                                                |       |              |                                                      |
| I19 | Voice: talk to Q hands-free; first words under 2 s; no invented tags                                                                    |       |              |                                                      |
| I20 | Trust: sources shown, truth labels, no invented numbers, privacy holds                                                                  | 1     | 23 Oct       |                                                      |
| I21 | Speed: first words under 2 s, pages instant, no long silent waits                                                                       | 1     | 23 Oct       |                                                      |
| I22 | Q Pitch ("Hey Q, pitch yourself"), typed and spoken                                                                                     | 2     | 23 Oct       | Typed verified; spoken needs the owner's mic         |

## Founder: the day-to-day and what bites

| #   | Job                                                                                            | Score | Last checked | Notes / finding ids     |
| --- | ---------------------------------------------------------------------------------------------- | ----- | ------------ | ----------------------- |
| F1  | Onboarding: upload a deck, Q extracts, confirm facts, fill gaps; useful before demanding video |       |              |                         |
| F2  | "How investor-ready am I?" and how to improve (readiness, InvestIQ)                            | 2     | 23 Oct       |                         |
| F3  | Which investors to approach and why (interest first, sector-honest)                            | 0     | 23 Oct       | F-06; fix in reader v58 |
| F4  | Outreach: draft and send connection requests and replies with approval                         |       |              |                         |
| F5  | Respond to investor interest; manage relationships                                             |       |              |                         |
| F6  | Call prep with a named investor, then "rehearse it"                                            | 0     | 23 Oct       | F-07; fix in reader v58 |
| F7  | Rehearsal: persona voice, accent, emotion, Tavus face                                          | 1     | 23 Oct       |                         |
| F8  | Data room: upload, access levels, who can see what                                             |       |              |                         |
| F9  | Pitch video: upload, play, feedback                                                            |       |              |                         |
| F10 | Q Card: profile, team, photos, share link; personal cards                                      | 1     | 23 Oct       |                         |
| F11 | Growth plan or market research → a premium document, saved to Work                             | 0     | 23 Oct       | F-04                    |
| F12 | Fundraise tracking: pipeline of investors and their state                                      |       |              |                         |
| F13 | Answer diligence questions from investors                                                      |       |              |                         |
| F14 | "Who looked at my pitch?": an honest product answer                                            | 1     | 23 Oct       | Copy fix deployed       |
| F15 | One-pager or brief PDF                                                                         | 2     | 23 Oct       |                         |

## UI / UX across the product

| #   | Check                                                                                   | Score | Last checked | Notes                     |
| --- | --------------------------------------------------------------------------------------- | ----- | ------------ | ------------------------- |
| U1  | Every card expands with content (no blank panels)                                       |       |              | F-08 (fix deployed 16:32) |
| U2  | No duplicated pictures or frames (stage plus thread)                                    |       |              |                           |
| U3  | Board / Work: Q can add, update and complete items; the user can drag and organise them |       |              |                           |
| U4  | Navigation by voice or text to any page ("open my data room", "show Silo Credit")       |       |              |                           |
| U5  | Empty states, loading and errors: helpful, never raw codes                              |       |              |                           |
| U6  | Mobile 390 px: no overflow, 44 px touch targets                                         |       |              |                           |
| U7  | Light and dark themes; WCAG AA contrast                                                 |       |              |                           |
| U8  | Arabic / RTL                                                                            |       |              |                           |
| U9  | No internal names shown ("Q's team", agent names)                                       |       |              |                           |
| U10 | Approval cards: exact payload, edit, "Ready to send" wording                            |       |              |                           |

## Findings log

| id   | Found (UTC)  | Who      | Finding                                                               | Evidence          | Owner          | Status                          |
| ---- | ------------ | -------- | --------------------------------------------------------------------- | ----------------- | -------------- | ------------------------------- |
| F-01 | 23 Oct 17:2x | investor | "Five that best fit" → 1 (count read from the words)                  | journey run 1     | lane 4         | in reader v58 (deploying 20:06) |
| F-02 | 23 Oct 17:2x | investor | Lists "listed by name, not ranked"; capped at 24 by name              | journey run 1     | lane 4         | in reader v58                   |
| F-03 | 23 Oct 19:48 | investor | Compare: reads happen, but the FIT path returns no TABLE              | run f5415b0c      | lane 8         | fixing                          |
| F-04 | 23 Oct 17:47 | founder  | Growth-plan job: 1 garbled search, generic brief, 23 s                | work job 17:47    | Q Analyst      | #370 in review                  |
| F-05 | 23 Oct 19:48 | investor | "Draft a note to the founders" → opens the page, no note or interest  | run 1102eab6      | S9b            | fixing                          |
| F-06 | 23 Oct 17:30 | founder  | "Which investors first?" → "can't identify investors"                 | run a057fc00      | S1             | in reader v58                   |
| F-07 | 23 Oct 17:3x | founder  | Call prep → a plan question and "Q's team:"                           | journey founder 2 | lane 5         | in reader v58                   |
| F-08 | 23 Oct 15:2x | owner    | Blank expanded card                                                   | owner screenshot  | lane 4         | deployed 16:32                  |
| F-09 | 23 Oct       | data     | 12 duplicate "Zino Aviation" investor orgs, 3 company rows (sign-ups) | hosted read       | owner decision | open                            |
