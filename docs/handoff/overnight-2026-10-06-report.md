# Overnight report, 6 October 2026

## Executive summary

Every item in the overnight brief has been worked on, merged into one build and deployed. All four services are live and healthy (web, api, q-api, workers on Railway). The hosted database has all 156 migrations, with none missing. The mockups the builders designed against are in the "Capital Q Overnight Mockups" gallery.

What you can try this morning:

- **Company profile** has tabs: Overview, Elevator, Data room, Pitch deck, Team. The data room has per-document visibility. Q reads the pitch deck into 12 standard sections you can swipe, and coaches the founder on the gaps.
- **Fit scores** read "7.5/10 · Good fit" everywhere: profiles, Company requests, relationship cards, top 3 and Q's answer cards. Each score is backed by nine parameters with plain reasons. "Founder requests" is now **Company requests**.
- **Q's answers** for top N, comparisons and research arrive as coloured cards. The card Q is talking about expands while the others shrink. Every card has a close button, cards move to the redesigned **Board** when the topic changes, and there is no PDF unless you ask for one. Suggestions run on one tap.
- **"Hey Q" / "Hello Q" / "Hi Q" / "OK Q"** opens Q, and Q says "Hi — what can I do?". It's off by default; turn it on in Settings → Q.
- **Explore** is a masonry grid of every pitch on the network. Opening one shows related pitches next, and search opens profiles.
- **GateQ** has its own sidebar page: a 4-step form for founders, a Gmail-style inbox for investors with a download pack, and Find my startup.
- **Teams:** invite colleagues, set roles (Owner, Admin, Member), leave or remove people, hand over ownership, and switch between companies or firms.
- **Q's team of agents:** a lead Q plans jobs, and a reviewer grades every outward draft against your guides and sends weak drafts back for a redraft. The Work page shows who is doing what, the scores and the month's cost. Q can propose a job and spawn helpers, and you approve the plan.
- **Brand:** black and gold is the default and can be switched back at any time. Q's presence morphs into freer shapes, and shows a warm human face only while speaking on the Q page. Soft sounds (On / Quiet / Off).
- **Voice:** live voice now survives bad networks. It stays on the line through weak patches and rejoins on the same voice after a drop. Speed fixes are in: parallel readers, Gemini key failover, hedged classifiers, and starting the spoken answer early.
- **Wording:** plain-language pass across the app for non-technical users.

What is **not** finished, plainly:

1. **Voice speed target not reached.** Expected p50 first audio is about 3–3.5 s, down from 5.1 s. That is an estimate from tests, not yet measured live. The 1.5 s target needs the turn reader off the critical path entirely.
2. **The wake word uses the browser's own speech recogniser, not a trained on-device model.** That means up to 8 s of speech can go to Google or Apple after the loudness gate opens. The setting says so before you turn it on. Training a model needs a GPU machine and multi-accent audio (ADR 0058).
3. **Fit data:** stage, sector, geography and thesis use real data. Traction, team, business model and round terms have no data source yet, so they show "Unknown", and most real scores will be medium or low confidence.
4. **GateQ** records passes, replies and claim codes but sends no email for them yet. Applications are not yet linked to the shared company–investor relationship.
5. **Not tested live in a browser with a real microphone or a bad network.** Everything ran under automated tests with fakes, plus production builds.

## Decisions I made under your blanket approval

- **ADR 0059: one score scale.** Fit shows a score out of 10 beside its words ("7.5/10 · Good fit"), matching Q's answer cards. It is computed in code only from the parameters you can see. There is no score at all when too little is known or a declared rule excludes the company. Never percentages, gauges or "94% match". This amends ADR 0052.
- **ADR 0051: Q's face.** A human face only while Q speaks on the Q page at a large size; everywhere else Q is shape and motion. The black and gold preset is the default.
- **ADR 0053:** Q may rank and score answer cards. The model rates each measure in words; code computes the number.
- **ADR 0055:** Explore shows no counts anywhere (no views, likes or "48 more").
- **ADR 0057:** organisations are teams with Owner, Admin and Member, and always at least one Owner.
- **ADR 0058:** browser recogniser for the wake word until a trained model exists.
- Explore replaces Search in the sidebar and takes Capital's place in the phone bar. Capital stays in the sidebar and More.
- GateQ's three migrations were renumbered after the organisations migration because one of them reused its version number. Hosted applied cleanly.

