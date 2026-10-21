# Q Story Premiere — plan (coordinator, 2026-10-21, night)

**Owner direction, 2026-10-21.** Q pitches Capital Q itself by telling the owner's story ([`story/Q_STORY_VERBATIM.txt`](story/Q_STORY_VERBATIM.txt); original: [`story/Q_Story.docx`](story/Q_Story.docx)).

**What the owner asked for:**

- **Words are verbatim.** They are never paraphrased, never shortened and never "improved".
- **Delivery is human.** Q speaks deliberately, with pauses, warmth, humour, laughter, whispers and slowing down where the story asks for it.
- **The app moves at talking speed.** Captions, artifacts, pictures, page and section navigation, and highlights land on the word, never after it.
- **Zero stutter.** Everything is preloaded and cached. Nothing is fetched from the database mid-story.
- **Triggers:** it starts from the Q page, from the Q Pitch button, and from asking Q ("present Capital Q", "pitch Capital Q").
- **Q&A afterwards:** an investor Q&A bank of product questions, answered without technical jargon.
- **Polish:** Apple-level smoothness and micro-animation.

**Relationship to the blueprint.** This is **v7** of Q Pitch: the story track. It **extends the v5/v6 engine**, which is not rebuilt:

- `packages/q-pitch`: director, step graph, gate, ledger, QA bank, step commands;
- `apps/web/src/features/q-pitch`: host, `section-light`, tour voice, presence.

Conflicts with the blueprint are listed in §8 for owner sign-off.

---

## 1. How it is built: three roles, one clock

The owner asked for "one that talks, one that follows everything it says, one that makes sure it makes no mistake". These are three roles, never three models deciding live.

| Role         | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Exists today                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Narrator** | Plays the story's audio.<br>**Primary:** pre-rendered once with ElevenLabs (the repo already uses `eleven_v3_conversational` / `eleven_v4_turbo`; v3 takes audio tags such as `[whispers]`, `[sighs]`, `[laughs softly]`, `[pause]`, which are delivery, not words, so the text stays verbatim). Each beat is rendered **with word timestamps** (ElevenLabs "with timestamps" alignment) and stored as static audio plus alignment JSON.<br>**Fallback:** GPT-Live speaks the same lines with per-beat delivery instructions. | Tour voice exists (`tour-voice.ts`); pre-rendering is new. |
| **Director** | A **cue timeline**. Each cue is anchored to a **word index** in a beat and executes a typed `TourAction` (navigate, section-light, artifact, picture, caption, highlight-pulse, chrome-dim). The **audio clock is the master clock** (`AudioContext.currentTime`). Visual cues fire about 120 ms **before** their word, so they land on it.                                                                                                                                                                                   | Director and `TourAction` exist; word-clock cues are new.  |
| **Verifier** | Each act must acknowledge (route visible, anchor found, image decoded) within its budget. If it doesn't, a **safe fallback** runs: stay on the Q stage and show the artifact there. **Audio never waits for a visual.** The rule "never say _there it is_ before the screen shows it" is met by construction: visuals lead the word.                                                                                                                                                                                          | The gate, receipts and SAFE_FALLBACK exist.                |

**Preload ("game the system").** On entering story mode, load into memory:

- the full beat table (text, tags, cues);
- all audio and alignment (about 5–6 MB);
- every picture (decoded `Image()` objects);
- every artifact's data (demo fixtures);
- every page route the story visits (`router.prefetch`).

The **next two beats'** routes are kept warm. There are no database reads and no model calls during the story.

**Storage.** The story text and cues live in code: `packages/q-pitch/src/story/` is a sealed script, versioned like `premiere.ts`. That is "the base" Q reads from.

- Audio is static assets: `apps/web/public/q-pitch/story/<voice>/<beat>.mp3` plus `.json`, or the CDN, never Postgres.
- The verbatim text is checked by a test against [`story/Q_STORY_VERBATIM.txt`](story/Q_STORY_VERBATIM.txt): **a single changed word fails CI**.

---

