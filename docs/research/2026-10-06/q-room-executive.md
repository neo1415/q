# The Q room: executive summary

For the founder, 6 October 2026. The detail and sources are in `q-room-technical.md` in this folder.

## The vision

The Q page becomes the one room where everything in Capital Q happens. You can open, read, decide or create anything by talking to Q, and you never have to go to another page.

- **Q sees what you see.** It sees the whole page, not just the part on screen, and any open window.
- **Q does what you can do.** It can take every action an investor or founder can take, and every one is checked against their permissions.
- **Anything can come to you.** A company, a chat, a data room, a deck or a certificate can appear in the Q room as a card or a document. You read it, page through it, approve it, and it goes away.
- **Q is never silent.** While it works, it says what it is doing, hums, moves its particles, or picks up something you told it earlier.
- **Q makes things.** It can produce designed documents and pitch decks, with your brand, real numbers, images and placeholders you fill by dropping files. You can edit them by voice for as many rounds as you like.

All of this fits our existing foundations. The things you rely on stay unchanged:

- Q still asks before anything consequential.
- An approval covers exactly what you saw.
- A founder's private data never reaches investors.
- Uploaded documents are never edited in place. Q makes a revised copy.

## What research found

1. **Why "open the certificate of incorporation" failed.** Q's "open a document" only looks at documents Q made itself, not files you uploaded, and it navigates away instead of opening in the Q room. The fix is small.
2. **Why Q says "it's on screen" wrongly.** Today Q sees only which page you are on, not what is on it. The fix is a **page manifest**: each page tells Q what it shows, and the server fills in the details only where you are allowed to see them. It is cheaper and safer than screenshots, which is how OpenAI's and Anthropic's computer-use agents see a screen.
3. **The picture model we use was retired by Google** around 2 October. Its successor ("Nano Banana 2 Lite") costs about 3 cents an image. It needs billing switched on for the Gemini key; there is no free tier for images.
4. **The best AI deck makers all "render, look, fix".** Claude's PowerPoint skill, Gamma and recent research systems check the finished page and correct it. Writing a better first draft is not what makes them good. We already have half of this, the layout checker. We add a reviewer that looks at each finished page.
5. **Silence is solved by timing, not by hoping the model talks.** Code decides when Q speaks while it works (0.7 s a tone, 1.5 s "Looking at…", 4 s progress or a remembered thread). OpenAI's own "say something first" feature skips about a third of the time.

## What we build, in order

| Wave                    | What you get                                                                                                                                                                                                                                                                             | Builder-days |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **W0 Fixes**            | Voice stops dropping on stale lines, uploaded documents open, pictures work again, Q never claims something is on screen when it isn't                                                                                                                                                   | 2            |
| **W1 See and do**       | Q sees the whole page and open windows; every action works from the Q room; "open the chat with Tobenna", "open Ledgerline's data room"; smooth cards; "we already have this / should I go ahead / here's what needs you"; calendar connect card, and suggested dates without a calendar | 12.5         |
| **W2 Documents**        | Mention a document and it opens in the Q room: read aloud, summarised, "next page", page citations, download. Web and news as cards; long answers offer a PDF                                                                                                                            | 4.5          |
| **W3 Never silent**     | Working tone, spoken progress, moving particles, remembered small talk (private to you, visible and deletable in Settings)                                                                                                                                                               | 4            |
| **W4 Create**           | Pitch decks and documents through planner, writer, designer, asset finder and reviewer; placeholders with a floating upload button; endless voice edits; Q offers a deck during onboarding                                                                                               | 7.5          |
| **W5 Speed and safety** | Instant-feeling opens, recovery from dropped connections, a weak-network mode, tests against "poisoned" documents                                                                                                                                                                        | 3.5          |

The total is **about 34 builder-days**, or roughly 17 calendar days with two parallel workers. W0 and W1 deliver most of the "god room" feeling, so they go first.

## What it costs to run

The cost is for model and provider fees for a **heavy** user: 60 voice minutes, 300 questions, 15 document reads and 2 decks a month.

| Item                                             | Per user per month                               |
| ------------------------------------------------ | ------------------------------------------------ |
| Voice (the largest cost)                         | $1.50-3.90                                       |
| Q answers, including seeing the page             | $0.30-0.80                                       |
| Spoken progress while working                    | $0.15-0.30                                       |
| Decks and images (about $0.20-0.30 per deck)     | $0.60-1.00                                       |
| Document reading, memory, calendar, stock photos | about $0                                         |
| **Total**                                        | **about $2.60-6.00** (a light user: under $0.75) |

No new servers are needed. We keep our own memory (Mem0 and Zep were rejected because they would send private data to another company), our own deck renderer, and our current voice providers. Plans should cap voice minutes, because voice drives the cost.

## What we need from you

**Decisions:**

1. **The "god room" rule.** Anything you are actively reading or approving stays on screen until you close it. Passive cards still step back after three answers. This amends ADR 0044.
2. **Remembered small talk.** Kept 90 days, private to the person, deletable. Yes or no?
3. **Deck images.** Nano Banana 2 Lite as the default and Pro (about 13 cents) only for cover images, with stock photos (Unsplash, free, credited) preferred over generated ones. Yes or no?

**Keys and accounts:**

1. **Gemini key:** confirm billing is enabled. Pictures will appear on that Google bill, at roughly 15-30 cents per deck.
2. **Unsplash:** a free developer account so we can request a production key (5,000 requests an hour).
3. **Google Calendar:** confirm the OAuth consent screen covers `calendar.events`, so the connect card works.

**Time:** one 20-minute live test after W1 and another after W4.

## What "done" looks like

- **Seeing.** You say "what's on this page?" on any page, with a window open, and Q describes all of it, including below the fold, correctly.
- **Doing and opening.** You say "open the certificate of incorporation" or "open the chat with Tobenna", and it appears in the Q room within a second, without leaving the page.
- **Reading.** You say "read me page 3" or "next page", and Q reads that page, cites it, and offers a download.
- **Approving.** You say "send Priya the update". A card shows exactly what will be sent, and "yes" sends exactly that.
- **No silence.** During a 20-second task you never hear more than 1.5 seconds of silence.
- **Making a deck.** You say "make my pitch deck". In about two minutes a branded deck appears, every number is traceable, and empty spots invite your uploads. "Make slide 3 punchier" works, repeatedly.
- **Weak networks.** On a slow phone network, text answers still arrive and voice falls back gracefully.
- **Safety.** No test, including poisoned documents, makes Q act without approval or show an investor anything a founder kept private.
