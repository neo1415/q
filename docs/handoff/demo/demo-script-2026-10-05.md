# Live demo script: Monday 2026-10-05 (10 to 12 minutes)

Production web: https://capital-qweb-production.up.railway.app (build 93244353
at the time of writing; the demo-44 fixes are on `build/demo-44` and are not
deployed yet).

This is a script for what is live. It is not a staged story. Where something
is flaky or unfinished, the script says so and gives a fallback. Checked on
2026-10-03 at phone width (390 x 844) on both demo accounts. The screenshots
are in the QA scratchpad under `demo44/`.

## Accounts and devices

| Role     | Account (fictional)     | Person and organisation                                                              |
| -------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Investor | `investor.savanna-seed` | Amara Diallo-Benson, Savanna Seed Partners (venture fund; Seed, USD 250k–1M, Africa) |
| Founder  | `founder.ajopot`        | Temitope Alade, Ajopot (Lagos; Seed; raising NGN 1.2bn on a SAFE)                    |

Use only these two accounts. Every company, investor and person on screen
is fictional except **Zino Aviation**, a real account (see "Known rough
edges"). Never sign in as Zino or Nixo during the demo.

- **Laptop** (Chrome, microphone allowed): the Q page, voice, standing
  instruction, approvals, relationships, Usage, the practice pitch.
- **Phone** (signed in as the investor): **pitch video playback** in
  Discover. Some desktop browsers show "This pitch can't play in this
  browser". On the phone it plays muted, inline, with an explicit Play.
- Sign the founder in on a second browser profile, or in a private window,
  so you can switch sides without signing out.

## Before the audience arrives (10 minutes)

1. **Clear old approvals on the investor.** Notifications (bell) → Needs you
   holds several "5 things need your yes for 'Find new founders…'" and
   "Monitor new founders…" batches left by QA runs. **Decline** them, or
   leave them. Never approve a stale card: it would express interest for
   real. Q's work (More → Settings, or `/work`) should show earlier
   instructions as Stopped. Stop any that still say Running.
2. **Pick the standing-instruction exclusion.** Savanna already has
   interest in Kazikit and is in diligence with Ajopot. The "except X" line
   reads best with a company that is in the feed now. Clinicrest is first in
   Savanna's Discover feed, so "except Clinicrest" shows the exclusion
   working.
3. **Share the deck.** As Ajopot: More → Documents → the pitch deck →
   **Who can download it** → **Investors who can find us**. Without this,
   the investor's profile view says "Pitch deck: Not shared with you". That
   is correct behaviour, but it is not the moment you want.
4. **Check the Savanna ↔ Ajopot chat.** It holds QA test messages ("aaaa…",
   "QA double-send 1") and a document request called "QA sweep: cap table".
   You cannot delete them. Do not open that chat on screen. Use Ledgerfold
   (Connected) for any messaging moment.
5. Open Settings → Usage on both accounts once, so the numbers are warm.

## Running order

| Time        | Side     | Beat                                                                  |
| ----------- | -------- | --------------------------------------------------------------------- |
| 0:00–0:45   | —        | What Capital Q is (one sentence) and the two accounts                 |
| 0:45–2:30   | Investor | Q page: presence, typed and voice parity                              |
| 2:30–4:30   | Investor | Standing instruction with "except", then approval cards               |
| 4:30–6:00   | Investor | Discover on the phone, company profile, deck download                 |
| 6:00–8:00   | Investor | Relationship stages, post-meeting journey, pass with a private reason |
| 8:00–10:00  | Founder  | Interest arrives, capital view, practice pitch                        |
| 10:00–11:00 | Both     | Usage and cost                                                        |
| 11:00–12:00 | —        | Close, questions                                                      |

---

## 1. Open (0:00–0:45)

Say: "Capital Q is an investment intelligence system for private capital.
One Q works for each side. It prepares, you approve, then it acts. Ranking
can't be bought, and founder-private data stays behind a firewall."

## 2. Investor: the Q page (0:45–2:30)

Laptop, signed in as Savanna. Q is the centre tab (bottom navigation on a
phone, sidebar on desktop).

**What appears.** The Q stage says "Ready when you are", with a
**Talk with Q** button and "Welcome back, Amara.", then "Here's what changed
this week" (for example "You're connected with Ledgerfold") and a composer
reading "Message Q".

**Typed.** Type into Message Q:

> What's new in my feed this week, and which one fits my mandate best?

Expected: a streamed reply in the thread. Companies show as collapsed chips
under the reply; tapping one expands it in place. Sources sit under the
reply. Q separates declared facts from its own inference, and says
"unknown" where nothing is on record.

**Voice, same question.** Press **Talk with Q**, allow the microphone, and
ask the same thing aloud. Expected: Q answers by voice, and the same answer
lands in the thread as text. Voice and typed go through the same actions
and the same approval rules. That is the parity to point out. The dock
shows a mic-live indicator while voice is open. **End voice** stops it.

**Fallback.** If voice does not start within about 5 seconds (microphone
permission, or a network hiccup), say "voice uses the same engine; let me
type it" and carry on typed. Do not retry voice more than once on stage.

## 3. Investor: standing instruction and approval cards (2:30–4:30)

Type (or say):

> Watch for founders matching my mandate and prepare intros for me every weekend, except Clinicrest.

**What should appear.**

1. Q restates the instruction and shows **one approval card for the plan
   itself**: what it will do, when, a monthly budget (USD 5.00 per
   instruction), and **"Never: Clinicrest."** Q has done nothing yet.
2. Press **Approve** on that card. This approves only the plan. Each intro
   still asks. Automatic execution is switched off in production
   (`CQ_INSTRUCTIONS_AUTO` is off), so every step comes back as a card.
3. Shortly after, the dock shows **Approval needed** and Notifications →
   Needs you shows "N things need your yes for 'Watch for founders…'". Each
   card names its company and what will be sent, for example "Express
   interest in Maji Loop so the company is notified and a potential
   introduction can begin." No card is for Clinicrest.
4. Approve **one** card on screen. Decline the rest (or leave them). Say:
   "Approval binds to the exact payload. If I changed the words, it would
   ask again."

You can also approve by typing "yes, approve the intro to <company>". A
typed yes only decides a card when it names the counterpart, or when the
card belongs to the same conversation.

**Fallback.** If no step cards arrive within about 30 seconds, open
`/work` (Q's work). The instruction is listed with its budget and a
**Stop** control. Say "it runs on its schedule; here is the plan and its
budget", then move on. If Q replies without a plan card, rephrase once:
"Make that a standing instruction."

After the demo, stop the instruction from `/work`.

## 4. Investor: Discover and the company profile (4:30–6:00)

**Phone.** Discover tab. A full-screen pitch opens with a right-hand rail:
**Save · Pass · Interest · Ask Q · Share**. Press Play. Video bytes go
straight from the CDN to the phone. Pass is neutral, not red.

Say: "The order comes from my declared mandate, through a versioned,
deterministic ranking. No one can pay to be higher. Viewing a pitch is not
interest. Interest is a separate, server-confirmed step."

Tap **More** on the card, or open the company, to reach the **profile**:

- **Overview**: stage, raise, founded date, where, team; "In their words";
  "The raise". Anything not shared reads **"Not shared with you"**, never a
  zero.
- **What is known, and how well supported**: each fact shows who stated it
  (self-reported, document-supported and so on) and its sources. Use this
  to show evidence before opinion. Unknown stays unknown.
- **Videos** tab: every video this investor may play.
- **Download pitch deck** appears under Pass / Your relationship once the
  founder has chosen "Investors who can find us" (pre-demo step 3). It
  downloads through a short-lived link issued for this investor. A deck that has not been virus-scanned yet says
  so beside the button.

**Fallback.** If the pitch says "This pitch can't play in this browser",
switch to the phone, or use the profile's Videos tab. If the deck button is
missing, say "the founder decides who can download it; it's off by
default", then show the founder's Documents setting in section 6.

## 5. Investor: relationship stages and the post-meeting journey (6:00–8:00)

Relationships tab. Savanna's three relationships show the stages in one
list: **Kazikit: Awaiting reply** (interest expressed), **Ledgerfold:
Connected**, **Ajopot: In diligence**.

Say: "Each company–investor pair has exactly one shared record. Discover,
Q and this page all point at the same row. Its stage is computed from an
append-only event history, not typed in by anyone, and not decided by a
model."

1. **Ledgerfold (Connected)**: the Next card offers **Book a call** and
   **Send a message**. "What happened" lists each event and who can see it
   ("Only your side can see this" or "Shared with Ledgerfold").
2. **After a meeting**: once a booked call has ended, Next leads with
   **"How did the call go? Record what was agreed."** and four choices:
   _Diligence starts · We'll meet again · Materials asked for ·
   Introductions next_. One press records it on the shared record. Q asks
   the same question in conversation.
   _Real state:_ no Savanna call has ended yet, so this card will not show
   live unless you book and finish a call first. Describe it, or show it on
   Ajopot below.
3. **Ajopot (In diligence)**: the **Diligence** area shows shared
   documents and **Ask for a document**. Avoid the existing "QA sweep" request
   line.
4. **Pass with a private reason**: Next → More → **Not proceeding for now**.
   The dialog says the company is told you've decided not to proceed. The
   **reason is optional and stays private to your organisation** unless you
   tick **Share this reason with the founder**. Cancel, or confirm on
   Ledgerfold if you are willing to change that record. **Reconsider** brings
   it back. Pause and Resume work the same way.

**Fallback.** If a dialog fails to save, it shows the error inline and
nothing changes. Say so and move on. Never retry a pass twice in a row: it
is idempotent per opening, but on stage it reads badly.

## 6. Founder: interest, capital and the practice pitch (8:00–10:00)

Switch to the Ajopot window.

1. **Notifications → Needs you**: "Savanna Seed Partners is interested in
   Ajopot. Interest is not a commitment to invest. Accept to start talking,
   or decline." If you approved an intro card in section 3 for another
   company, that company sees the same notice, not Ajopot.
2. **Capital tab**: "Your raise: NGN 1,200,000,000, SAFE, Seed"; Confirmed
   and Soft amounts (NGN 0, never invented); "In conversation 3"; the
   relationship list with each stage and its next step. Chips such as
   **What's missing?** ask Q. Use one only if time allows.
3. **Deck audience** (if not done before): More → Documents → **Who can
   download it** → _Only my organisation_ or _Investors who can find us_.
4. **Practice pitch**: More → **Rehearsals**. "Pick someone you're meeting
   and rehearse the call. Q plays them by voice, from what you can see of
   them, then reviews how it went." Choose **Ventures Platform** (connected)
   and start. Answer one or two questions aloud, for example "We digitise
   ajo savings circles for gig workers in Lagos; funds sit with a licensed
   partner bank." End the meeting. The review gives a score out of 100 (earlier
   runs: 40 and 46) with specific gaps. The plan line reads "24 rehearsals
   left this month on your Launch plan".

Say: "The rehearsal persona only uses what the founder can see of that
investor. Q never brings in the investor's private mandate."

**Fallback.** If the rehearsal does not start, open the History list on
the same page. It shows the earlier rehearsals with scores and dates.
Rehearsals need a microphone; on a phone, allow it when asked.

## 7. Both: usage and cost (10:00–11:00)

More → Settings → **Usage**.

What appears (2026-10-03 figures; they will have grown):

- Founder: "This month: Q used about $0.79 for you. October 2026, 1373
  model calls, 385 failed calls, not charged." It is broken down into
  Conversations with Q / Other / Pitch rehearsals, followed by plan allowances
  (The Q Daily, Q handles it, Rehearsals).
- Investor: about $0.58, plus a **Standing instructions** section where
  each instruction has its own monthly budget ("less than $0.01 of $5.00").
  When a budget is used up, Q pauses and asks.

Say: "This is what Q cost to run, shown so people can see it. People are
not billed by it. Failed calls are never charged." The failed-call count
is real (QA load and provider fallbacks). If asked, say exactly that.

## 8. Close (11:00–12:00)

"Q prepares, you approve, then it acts. Ranking that can't be bought, one
shared record per relationship, evidence before opinion, and founder-private
data behind a firewall."

---

## Known rough edges (tell the presenter; do not hide them)

- **Real account in the founder's Discover.** Ajopot's Discover →
  Investors lists **Zino Aviation** (a real account) first. Scroll past it,
  and do not open it on screen.
- **Unrelated "Q found something new about Ajopot" notices.** The founder's
  notifications include web items that have nothing to do with Ajopot (one
  in Albanian; one about "the internet's most beloved dogs"). Do not open
  Updates on the founder side.
- **QA residue.** The Savanna ↔ Ajopot chat and diligence request hold QA
  strings. Repeated "5 things need your yes" batches sit on Savanna until
  they are declined (pre-demo step 1).
- **Duplicate instruction history.** `/work` and Usage list several earlier
  copies of "Find new founders…" and "Monitor new founders…". They are
  Stopped. Explain them as earlier test runs if anyone sees them.
- **Desktop pitch playback.** Some desktop browsers cannot decode the
  pitch stream. Use the phone.
- **The dock on a phone chat.** In production, at phone width, the dock
  pill can sit over the chat composer's Send. This is fixed on
  `build/demo-44` and not deployed. Drag the dock up, or long-press → Move,
  if it happens.
- **Q page presence.** Q currently renders as a particle-field presence,
  not the aperture described in ADR 0017. Do not describe it as the final
  mark.