## Every item, one by one

### A. Company profile
| Id | Status | What was done |
|---|---|---|
| A1 | Done | Tabs Overview · Elevator · Data room · Pitch deck · Team. Overview unchanged, with the fit panel beside it for investors. |
| A2 | Done | Elevator holds all the founder's videos and pitches. |
| A3 | Done | Data room with research-based folders (incorporation, KYC/KYB, cap table, financials, tax, legal and IP, contracts, team) and four visibility levels: Public, On request, Shared only, Private. Investors never see titles of documents not shared with them. "Request access" leads to founder approval. Tables are server-only, with database tests passing. |
| A4 | Done | The founder chooses downloadable or view-only. View-only still shows the deck. |
| A5 | Done | Q reads a deck once per version into 12 sections in the same order for everyone, with slide citations. Swipe on phone, arrows on desktop. Runs automatically when a deck finishes processing. |
| A6 | Done | Coaching scores each section, names what's missing or weak and how to fix it. "Let Q draft it" saves a new version only after approval, or the founder re-uploads. Deck quality never feeds investor ranking. |
| A7 | Done | Founder as a person: age only if shared, and every background line labelled as the founder's claim or matched to a document. |
| A8 | Done | Q tools to read, extract, coach, set visibility, request and answer access, all through approval where they change something. |

### B. Match scores
| Id | Status | What was done |
|---|---|---|
| B1 | Done, partial data | Nine parameters (stage, sector, geography, cheque size, business model, traction, team, thesis, round terms), each with a word, a shape icon and a reason sentence. Unknown never counts against a company. Four parameters have no data source yet (see the summary). |
| B2 | Done | "Top three" ranks and shows them side by side with scores and reasons, both as Q answer cards and on `/investors/top` with "Why these three?". |
| B3 | Done | Scores on relationship cards, Company requests and the company profile. |
| B4 | Done | Renamed to **Company requests** everywhere. Cards show the score, top reasons, the main mismatch and Q's view (Worth a look / Maybe / Probably not), sort by best fit, newest or waiting longest, and open the profile. |

### C. Q page answers
| Id | Status | What was done |
|---|---|---|
| C1 | Done | Ranked, side-by-side and research answers render as coloured cards (1–10) with a score, three reasons and measures, laid out for any count. |
| C2 | Done | The card Q is talking about expands and the rest shrink, synced to Q's voice. On phones, four or more become half-width tiles. |
| C3 | Done | An X on every card and on the whole answer. |
| C4 | Done | On a new topic, cards fly into the Board and the presence returns. |
| C5 | Done | No PDF unless a file is asked for; comparisons show on screen. Root cause fixed: the request reader treated "a comparison" as a document request. |
| C6 | Done | A compact answer chip on other pages, with "Open in Q" and "Board". Files keep their floating viewer. |
| C7 | Done | The Board is redesigned as a timeline by day, with Pinned and Files (tabs on phone). Sources fold under one plain line. |
| C8 | Done | 12 suggestion buttons send at once. Only "Share X with…"-style prompts still pre-fill, because they need a name. |
| C9 | Done | Root causes found in yesterday's logs: no ranked-answer shape plus an analyst rule forbidding scores (top three); a document-request misreading (PDF); no research structure (YC). All three are fixed. |

### D. Wake words
| Id | Status | What was done |
|---|---|---|
| D1 | Done | Hey / Hello / Hi / OK Q opens Q with a chime, and Q says "Hi — what can I do?". Rejects "hey you", "OK cool" and "okay Google". |
| D2 | Partly | Research done: Picovoice is too costly now, and openWakeWord's models are non-commercial. Shipped a local loudness gate plus the browser recogniser, with a visible toggle (off by default), a mic permission flow, a "Listening for 'Hey Q'" indicator with Pause, pausing when hidden or on low battery, and a lazy load. Not a trained on-device model (ADR 0058). |