## 2. Emotional map (how each passage is delivered)

| Act                    | Lines                                                                | Delivery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pace            |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 0 Hello                | "Hi. I'm Q." / "let me tell you a story."                            | Warm and bright, a smile in the voice. Then a lean-in: lower, conspiratorial.                                                                                                                                                                                                                                                                                                                                                                                                               | normal → slower |
| 1 The investor's night | "It's 11:47 at night." … "if you already missed the right one."      | Quiet, close-mic, late-night. "Decks. Introductions. Referrals. Applications." is staccato, one beat each. "Opportunity everywhere." carries a hint of awe. "Is this worth the risk? Do I trust this business?" is intimate, almost whispered. "And you just might never know how much" trails off into silence.                                                                                                                                                                            | slow            |
| 2 The founder          | "Now, come with me to the other side of the table." … "Wait longer." | **Lift.** A warm invitation, a gear change. "Go raise." gets a fond, knowing chuckle. The Series A/B/C passage builds tension. "Maybe you're staring at a down round." is hushed and serious. "Then... silence." gets a **1.2 s real silence**. "Nothing." / "Again." / "Nothing." are sparse, each landing in quiet. "a no almost feels like mercy" is rueful, with a soft sad laugh. The list "Wrong stage…" is crisp. "and you just weren't ready." is gentle and honest, never mocking. | varied          |
| 3 The turn             | "There has to be a better way." / "And there is." / "CapitalQ."      | A breath, then confident warmth. "And there is." brings the smile back. "CapitalQ." is a proud, clear beat.                                                                                                                                                                                                                                                                                                                                                                                 | slow → normal   |
| 4 For investors        | "Think TikTok…" → "rise to the top."                                 | Playful energy. "plus Jarvis from Iron Man..." gets a light laugh. Lists are brisk and assured. "so meetings become decisions, not introductions" lands as a punchline.                                                                                                                                                                                                                                                                                                                     | brisk           |
| 5 For businesses       | "For businesses…" → "Who should."                                    | Warm and proud. The stage callbacks ("your first raise... your fifth...") are tender: they echo Act 2. "Who should." is the emphatic lean-in.                                                                                                                                                                                                                                                                                                                                               | normal          |
| 6 The close            | "And then... behavior changes." → "HOW WE EVER DID IT WITHOUT ME."   | Knowing. **"Send me your deck."** is a tired, gruff investor voice, comic. **"What's your Q Card?"** is bright and curious. The noun list is rhythmic. "Private capital has trillions of dollars." is reverent and slow. "What it still doesn't have..." is a pause, then "**home**" soft and certain. "I'm Q." is warm. The last line is confident, with a small grin and a laugh on "WITHOUT ME".                                                                                         | slow, final     |

The text keeps the owner's exact characters, including `HOME)` and the capitals. The audio reads them naturally: the capitals as emphasis, the stray ")" silent.

---

## 3. Beat-by-beat choreography (what moves on which word)

**Conventions:**

- `@word` is the cue word.
- The screen is the **Q page (Home Stage)** unless a route is named.
- "Story mode" means the app chrome dims to 35% behind a scrim, with the Q aperture centre stage.
- **Highlight** means the existing gold ring (`data-qp-lit`) **plus a breathing scale pulse** (transform 1.000 ↔ 1.015, 1.8 s ease-in-out, compositor-only, so CLS stays 0). It stays on while Q talks about that element, then moves on. Under reduced motion it is the ring only.

