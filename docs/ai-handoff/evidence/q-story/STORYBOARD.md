# Q Story premiere — storyboard (S2), 2026-10-21

**For the owner, before the final polish.** This shows how the story premiere will look and move, on the **real app pages**, timed to the beat table in [`Q-STORY-PLAN-2026-10-21.md`](../../../specs/q-pitch/Q-STORY-PLAN-2026-10-21.md) §3. It is a storyboard, not the engine. S1 builds the engine; this page shows S1 and you what it should feel like.

**Review page (films, frames, critique):** https://claude.ai/artifact/5TxN2LBkCV7h5MkncqQSBm (private until shared from its Share menu).

**What you can open:**

| What                                                             | Where                                                                                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Captioned walkthrough, full length (7:55), desktop               | [`q-story-walkthrough-desktop-dark.mp4`](q-story-walkthrough-desktop-dark.mp4)                                                                                    |
| Captioned walkthrough, full length (7:55), phone                 | [`q-story-walkthrough-phone-light.mp4`](q-story-walkthrough-phone-light.mp4)                                                                                      |
| Key frames: 17 moments × desktop 1440 / phone 390 × light / dark | [`storyboard/`](storyboard/), named `NN-actN-<moment>-<desktop\|phone>-<dark\|light>.png`                                                                         |
| Reduced-motion frames (desktop light)                            | `storyboard/*-desktop-light-reduced.png`                                                                                                                          |
| The page that plays it                                           | `/dev/q-story` (dev only; `?t=<seconds>` opens paused at a moment, `?play=1` plays). Source: [`apps/web/app/dev/q-story/`](../../../../apps/web/app/dev/q-story/) |

**How it was made.**

- **Words.** The owner's words come straight from [`Q_STORY_VERBATIM.txt`](../../../specs/q-pitch/story/Q_STORY_VERBATIM.txt). The page's line table is generated from that file. A check confirmed all 158 lines and 796 spoken words match exactly.
- **Clock.** There is no audio yet. The clock gives each word a time from the act's pace in plan §2:
  - words per minute: Act 0 128, Act 1 116, Act 2 126, Act 3 112, Act 4 150, Act 5 132, Act 6 118;
  - the written pauses are real silence (for example 1.2 s after "Then...");
  - every cue is tied to a word and fires 120 ms before it, as the engine will on the audio clock.

  S1 swaps the estimated times for the ElevenLabs alignment, and everything moves with it.

- **Real pages.** Every product beat is a real page: the existing dev harnesses (fictional companies, fixtures), all loaded at once and kept warm, so nothing is fetched mid-story. A gold ring lights the section Q is talking about.
- **Photos.** Pexels, found through the repo's own port (`packages/q-daily`, `createPexelsDailyPhotos`), credited on screen. The files are not committed. Without them every tile shows a neutral "photo" placeholder.
- **No provider calls.** None were made apart from the Pexels search, and no model was called.

**Design skills used and what each drove.**

- **emil-design-eng and animate:**
  - only `transform` and `opacity` move (plus one `clip-path` reveal for the down-round line);
  - entrances use `--cq-ease` at 280–360 ms; exits are faster (200 ms, `--cq-ease-exit`);
  - nothing starts from `scale(0)` (0.94–0.98 at most);
  - staggers are 60 ms for the montage and 40 ms for lists.
- **apple-design:**
  - the table turn is a single horizontal slide, faded while it travels (large surfaces fade in motion);
  - Q's presence moves on a 300 ms critically damped ease with no bounce;
  - no slow looping oscillation: the highlight's breath is 1.8 s, and the down-round chart draws once;
  - night turns into day over 700 ms, never as a jump in brightness.
- **accessibility:**
  - captions sit on an opaque ground over the pages (no glass, no blur);
  - ✕ and ✓ always come with a word ("Wrong stage", "Fits: stage"), never colour alone;
  - controls are 44 px with a visible focus ring;
  - reduced motion is handled (see below).
- **frontend-design:** the boldness is spent in one place, large editorial type for the night (11:47 PM, the two questions, "Same problem."). Everything else stays quiet.
- **Not installed in this repo:** `design-council`, `design:design-critique`, `review-animations` and `improve-animations`. Their part was done as an explicit critique pass on the captured frames (below).