### E. Explore
| Id | Status | What was done |
|---|---|---|
| E1 | Done | Every network pitch you are allowed to see, lightly personalised from your mandate, adjacent areas, saves and newest, plus exploration and a diversity pass. Views are never used. |
| E2 | Done | Masonry grid sized by each video's aspect ratio: 2 columns on phone, 4–5 on desktop, with no layout shift. |
| E3 | Done | Opening a pitch gives a full-screen "Related to X" feed with a back button. |
| E4 | Done | Search with tabs Top · Companies · Investors · People · Pitches. Results open profiles. |
| E5 | Done | Research on Instagram and TikTok Explore, copying their structure but not their engagement goal. Each tile says why it is shown, with a "You're up to date" end point. |

### F. GateQ
| Id | Status | What was done |
|---|---|---|
| F1 | Done | A 4-step form (not a chat), with "I'd rather not say" on every question and the investor's rules shown first. You get a rule-by-rule result after each step, with no model involved. Nothing is sent until "Send to <fund>". |
| F2 | Done | Its own sidebar page at `/gateq`: Applications and Find my startup for founders; Inbox, Find a startup and Your gate for investors. |
| F3 | Done | Founders find and claim their company (work email, registry document or asking members). Investors describe what they want and get matches from Discover, which they can save as an alert. Alerts don't notify yet. |
| F4 | Done | A Gmail-style inbox with views, stars, labels, bulk actions, reply-by clocks, assign, team notes, a preview pane and keyboard shortcuts (which can be turned off). The download pack holds a summary PDF, only the documents the founder sent and their answers; team notes are never included and every download is logged. A pass always needs a reason and sends only the approved words. Q can triage, summarise and draft, but never sends. |

### G. Organisations
| Id | Status | What was done |
|---|---|---|
| G1 | Done | Real teams: Owner, Admin, Member. Everyone starts as their own organisation's owner, and the database refuses removing the last owner. |
| G2 | Done | Invite (several emails, one role), pending invites, resend or revoke, role changes, remove, leave, ownership handover, accept via link (`/join/…`), and the switcher (hidden until you belong to two). Screens say "Company" or "Firm". Q can invite and change roles on an approval card. Not built: domain auto-join. |

### H. Wording
| Id | Status | What was done |
|---|---|---|
| H1 | Done | Audit of about 3,900 visible strings. About 60 system words were rewritten plus 31 "Not found." errors. Glossary: `docs/design/ux-writing-2026-10-06.md`. |
| H2 | Done | Journey checks during each build: Explore in the bottom bar, GateQ in the sidebar, Company requests renamed, Team in Settings, Hey Q in Settings → Q. |

### I. Voice and sound
| Id | Status | What was done |
|---|---|---|
| I1 | Done (resilience), partly (speed) | Yesterday's logs showed fallbacks caused by over-eager health thresholds, not the cap. A weak line now stays up with a deeper buffer, a drop gets 5 s to heal and then rejoins on the same voice with the conversation replayed, and the 10-minute limit renews silently. End reports now record the cause and line quality. Not yet tried on a real bad network. Research suggests UAE networks block WebRTC; a port-443 relay is the next step, and it needs your call (new infrastructure). |
| I2 | Done | Seven quiet sounds: a hum while thinking (stops by itself after 20 s), a ping when ready, and more. On / Quiet / Off in Settings → Appearance. Silent while Q speaks and on Discover. |

### J. Q's workforce
| Id | Status | What was done |
|---|---|---|
| J1 | Done | Roles: lead, outreach, mandate watcher, conversation, writer, reviewer, scheduler, documents, research, ad-hoc. Each has its own tools and budget, with every hand-off recorded. |
| J2 | Done | The reviewer grades every outward draft against your guide and the house guide; integrity rules can't be averaged away. Below the bar it goes back to the writer (at most 2 redrafts). A draft that never passes is never sent. This covers all five outward paths. |
| J3 | Done | Approvals, edits and rejections become "what worked" notes through the memory Write Gate, and feed the writer and reviewer. |
| J4 | Done | Q can propose a job (`propose_q_job`). The lead's plan is the approval card, and approved helpers get only the tools their step needs. It is never re-planned or widened. |
| J5 | Done | The Work page shows a run log per job: steps, specialists, hand-offs, the reviewer's score against the bar, "Sent back to Writer", approve-and-send on the exact text, and the month's cost by specialist. |
| J6 | Done | Every agent call is priced per job in the usage ledger, with a monthly limit (default $60) after which new jobs hold. The `q.agent_jobs` plan feature appears in Settings → Usage. |
| J7 | Done, with stated exceptions | Phrase lists replaced with model readings (approval/refusal, onboarding moves, preference polarity, meeting outcomes, "sounds like a no", and others). Kept as deterministic checks: guards on Q's own output (no early meeting ask, no false history), and bare "yes"/"no" on a live voice line, for speed. |
| J8 | Done | Guides load before every outward message, and the reviewer enforces them. Includes the "think before acting" step from yesterday. |
| J9 | Done | Q drafts a plan, you approve it and it runs as you within budget. Not yet proven on a long real job. |