| #   | Words (verbatim, abridged here)                                                                                                | On screen                                                                                                                                                                                          | Source of truth                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Hi. I'm Q.                                                                                                                     | Aperture brightens (SPEAKING). The caption begins.                                                                                                                                                 | —                                                                 |
| 2   | …let me tell you a story.                                                                                                      | Story mode fades in (400 ms). Chrome recedes. The theme deepens to "night".                                                                                                                        | —                                                                 |
| 3   | It's 11:47 at night.                                                                                                           | Large quiet type "11:47 PM". Behind the scrim, a desk-at-night photo at 25% opacity.                                                                                                               | Pexels, curated and credited                                      |
| 4–5 | You're still at your desk. / Your inbox is full.                                                                               | An inbox stack rises.                                                                                                                                                                              | Illustrative (labelled)                                           |
| 6   | Decks.@ Introductions.@ Referrals.@ Applications.@                                                                             | One inbox item drops in **on each word**: deck.pdf, an intro email, a referral, an application.                                                                                                    | Illustrative                                                      |
| 7   | Opportunity everywhere.                                                                                                        | **Fast picture montage**: 12 tiles (markets, factories, labs, farms, cities, studios) cascade into a grid, staggered 60 ms.                                                                        | Pexels, pre-decoded                                               |
| 8   | …might be the investment that makes it all worth it.                                                                           | One tile lights in Q accent: the needle in the haystack.                                                                                                                                           | —                                                                 |
| 9   | But it doesn't announce itself.                                                                                                | The lit tile fades back into the grey grid.                                                                                                                                                        | —                                                                 |
| 10  | Every deal takes time… capital sits waiting.                                                                                   | The grid slowly drifts. Calendar blocks stack.                                                                                                                                                     | —                                                                 |
| 11  | If it's a fund, your investors want results.                                                                                   | Caption only.                                                                                                                                                                                      | —                                                                 |
| 12  | Is this worth the risk? Do I trust this business?                                                                              | The two questions as large type, one, then the other.                                                                                                                                              | —                                                                 |
| 13  | Every bad investment costs you. / …every great one you never discover cost you too. / …never know how much                     | Two weights on a scale. The second is unknown (dashed outline: "Unknown stays unknown").                                                                                                           | —                                                                 |
| 14  | …afraid of saying yes to the wrong one... / …already missed the right one.                                                     | The grid dims.                                                                                                                                                                                     | —                                                                 |
| 15  | Now, come with me to the other side of the table.                                                                              | **The table turns**: a horizontal slide of the whole stage (400 ms spring). Night turns to day.                                                                                                    | —                                                                 |
| 16  | Maybe this is your first raise… Survived payroll. Won customers.                                                               | Four photos, one per phrase: workshop, own money, payroll day, first customer.                                                                                                                     | Pexels                                                            |
| 17  | "Go raise."                                                                                                                    | A small, fond caption flourish.                                                                                                                                                                    | —                                                                 |
| 18  | …a seed round. … Series A. You know the process.                                                                               | A round timeline draws itself: Seed ● → A ●.                                                                                                                                                       | —                                                                 |
| 19  | But now the bar is higher… growth slowed… market changed… valuation…                                                           | The bar lifts. Each "Maybe" line ticks in.                                                                                                                                                         | —                                                                 |
| 20  | Maybe you're staring at a down round.                                                                                          | A line chart draws, then dips. Hushed.                                                                                                                                                             | Illustrative                                                      |
| 21  | Series A to B... B to C... feels much further away.                                                                            | The timeline stretches. The next node drifts away.                                                                                                                                                 | —                                                                 |
| 22  | …an established business… expansion, new market, acquire, growth capital.                                                      | Factory, logistics and retail photos.                                                                                                                                                              | Pexels                                                            |
| 23  | Different stage. / Same problem.                                                                                               | Two-beat type.                                                                                                                                                                                     | —                                                                 |
| 24  | So you search.@ Pitch.@ Fly.@ Rewrite.@ Follow up.@                                                                            | One icon **on each verb** (search, deck, plane, pen, mail). Talking-speed montage.                                                                                                                 | —                                                                 |
| 25  | …an investor leans in. You send everything. Hope rises.                                                                        | Warm light rises.                                                                                                                                                                                  | —                                                                 |
| 26  | Then... silence.                                                                                                               | **Everything stops.** Captions fade, the scrim deepens, 1.2 s of real silence.                                                                                                                     | —                                                                 |
| 27  | You follow up. Nothing. Again. Nothing.                                                                                        | Sent bubbles with no reply. "Seen" never appears.                                                                                                                                                  | —                                                                 |
| 28  | …a "no" almost feels like mercy… gives you your time back.                                                                     | Caption only.                                                                                                                                                                                      | —                                                                 |
| 29  | Silence keeps you trapped… runway, momentum, and opportunity quietly disappear.                                                | Three words fade out, one by one.                                                                                                                                                                  | —                                                                 |
| 30  | wrong stage. Wrong geography. Wrong cheque size. Wrong thesis.                                                                 | **Four mismatch chips**: Stage, Geography, Cheque, Thesis (✕). **Foreshadowing**: these are mandate dimensions, paid off at #36.                                                                   | —                                                                 |
| 31  | Weak governance. Unclear numbers. Messy structure. Strong traction told badly.                                                 | **Four readiness chips** (outline). Paid off at #45 (InvestIQ).                                                                                                                                    | —                                                                 |
| 32  | So you pitch more. Wait longer. / There has to be a better way.                                                                | Stillness.                                                                                                                                                                                         | —                                                                 |
| 33  | And there is.                                                                                                                  | **The app wakes**: the scrim lifts and the aperture gives its "shutter" flash.                                                                                                                     | ux-direction §5.1 COMPLETE                                        |
| 34  | CapitalQ.                                                                                                                      | Wordmark beat beside the aperture.                                                                                                                                                                 | —                                                                 |
| 35  | Think TikTok for investment discovery... / plus Jarvis… / built for the entire investment journey.                             | **/discover** (muted): the feed advances one card. On "Jarvis", the dock glows. On "entire journey", the nav items light in sequence: Discover → Explore → Relationships → Capital → Work → GateQ. | Real routes                                                       |
| 36  | I learn how you invest. Your thesis.@ Stage.@ Sectors.@ Geography.@ Cheque size.@ Preferences.@ Minimum criteria.@             | **/capital mandate**: **each word highlights its mandate section**. The #30 chips reappear and **turn ✓**.                                                                                         | `INV-MANDATE-VIEW` (LIVE VERIFIED)                                |
| 37  | Then I configure what you discover around that.                                                                                | Back to **/discover**.                                                                                                                                                                             | `pilot.opening`                                                   |
| 38  | You swipe aligned opportunities, like Tiktok,                                                                                  | The feed swipes ×2 (muted).                                                                                                                                                                        | LIVE VERIFIED                                                     |
| 39  | And swipe to match with founders, like Tinder                                                                                  | A right-swipe hint on the card. **Express Interest highlighted, never pressed** (a consequential action).                                                                                          | swipe → Express Interest confirm exists (`feed-card.tsx`)         |
| 40  | Ask me anything.@ Compare businesses.@ Interrogate assumptions.@ Prepare for meetings.@                                        | Composer focus → the **top-three cards with scores** artifact, then the **side-by-side comparison** → the profile **Diligence** tab highlighted → the relationship **meeting prep** section.       | `pilot.compare` LIVE VERIFIED; profile tabs                       |
| 41  | …the Interview Before the Interview... so meetings become decisions, not introductions.                                        | **Direct jump** to a GateQ application's **interview transcript** and Q's reading; each highlighted.                                                                                               | GateQ (see §8, G1 certification)                                  |
| 42  | And for inbound... there's GateQ.                                                                                              | **/gateq**, gate tab.                                                                                                                                                                              | LIVE VERIFIED (inbox)                                             |
| 43  | You plug it into your website, application page, social media, accelerator, investment programme...                            | The share/embed section highlighted. Channel icons tick in **per noun**.                                                                                                                           | Gate config exists                                                |
| 44  | Every inbound opportunity lands in one place. / I interview them.@ Score them.@ Match them…@ rank them…@                       | **Inbox**: interview → score → match → **the list re-sorts once (FLIP 280 ms)**. The top item breathes on "rise to the top".                                                                       | **GAP**: the inbox shows no score or rank today (§8)              |
| 45  | For businesses, I become the investment associate… / first raise... fifth... Series B... down round... growth capital          | The Act-2 timeline **comes back**. Each callback lights its node.                                                                                                                                  | —                                                                 |
| 46  | Investability IQ shows what is ready.@ What is weak.@ Why it matters.@ …blocking your raise.@                                  | The **InvestIQ / readiness card** artifact. The #31 chips return as **real findings**: ready ✓, weak, why, blocker. Each highlighted.                                                              | InvestIQ PROPOSED; naming "Investability IQ" vs product name (§8) |
| 47  | …investors you genuinely suit. Not simply who could invest. Who should.                                                        | Three **investor match cards** (founder Q). "Who should." brings the top card forward.                                                                                                             | Founder track (`founder-v6.ts`)                                   |
| 48  | And then... behavior changes. / "Send me your deck." / "What's your Q Card?"                                                   | A deck PDF slides away. **A Q Card flips in.**                                                                                                                                                     | **GAP**: no Q Card exists (§8)                                    |
| 49  | One living private-capital identity with your story,@ your numbers,@ your raise,@ your intelligence,@ and your relationships.@ | Each noun highlights its part of the card: Overview / metrics / Capital raise / InvestIQ / CRM.                                                                                                    | Company profile parts exist                                       |
| 50  | One platform. Both sides.                                                                                                      | A split view: investor and founder.                                                                                                                                                                | —                                                                 |
| 51  | Discovery.@ Inbound.@ Intelligence.@ Readiness.@ Matching.@ Data.@ Relationships.@ Execution.@                                 | **Talking-speed montage**: on each word, a pre-captured screenshot of that real page (cached), about 0.6 s each. No live navigation, so no stutter.                                                | Screenshots of real pages                                         |
| 52  | weeks, months and even years... Now take minutes.                                                                              | Calendar pages flip fast, then a stopwatch.                                                                                                                                                        | —                                                                 |
| 53  | Better opportunities reach investors faster… Investors spend more time investing.                                              | Five lines, calm and confident.                                                                                                                                                                    | —                                                                 |
| 54  | Private capital has trillions of dollars. / What it still doesn't have... / is a HOME)                                         | Slow. On **"HOME"**, Q navigates to **/home**, literally. The pun is the payoff.                                                                                                                   | Public market fact                                                |
| 55  | I'm Q.                                                                                                                         | The aperture, centre.                                                                                                                                                                              | —                                                                 |
| 56  | …you'll wonder... HOW WE EVER DID IT WITHOUT ME.                                                                               | The final line with a grin. Then the hand-over: "Ask me anything", and **Q&A mode** opens (QA bank).                                                                                               | `qa-bank.ts`                                                      |