---

## The film, act by act

Timings are from the storyboard clock: total **7:55**.

| Act                | Runs      | Length |
| ------------------ | --------- | ------ |
| 0 Hello            | 0:01–0:10 | 9 s    |
| 1 Investor's night | 0:11–1:30 | 79 s   |
| 2 The founder      | 1:32–4:17 | 165 s  |
| 3 The turn         | 4:18–4:26 | 8 s    |
| 4 For investors    | 4:27–5:43 | 76 s   |
| 5 For businesses   | 5:44–6:29 | 45 s   |
| 6 The close        | 6:30–7:51 | 81 s   |

**Motion specs used throughout** (all `--cq-*` tokens):

| Element                        | Motion                                                                                            | Reduced motion                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| Story mode scrim               | opacity 0 → 0.9, 400 ms `--cq-ease`; deep (1.0) for the silence, 900 ms                           | same (opacity only)              |
| Night ↔ day                    | crossfade of `--cq-night-canvas` and `--cq-canvas`, 700 ms                                        | same                             |
| Large type, rows, tiles, icons | opacity + translateY(10 px) scale(0.98) → none, 360 ms `--cq-ease`; exit 280 ms `--cq-ease-exit`  | opacity only, 200 ms             |
| Highlight (gold ring)          | ring fades in 280 ms; breath scale 1.000 ↔ 1.015, 1.8 s ease-in-out, alternate                    | ring only, no breath             |
| Section navigation in a page   | `scrollIntoView` centre, smooth, only when the section is off-screen                              | instant jump                     |
| Q presence (centre ↔ docked)   | transform, 300 ms `--cq-ease`, no overshoot; docks level with the light, on the side away from it | jumps to the new place           |
| Captions                       | each word 55% → 100% opacity as it is said, 120 ms linear                                         | same (opacity carries no motion) |

### Act 0 — Hello (#1–2)

**Frame:** `00-act0-hello-*`.

- **"Hi."** Q speaks from where its presence lives on **/home**: the real Q page, with the page's own presence replaced by the storyboard's, so there is exactly one Q. Its label says "Speaking". The caption begins.
- **"let"** (in "let me tell you a story", the lean-in): story mode fades in over 400 ms. The page recedes behind an opaque scrim, and the theme deepens to night.
- **Critique changed:** the first cut drew a second, smaller Q over the page's own presence. Two Qs on screen read as a glitch. The storyboard Q now takes the page presence's exact place and size.

### Act 1 — The investor's night (#3–14)

**Frames:** `01-act1-1147-*`, `02-act1-inbox-decks-*`, `03-act1-montage-needle-*`, `04-act1-scale-unknown-*`.

- **"11:47"**
  - Large quiet editorial type: **11:47 PM**.
  - Behind it, a lamp-lit desk photo at 25%.
  - Q docks to the side (300 ms) so the night belongs to the viewer.
- **"You're / Your inbox"** An empty inbox rises: three dashed ghost rows, labelled "Illustrative".
- **"Decks." "Introductions." "Referrals." "Applications."** One row drops in on each word (−14 px → 0, 360 ms), newest on top: `Deck_SeriesA_v9_FINAL.pdf`, "Intro: you two should meet", a referral, a website application.
- **"Opportunity everywhere."** Twelve photo tiles cascade into a 4 × 3 grid (60 ms stagger, scale 0.94 → 1, 420 ms).
- **"investment"** (…might be the investment…)
  - One tile (a port at night) lifts to scale 1.06 with a gold outline.
  - The rest fall to 32%.
  - This is the needle.
- **"But it doesn't announce itself."** The outline goes and the tile sinks back into the grid.
- **"Every deal takes time."** The grid drifts 3% left over 14 s (linear). Calendar blocks stack beside it.
- **"Is this worth the risk? / Do I"** The two questions as large type, one, then the other. The first dims to 12% when the second lands.
- **"Every bad investment" / "great" / "And you just might never know how much"**
  - A scale. The left weight is solid. The right one is a dashed outline with "?".
  - On the third line the beam wobbles once (1.4° → −0.8° → 0, 2.4 s) and can't settle. "Unknown stays unknown" appears under it.
  - Then 1.6 s of silence.