### K. Presence and brand
| Id | Status | What was done |
|---|---|---|
| K1 | Done | Free morphing shapes (ring, wave, spiral, constellation, ribbon) with a swirling staggered morph. |
| K2 | Done | The "demon" face is gone. Its look came from hollow eye sockets and harsh lighting. The new face is warm and evenly lit, with blinking and a lower lip that moves with the voice. It appears only while speaking on the Q page. |
| K3 | Done | Black and gold is the default, with full presets for page, menu bar, buttons and Q's light, and every colour pair passes AA. It can be switched back to blue at any time from Admin → Brand. |

### L, M, N
| Id | Status | What was done |
|---|---|---|
| L1 | Partly | Pages: the app layout, Discover, onboarding checks, relationships and profile now load in parallel. Q answers: settings reads run in parallel. Voice: the decision reader runs alongside the turn reader, a refused Gemini key fails over to the other key (this removes the 3.5–5 s stalls), classifiers are hedged after 2 s, bursts are debounced and the answer starts speculatively. Estimated p50 about 3–3.5 s, from 5.1 s; not measured live. The 1.5 s target is not reached. |
| M1 | Done | 12 research files in `docs/research/2026-10-06/` (data room, pitch deck, matching, Explore, GateQ inbox, organisations, wake word, voice resilience, agent workforce, UX writing, sound, presence and brand), each ending with gaps and recommendations, which the builders followed. |
| N1 | Done | 580 + 107 mockup screenshots (phone and desktop, light, dark and gold) and 17 videos; the curated set is in the gallery. |
| N2 | Done, with limits | Built to the mockups, with screenshot comparisons per area. Tests: the full unit suite (about 9,400 tests), database RLS suites for every new table, typecheck and a production web build. Not done: e2e and live browser trials with a real microphone. |
| N3 | Done | Deployed and healthy; this report. |

## Technical detail

**Deployed commit:** `225b779d` on `recovery/2026-09-12` (deploy), `recovery/2026-09-12-8y2j4w` and `claude/rana-account-setup-8esh9e`; deployed at 07:29 UTC, all four services SUCCESS.

**Hosted migrations added tonight (156 total, none missing):**
- 20261206140000 and 20261206150000: wake and etiquette guides;
- 20261207090000: workforce;
- 20261207100000: brand presets;
- 20261207110000 and 20261207120000: data room and deck extractions;
- 20261207150000: organisation team;
- 20261207163000: routing hedge;
- 20261207170000, 20261207171000 and 20261207172000: GateQ inbox, Find my startup and application founders.

**Checks run, exact:**
- Package build: 51/51 tasks.
- Typecheck: root, web, api, q-api and workers, 0 errors.
- Full vitest (`--maxWorkers=1`) after every merge: 9,429 passed, 1 skipped, 1 failed. The failure was the Company requests rename guard catching the old wording in a code comment; it was fixed (2/2 on rerun) and redeployed.
- pgTAP:
  - organisations: 38/38;
  - GateQ inbox: 26/26;
  - Find my startup: 15/15;
  - application founders: 7/7;
  - schema guard: 12/12.
- `next build`: compiled.
- Deploy: all four services SUCCESS; `/health/live` returns 200 on api and q-api; no errors in the logs.

**Known technical gaps:**
- The GateQ pack streams through Next.js.
- The Explore slate is computed on read over the newest 240 pitches.
- Classic blue's field borders are below 3:1.
- Dev review pages need `CQ_DEV_PREVIEW=1`.
- `pnpm format:check` still fails on about 175 older files that were already unformatted.

## What I need from you

1. Try voice on a poor connection and tell me whether it holds. If the Dubai problem was a network block, decide whether we add a port-443 relay.
2. Decide whether to fund training a real on-device wake-word model.
3. Confirm the score format "7.5/10 · Good fit".