**Captions:**

- **Karaoke-light:** the current line, with each word going from 55% to 100% opacity as it is spoken (driven by the alignment).
- Bottom centre, 2 lines at most.
- They never cover a lit section; they move above the dock.
- On by default; can be toggled.

**Q presence:**

- Centre stage in Acts 0–3.
- In Acts 4–6 it docks to the side Q is not pointing at and **moves along with the highlight**: a spring, under 300 ms, and never over text.

---

## 4. Controls, interruption, triggers

- **Controls:** pause/resume, back or next beat, "go back two", skip to the product part, captions, mute, end. These are the existing step commands, with no model call.
- **Interruption:** speaking pauses the story. The question goes to the **QA bank** (BM25, microseconds) and is answered in Q's voice. "Carry on" resumes from the beat's start.
- **Triggers:**
  - "present Capital Q", "pitch Capital Q", "tell me your story": the existing `Q_PITCH` destination, story track.
  - The Q Pitch page and the Settings/Profile button.
  - **"What is Capital Q?" alone** gets a two-sentence answer plus "Want me to show you? It takes about seven minutes." A one-line question should not launch a seven-minute film unasked.
- **Length:** 798 words at a deliberate 125–135 wpm, plus the written pauses, comes to about **7 minutes**.

---

## 5. Investor Q&A (separate lane)