- **"Most times"** The grid returns at 35%.
- **Critique changed:**
  - The first desk photo had two clocks reading **1:00 AM**, which contradicts "11:47". It was replaced by a lamp-lit desk whose laptop reads 11:32.
  - The photo bleed had a frame margin; it now fills the screen.

### Act 2 — The founder (#15–32)

**Frames:** `05-act2-table-turns-founder-*`, `06-act2-down-round-*`, `07-act2-silence-*`, `08-act2-mismatch-chips-*`.

- **"Now, come with me…"** **The table turns:**
  - the whole stage slides in from the right (translateX 14% → 0, 520 ms, faded while moving);
  - night crossfades to day (700 ms).
- **"You've spent years building." / "Put your own money in." / "Survived payroll." / "Won customers."** One photo per phrase, captioned with that phrase.
- **"Go raise."** Large editorial type, tilted −1.5°: the fond chuckle, done visually.
- **"seed" / "Series A"**
  - A round timeline: Seed ● → Series A ●.
  - Each dot fills with the accent and a ✓ (scale 1.15, 280 ms).
- **"bar"**
  - A line lifts above the timeline (translateY 16 → −10 px, 600 ms).
  - Each "Maybe" line then ticks in a short fragment of the owner's own words: "no longer works.", "scrutinized harder.", "growth slowed.", "the market changed.", "the valuation…".
- **"Maybe you're staring at a down round."** A line chart draws left to right (clip-path, 1.4 s), rises, then dips.
- **"Maybe you're trying to cross from Series A to B..."** Series B and C drift right (+120/+180 px) and fade to 40%: capital that "feels much further away".
- **"established" / "expansion" / "market"** Factory, logistics and retail photos, one per phrase.
- **"Different stage." / "Same problem."** Two-beat type; the second is larger.
- **"search." "Pitch." "Fly." "Rewrite." "Follow up."** One icon per verb (search, deck, globe, page, mail), at talking speed.
- **"an investor leans in" / "Hope rises."** A warm field rises from below (gold-soft at 55%, 1.8 s): a colour field, not a glow on any object. An investor bubble reads "Interesting. Send me everything you have." (illustrative).
- **"Then..."** **Everything stops:**
  - the scene clears and the captions fade (360 ms);
  - the scrim goes to full canvas (900 ms);
  - **1.2 s of real silence**.
  - "silence." brings the caption back alone.
- **"You follow up." / "Nothing." / "Again." / "Nothing."**
  - Sent bubbles with "Delivered · 6 days ago", "Delivered · 3 weeks ago".
  - "Seen" never appears.
- **"Sometimes a 'no' almost feels like mercy..."** Stillness: caption only.
- **"Silence keeps you trapped…"**
  - "runway", "momentum" and "opportunity" stand in large type.
  - They fade to 12% one by one, on "quietly", on "disappear", and as the next line starts.
- **"wrong stage." / "Wrong geography." / "Wrong cheque size." / "Wrong thesis."** Four mismatch chips, one per word, each "✕ Wrong <dimension>". They foreshadow the mandate payoff in Act 4.
- **"Or maybe they were right..."** The investor's desk from Act 1 returns at 12% behind the next chips (see the critique: the same night, both sides of the table).
- **"Weak governance." … "Strong traction told badly."** Four readiness chips, dashed outline with a circled "!". They are paid off in Act 5.
- **"So you pitch more."** Stillness.
- **Critique changed:**
  - The caption ground in dark mode was a light pill that glared on the night scenes. In story mode the caption is now type on the scrim; the opaque ground appears only over real pages.

### Act 3 — The turn (#33–34)

**Frame:** `09-act3-capitalq-*`.

- **"There has to be a better way."** A breath.
- **"And"**
  - **The app wakes:** the scrim lifts (400 ms) back to the real Q page.
  - Q moves to centre stage and gives its **COMPLETE "shutter"**, the state's one 240 ms flash.
  - On "is." it is speaking again.