- **Research:** every product question an investor would ask: what it does, who it's for, why now, how it differs, data privacy, AI accuracy, how scores are made, what is live versus roadmap, how founders and investors each benefit, pricing hypothesis, GateQ, and so on.
- **Answers:**
  - plain and non-technical, two to four spoken sentences;
  - each cited to the product sources;
  - never inventing traction, customers, revenue or team size;
  - honest about the pre-seed, bootstrapping stage.
- **Delivery:** loaded into `qa-bank.ts`, and given to the owner as a readable list.

---

## 6. Lanes (parallel, tonight)

| Lane                    | Owns                                                                                                                                                                                                                                                                                                                                                                                                                            | Delivers                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **S1 Story engine**     | `packages/q-pitch/src/story/*`:<br>- the beat table with the verbatim test;<br>- the cue timeline on the audio clock;<br>- the pre-render script (ElevenLabs with timestamps; GPT-Live fallback);<br>- the web story host: captions, story-mode scrim, highlight pulse, picture montage, artifact cues, presence motion;<br>- preload and cache;<br>- GateQ direct jumps;<br>- the trigger.<br>Plus the new story-mode visuals. | A runnable story in a real browser, plus a recorded video |
| **S2 Storyboard video** | Design-skills storyboard: key frames per act (light/dark, desktop/mobile) and a captioned walkthrough video recorded in Chromium. Owner review **before** the final polish.                                                                                                                                                                                                                                                     | MP4 plus frames                                           |
| **S3 Investor Q&A**     | Research and answers into `qa-bank.ts`, plus an owner-readable doc                                                                                                                                                                                                                                                                                                                                                              | Q&A list                                                  |

---

## 7. Budget and keys

- **ElevenLabs pre-render:** about 5,000 characters × 2 voice takes, a few dollars at most. Re-rendering happens only when a line or tag changes.
- **Q&A research:** no provider calls (web research by the agent).
- **Hard cap:** $3 (owner allowed $3–5).
- **Keys needed in the environment** (none present at 19:15 UTC):
  - `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY`);
  - `OPENAI_API_KEY` for the GPT-Live fallback.

---

## 8. Conflicts and gaps for owner sign-off

1. **Blueprint §5 "Style" says to avoid cinematic interludes and heavy animation.** The owner now asks for a cinematic story (Acts 0–3).
   - **Proposed revision:** the story acts are allowed as **story mode**, with real product screens from Act 4 on.
   - Animations are compositor-only, with zero CLS and a reduced-motion path.
   - Recorded in the blueprint changelog on approval.
2. **Q Card does not exist** (#48–49).
   - **Options:** (a) build a minimal Q Card view now: the company profile hero plus metrics, raise, InvestIQ and relationships, as one card; (b) show the company profile Overview as "the Q Card", labelled roadmap.
   - **Recommend (a)**, as a read-only composite of existing data.
3. **GateQ score and rank (#44):** the inbox has no score or rank today.
   - **Options:** (a) build the ranking from GateQ's existing qualification plus the InvestIQ/fit scores; (b) show interview → dossier and say ranking is coming.
   - Owner decision. Until then, the visual shows only what exists.
4. **"Investability IQ" vs the product's name.** The landing page says "Investability IQ" and the code says InvestIQ (a naming conflict already logged).
   - The voice says the owner's words.
   - The screen label follows whatever the owner confirms.
5. **"swipe to match with founders, like Tinder":** a swipe right opens Express Interest's confirmation; a match happens when the founder accepts. That is true in substance. The visual shows the confirmation, never auto-sends.
6. **Founder side inside an investor session** (#45–47): the authorised workspace switch (QP-F10) is PLANNED, not built.
   - Acts 5–6 use **Q-stage artifacts** with demo data (labelled), not navigation into a founder workspace.
   - Or the founder track runs the same story from a founder account.
7. **Demo data is labelled** "Demonstration data" wherever fictional companies appear (blueprint §4).
8. **Third-party names (TikTok, Tinder, Jarvis/Iron Man)** are spoken only. No logos or imagery of them.