- **"CapitalQ."** The wordmark "Capital Q", 600 weight with −0.03 em tracking, beneath Q.

### Act 4 — For investors (#35–44)

**Frames:** `10-act4-mandate-payoff-*`, `11-act4-gateq-rank-*`.

- **"TikTok"** **Discover**, the real feed card (muted). Q docks to the right. "Demonstration data" shows in the review bar from here until /home.
- **"Jarvis"** Q's presence switches to LISTENING for two words: the "plus Jarvis" wink is Q itself reacting, not a glow on a dock.
- **"the entire investment journey"** The real sidebar lights **one item per word**: Discover → Explore → CRM → Work. These are the app's actual nav items; the plan's list doesn't match the shipped nav (see the critique).
- **"Your thesis." "Stage." "Sectors." "Geography." "Cheque size." "Preferences." "Minimum criteria."**
  - **Investment Hub → Capital → Your mandate**: each word lights its row.
  - Preferences maps to "Business models and customers"; Minimum criteria maps to "Never shown".
  - At the same time the Act 2 mismatch chips return and **flip ✕ → ✓** about the x axis (420 ms) as their dimension is named: "Fits: stage", "Fits: geography", "Fits: cheque size", "Fits: thesis".
  - Q's presence rides beside the light, level with each row, never over it.
- **"Then I configure…"** Back to Discover.
- **"swipe" / "Tiktok"** The feed advances twice, through the page's own "Next company" control.
- **"swipe to match… like Tinder"**
  - **Express interest is lit, never pressed.**
  - A note under the ring says so: a consequential action is only ever shown.
- **"Ask me anything."** Your top three (real page).
- **"Compare businesses."** The side-by-side comparison on the Q page's board.
- **"Interrogate assumptions."** The company profile's Diligence: "Questions to investigate".
- **"Prepare for meetings."** The relationship record's "Open call brief".
- **"Interview" / "decisions"**
  - GateQ's application detail: "Their answers", then the "One-page summary".
  - These are the closest real equivalents of an interview transcript and Q's reading.
- **"there's GateQ."** GateQ: Your gate.
- **"website, application page, social media, accelerator, investment programme"**
  - "Your gate link" is lit.
  - Channel chips tick in, one per noun.
- **Inbox:**
  - "I interview them." lights "Their answers".
  - "Score them." lights the One-page summary, with the note _No score is shown today (plan §8.3)_.
  - "Match them…" lights "Your gate's rules".
  - "Then rank them…" lights **Look at first**, with the note _Ranking by suitability: owner decision (plan §8.3)_.
- **Critique changed:**
  - Chips sat over the page tabs, and the review bar covered page headers. Chips now sit above the captions; the review bar is one compact pill at top right.
  - On a phone only the chip that just changed is shown, because four chips covered the mandate.
  - Q's docked presence first sat bottom-right over the app's own dock and over content. It now follows the light, on the side away from it.

### Act 5 — For businesses (#45–47)

**Frame:** `12-act5-investability-iq-*`.

- **"For businesses"** Story mode returns briefly; Q docks left. **The Act 2 timeline comes back** as five nodes, "your first raise", "your fifth", "a Series B", "a down round", "growth capital", each filling on its word: the callback that closes Act 2's wound.
- **"Investability IQ shows what is ready."**
  - **Fundraising Hub → Readiness** (real page).
  - Team (Strong) is lit.
  - The Act 2 readiness chips return as findings: ✓ What is ready.
- **"What is weak."** Market (Gap) is lit; ⚠ What is weak.
- **"Why it matters."** Legal (Developing) is lit; ⓘ Why it matters.
- **"blocking"** **What could stop your raise** is lit; ⓘ What could be blocking your raise.
- **"Then I help match you with investors"** Fundraising Hub → Investors. "Who should." is the lean-in. The plan's "top card forward" isn't possible on this page today: it is a list, not cards.

### Act 6 — The close (#48–56)

**Frames:** `13-act6-q-card-*`, `14-act6-montage-real-pages-*`, `15-act6-home-*`, `16-act6-grin-*`.

- **"And then... behavior changes."** Story mode.
- **"Send me your deck."** A deck tile, `Deck_v14_final_FINAL_use-this-one.pdf`, under the gruff quote.
- **"What's your Q Card?"**
  - The deck slides away (translateX −130%, −6°, 520 ms).
  - **The real Q Card component** (`features/q-card/q-card.tsx`) flips in about the y axis (−88° → 0, 640 ms).
- **"your story," "your numbers," "your raise," "your intelligence," "your relationships."** Each noun lights its tag under the card. A label is honest: _the card exists; the five linked parts are proposed (plan §8.2)_.
- **"One platform. / Both sides."** A split: Investors (Discover) beside Businesses (Readiness).
- **"Discovery." … "Execution."** **Talking-speed montage** of eight cached captures of real pages, one per word (crossfade 200 ms, scale 0.97 → 1), with the word large beneath it. There is no live navigation, so there is no stutter.
- **"weeks, months and even years..." / "Now take minutes."** Calendar pages (Years, Months, Weeks, Week 1) flip away (rotateX −100°, 110 ms stagger); then a clock and "minutes".
- **"Better opportunities…" through "Investors spend more time investing."** The five lines build as large type. The captions step aside here, because the type _is_ the caption.
- **"Private capital has trillions of dollars." / "What it still doesn't have..."** Slow, large type.
- **"HOME"**
  - The scrim lifts onto **the real /home**.
  - Q takes centre stage where its presence lives.
  - An address pill, **capitalq.app/home**, drops in at the top.
  - In the shipped nav, /home is labelled "Q", not "Home", so the address is what makes the pun land.
- **"I'm Q."** Q at centre.
- **"HOW WE EVER DID IT WITHOUT ME."**
  - On "ME." Q comes to rest on its stage and its particles gather into **the letter Q** (the presence's own `room` figure): the grin.
  - The composer is lit, with _Q&A mode: ask me anything_ beside it, and the story hands over to the Q&A bank.

---

## Reduced motion

`prefers-reduced-motion` removes every keyframe and every transform:

- no slide, drift, flip, wobble, breath or chart draw;
- entrances become 200 ms opacity fades;
- the ring is the ring alone;
- Q jumps to its new place instead of travelling;
- section navigation jumps instead of scrolling.

Captions and their word-by-word opacity stay: they carry meaning and do not move. Evidence: `storyboard/*-desktop-light-reduced.png`.

---

## My critique (S2): where the plan is weak for a busy investor, and what I'd do without changing a word

The words are the owner's and stay verbatim. Everything below is delivery, pacing and visuals.

### 1. The product shows up at 4:28 of 7:55

Acts 0–3 are 56% of the film, and Act 2 alone is 2 min 45 s. A busy investor decides whether to keep watching in the first 60–90 s. They are hearing a founder's pain second-hand, and nothing on screen yet tells them this is a product rather than an essay.

**What I'd do, words unchanged:**

- **A two-second "proof glimpse" under "But before I tell you what I do…".** Three real screens (Discover, mandate, Readiness) flash at 30% behind the scrim, about 0.6 s each. Then the night begins. It promises "there is a product, and it's coming", which buys the story its patience.
- **Act 2 pace.** Lift Act 2 from 126 to about 138 wpm, and paragraph gaps from 420 to about 300 ms. Keep every named silence ("Then...", the "Nothing."s, "you just weren't ready"). That saves about 15–20 s with no word lost. The emotion lives in the silences, not in the gaps between list items.
- **Fewer scene changes in Act 2.** Today there are about 14. The Series A/B/C passage, the established-business photos and the five verbs are three separate visual ideas within 40 s. I'd keep one continuous object, the round timeline, and let it carry "established business" (a fifth node, "growth capital") and the verbs (icons riding along the line). Less to read means more to feel.
- **Make "skip to the product" visible.** The control already exists in the plan (§4). For an investor it should appear as a quiet "Skip to the product →" chip for the first 90 s. If they skip, Q says nothing new; the act just jumps.

### 2. A spoken claim the screen can't show

"Score them. … Then rank them by suitability and investibility" is said over a GateQ inbox that has **no score and no rank** today (plan §8.3). The storyboard labels it honestly. In a premiere, though, a note saying "not built" right after a claim is the most expensive moment in the film. An investor will remember it.

**Recommendation:** decide §8.3 before the premiere. Either:

- **(a)** build the minimal rank: order "Look at first" by existing qualification plus fit, and show the order; or
- **(b)** keep the spoken words, show interview → summary → rules → **Look at first** (which is real triage today), and drop the on-screen note from the premiere. The note stays in the storyboard.

Do not ship a film whose screen contradicts its voice.

### 3. Other mismatches with the shipped app (flag, not redesign)

- **Navigation list.** The plan lights "Discover → Explore → Relationships → Capital → Work → GateQ". The shipped sidebar is **Discover, Explore, Q, CRM, Work**, and GateQ sits inside the Investment Hub tabs. The storyboard lights the real four. S1 should follow the app, not the plan's list.
- **Q's presence is particles, not the ring.** The plan says "aperture shutter flash" (ux-direction §5.1). The shipped Q is the particle presence (PRESENCE spec, `QAperture` renders `QSwarm`). The storyboard uses the shipped one, and its COMPLETE state is the shutter.
- **The Q Card exists** (`features/q-card/q-card.tsx`, BIZ-004). Plan §8.2's "no Q Card exists" is outdated. What doesn't exist is the composite of story, numbers, raise, intelligence and relationships. Option (a) in §8.2 is smaller than it looks: the card stays, and five linked sections hang off it.
- **"Who should." "brings the top card forward"**, but Fundraising Hub → Investors is a list. Either light the top row, or use the founder-side "top three" when it exists.
- **The scrim.** ADR 0017 keeps "the scrim is for video only". Story mode uses an opaque, unblurred scrim over the app. That belongs in the §8.1 sign-off: "story mode may dim the app behind an opaque scrim; no glass, no blur".
- **"Investability IQ".** The screen title today is "Readiness" (in Fundraising Hub). The voice says the owner's words; the on-screen label needs the owner's naming decision (§8.4).

### 4. Smaller things that would make it better

- **#36 on a phone.** Seven highlights in about 4 s, each needing a scroll on a 390 px screen, reads as jumpy. On a phone, light the whole mandate card once and let the chips flip. Keep the per-row light for desktop.
- **The montage (#7).** Twelve stock photos risk "stock-photo wall". I'd use eight, all from the same light (dusk or night), so the needle tile is the only one that stands out on its own.
- **The silence (#26) in a captioned, muted viewing.** 1.2 s of nothing can read as a freeze. The scrim deepening to full canvas is what signals intent. Keep it, and don't shorten it.
- **Length.** At the plan's 125–135 wpm the story is about 7 min of words plus about 1 min of written pauses, so **about 8 min**, not 7. Say "about eight minutes" in the "Want me to show you?" offer, or adopt the Act 2 pacing above (about 7:35).

### 5. Humour and emotion beats added (visual or delivery only)

These are in the storyboard now so you can judge them:

- **The file names.** `Deck_SeriesA_v9_FINAL.pdf` in the investor's inbox (#6). At #48 the deck that leaves is `Deck_v14_final_FINAL_use-this-one.pdf`: five versions later, the founder's deck finally goes away. Both sides of the table recognise it; it's a knowing smile.
- **"Delivered · 3 weeks ago"**, with "Seen" never appearing (#27). Wry, not cruel.
- **"Go raise."** tilted 1.5°, the visual chuckle.
- **The wobbling scale (#13).** The unknown weight can't let the beam settle: "never know how much".
- **The investor's desk returns at 12%** under "Or maybe they were right…" (#30–31). It's the same night: the founder's "not ready" is the investor's missed one. That bridges the two sides before the turn.
- **"Jarvis" makes Q itself react** (LISTENING for two words), rather than any decoration.
- **The ✕ → ✓ flip** on the founder's own mismatch words when the investor's mandate is named (#36). It is the payoff of Act 2's pain, landing in Act 4.
- **The address pill "capitalq.app/home"** on "HOME". The pun needs the address, because the nav says "Q".
- **Q gathers into the letter Q on "WITHOUT ME"**: the grin, in Q's body language rather than a face.
- **Suggested, not built:** at "rise to the top" (#44), the Act 1 needle tile (the lit port photo) floats up beside "Look at first". The needle from the haystack, found. It is the strongest callback in the story, and it costs one image.

---

### 6. The Q Card: make it the hero it's meant to be

Frames `13-act6-q-card-*` show the real component (`apps/web/src/features/q-card/q-card.tsx`) exactly as it ships. In the film, the line "What's your Q Card?" is the moment investors should want one. Today the card can't carry that line. It is an elegant badge: Q mark, "Q Card", the name, a grey descriptor, a rule and the @handle. It does not yet look like "one living private-capital identity with your story, your numbers, your raise, your intelligence, and your relationships". These suggestions stay within the product rules (evidence before opinion; no scores, percentages or fit meters; glow on Q only).

- **Give it two faces.**
  - **Front, identity:**
    - logo and name;
    - one line of story (the company's own short description);
    - sector, stage and HQ as plain words;
    - verification marks (domain, organisation) as small labelled ticks.
  - **Back, the live sheet,** five rows matching the five nouns in the line:
    - **Story:** the one-sentence pitch.
    - **Numbers:** two or three founder metrics, each with its evidence label (Self-reported, Document-supported, Verified).
    - **Raise:** amount, instrument and close date, with "founder-stated" where true.
    - **Intelligence:** readiness in words ("6 of 8 areas strong or developing"), the same sentence Readiness uses. Never a number.
    - **Relationships:** "In conversation with 4 investors" (visible only to the founder; the shared card shows nothing private).

  The flip in the film (#48) then becomes the product's own interaction, not a storyboard effect.

- **Freshness, so "living" is visible:** "Updated 3 days ago" in the corner, and an evidence dot per row. A stale card should look stale.
- **A material, not a glow:** the gold should come from the surface, not from light around it.
  - Keep the one arc of light but make it finer.
  - Add an engraved, guilloché-style line field in `--cq-gold-*` at very low contrast behind the name, like a certificate or a banknote. That is the private-capital vernacular, and it says "this is a document of record".
  - The soft outer glow (`--cq-qcard-glow`) reads as glow on a card, which ADR 0017 reserves for Q. Keep the glow on the Q mark in the corner only.
- **Type with weight:** the name in the editorial face at display size (the same voice as the film's large type), the descriptor in the UI face, and figures in tabular numerals. Today the name and the handle are close in visual weight.
- **Fill the right side:** without a QR the right third is empty. The QR (dark on white, as designed) belongs on the back face. The front's right side can hold the company logo, or the round's status as a stamp-like mark ("Raising · Seed").
- **Share is the point:** a visible "Share Q Card" with copy-link and QR, and the public page `/c/@handle` showing the front face only. The investor's question "What's your Q Card?" needs a one-tap answer.
- **On a phone:** the card should fill the width at the 1.8:1 ratio, with the back face reached by a tap (not hover). The rows stack, with no truncation.

Rough cost: the back face is a read-only composite of data the profile, Readiness and the raise already hold (plan §8.2 option a). The material and type changes are CSS plus two tokens.

## Notes for S1 (engine) and the integration owner

- **Cue table.** Every cue is in [`timeline.ts`](../../../../apps/web/app/dev/q-story/timeline.ts) as `[source line, word index, patch]`. It is a working draft of the word-anchored cue list S1 needs. The word indices were checked against the verbatim text.
- **Section targets** are found by visible text on the real pages (headings, `dt` rows, tabs, buttons), not by new attributes. S1 should use the app's `data-qp-lit` anchors where they exist and add anchors for the mandate rows, the readiness pillars and the GateQ detail sections.
- **Framing for the recording.** The app answers `X-Frame-Options: DENY`. The recording run relaxed that header only for its own same-origin dev documents, inside the test browser. Production headers are untouched. The engine won't need frames: it drives the real router.
- **Photos.** Pexels credits are in [`photos.ts`](../../../../apps/web/app/dev/q-story/photos.ts). The files are not committed.
