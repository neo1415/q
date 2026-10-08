# Session handoff, 8 October 2026 (11:20 UTC)

The founder ("Zino") asked for a fresh session to take over **every complaint, including those the previous session believed it had solved**. Treat every item below as **open until you verify it live yourself**: in production, as the right user, from logs, the database or a real browser. The founder's repeated feedback is that the previous session declared things done from unit tests and local builds while the live product still failed. Don't repeat that.

Read `CLAUDE.md` first. Deploy branch: push HEAD to `recovery/2026-09-12`, `recovery/2026-09-12-8y2j4w` and `claude/rana-account-setup-8esh9e`. Railway deploys web, api, q-api and workers.

## How to look at the live system (read-only)

- **Database reads:** `node scripts/handoff/live/hosted-read.mjs "select …"`. This goes through the Supabase Management API; direct port 5432 is blocked from the VM.
- **Hosted migrations:** `node scripts/handoff/hosted-migrate-https.mjs --apply <versions>`. Currently 176 applied, none missing.
- **Logs:** run `export RAILWAY_API_TOKEN=$RAILWAY_TOKEN; unset RAILWAY_TOKEN; railway link -p Q -e production; railway logs --service @capital-q/q-api`, then grep. Railway only keeps the current deployment's recent lines, so grab them soon after a test.
- **Voice calls:** both sides are stored in `q_runtime.voice_line_turns` (role, routed = ask_q, smalltalk or model_only, content, spoken_at). This is new since 8 Oct.
- **Typed and Q turns:** `q_runtime.conversation_messages` (content, result_blocks).
- **Standing instructions:** `q_runtime.standing_instructions` and `instruction_steps`. Drafts are in `q_runtime.workforce_drafts` and `workforce_draft_outcomes`. Chat is `communication.messages`.
- **Live browser as a user:**
  - Scripts live in the previous session's scratchpad; recreate them if it is gone: `live-shoot.mjs`, `cards-live.mjs`, `ask-live.mjs`, and `el/probe.mjs` (the video audio probe). It also holds a real Chrome build, at `chromedl/x/opt/google/chrome/chrome`.
  - Sign in by magic link: fetch the service key from the management API using `SUPABASE_ACCESS_TOKEN` (project `vcohxiqsmnkzxnvawgri`), keep it in memory only, call `generate_link`, then `verify`, then set the cookie `sb-<ref>-auth-token`.
- **Accounts:**
  - Zino (investor) is `adedaniel502@gmail.com`.
  - Seeded founders are listed in `docs/seed/tavus-20/LOGINS.md`.
  - Real-company test accounts are in `docs/seed/real-companies/LOGINS.md`. All 10 real companies were claimed and approved on 8 Oct.
  - The shared password is the env var `CQ_SEED_ACCOUNT_PASSWORD`. The founder has explicitly asked to be given it when he asks.
- **Rules:** tests make no live provider calls (keys `disabled-locally-000000000000`). Live calls are allowed only to verify, and kept small; the founder pays. Never use ElevenLabs for Tavus.

## Builders still running when this was written

Update at 11:25 UTC: `build/founder-agents` round 3 is **finished** (SHA `ee304b16`, not merged). It recalibrates the reviewer for replies (v3), sets the rewriter to v3, checks every rewrite in code, turns a near miss into a card for Daniel, and treats "connecting" as a meeting ask. `build/verify-nudge` is **finished** (SHA `e3da99b5`, not merged). Merge both, deploy, kick 4fe0050f, and verify as Marcus and Bumpa.


Each pushes to its own branch. Merge them, check them, deploy, then verify live:

| Branch | What it builds |
|---|---|
| `build/founder-agents` (round 3) | Reviewer recalibration for replies; keep the best draft that passes code checks; if the reviewer still holds, send it to the founder as a card |
| `build/dataroom-access` (**finished**, SHA `5405c436`, not merged) | Data room locked until the relationship is connected ("express interest to request access"); requests from unconnected investors refused on the server; the share picker lists only connected investors; the Diligence tab shows a question request as answered. Has migration `20261220160000` plus pgTAP 889 (renumber: 889 is already taken by `voice_line_turns`) and edits to suites 800, 886 and 130. The pgTAP tests have not been run; run them on the local Supabase before applying the migration to the hosted database. |
| `build/deal-close` | Post-meeting deal journey: pass, diligence, soft commit, terms, signed, funds, closed; reports at every stage, audit-grade |
| `build/verify-nudge` | Members of a verified company are not nagged to verify (e.g. Marcus at Tensorgate); a founder's own company page says "Add your raise", not "Not shared with you"; the back link and the verify pill |

## Complaints: all of them, with evidence and current status

### A. Q's voice conversation (top priority, raised about six times)

1. **"Q doesn't know anything" / "can't open files" / talks around the task.**
   - Root cause found on 8 Oct: the realtime voice model answered on its own and called ask_q only once per call.
   - Fixed in `build/voice-brain`, deployed in `7c6c083a`: server-side routing, `create_response` off, and every substantive turn goes to ask_q.
   - **Latest live call (11:13 UTC, as Marcus at Tensorgate) still failed:**
     - The voice opener was the model's own: "Welcome back, Marcus. What would you like to work on today?" It did not use the arrival briefing.
     - The user's speech was transcribed as "Fidiani inanituma attention", probably "find anything that needs my attention".
     - The routing worked (`routed=ask_q`), but Q classified it `UNCLEAR_TRANSCRIPT` and asked a clarifying question.
   - **To do:**
     - (a) Improve input transcription. Check the realtime transcription model and language setting; give it a prompt or bias with the vocabulary of the page, cards and names; consider a better transcription model.
     - (b) When the transcript is unclear, guess from context (open cards, briefing, page) and answer the likely intent, and only ask when truly ambiguous.
     - (c) The voice opener must be the briefing (time-of-day greeting, a rundown of what the agents did, the decisions waiting), not a generic question.
   - Verify with a real call, then read `voice_line_turns`.
2. **Sounds robotic, uses templates, takes shortcuts** ("asked for 3, named 2"; ties said as "then").
   - Spoken-facts layer built (`packages/q-core/src/speech/spoken-facts.ts`, `SPOKEN_REPLY`). Typed answers were made natural in `build/briefing`.
   - Not verified on a real call.
3. **Asks questions it already knows the answer to; "are you ready? sound good?" stalls; no strategy content and no cards for strategy.**
   - Instructions changed and an audit log line added, `duplex user turn routed` plus warnings.
   - Must be verified live with "give me a fundraising strategy" as a founder: real content plus cards.
4. **Cards not appearing on voice.**
   - A per-person room feed was built (`/v1/q/room`) and cards render when typed (checked live).
   - On voice, not verified by the founder.
5. **Humming / progress lines while working.** Silence ladder wired on duplex. Not confirmed on a real call.
6. **Voice cuts mid-sentence.** Interrupts are now managed by the browser (450 ms of real speech). Not confirmed.
7. **Navigation:** "take me to the explore page" was going to Discover; a name table was added. Verify all pages by voice.
8. **Q persistent across navigation.** Fixed in `build/q-presence-room`; deployed.

### B. Arrival briefing and decisions

9. **Login briefing.**
   - Asked for: greet by the founder's timezone, give the rundown, bring the waiting items as cards, handle them by voice ("send it", "change…", "skip", "talk about something else").
   - Built and deployed; checked typed on /home ("Good morning. I sent four messages…").
   - The voice line's opener does not use it (see A1c).
   - The greeting omitted the name for Zino.
10. **Cards beside Q**, a summary of all cards, and commands in any words. Deployed (`build/q-presence-room`). Not verified live by voice.
11. **Held messages:** "Q's reviewer couldn't check it…" with no way to approve. Send as is, Edit & send and Ask Q to try again were added, and stale holds are retried at start. Verify on Zino's Spheros hold.

### C. Agents (standing instructions)

12. **Tensorgate's agent never replies to Zino.** Zino's message has been unanswered since 7 Oct 15:43 in conversation `08b5cf9f-f4d5-4b63-8249-fbdc3727fb90`; instruction `4fe0050f-51c1-430a-8343-6ec56fc8dae7`.
    - Latest kick, 11:00 UTC 8 Oct: draft 1 was a good reply but was refused BELOW_THE_BAR. Draft 2 re-asked "open to connecting?" and was held THREAD_MISMATCH. Nothing was sent.
    - `build/founder-agents` round 3 is in progress.
    - Kick script: `scripts/handoff/live/kick-instruction.mjs`. It needs `SB_URL`, `SB_KEY` (service), `SB_PUBLISHABLE`, `OWNER_EMAIL` and `INSTRUCTION_ID`.
13. **Zino's agents idle, and drafts ignoring what founders said.** The Team map shows real work now, and a thread-consistency check plus reviewer thread were deployed. Verify that Zino's delegated instruction `981d50c6-…` actually replies to Ledgerline, Clearwater, Tensorgate and Shiftwell.
14. **Messages too direct / don't woo.** New writing prompts and checks deployed. Read actual sent messages to verify.
15. **Work page confusing** (endless drafts). Redesigned into a decision queue and deployed; the founder hasn't confirmed.

### D. Video and media

16. **Discover/Explore videos load with "slow connection", don't preload, loops reload, Explore muted, different player.**
    - Fixed and **verified live with real Chrome on 8 Oct**: audio decoded, next 2 buffered, unmuted, shared player. Cause was the hls.js light build plus the cache ignoring 0–0 byte ranges.
    - The founder still has to confirm on his machine.
17. **Captions duplicated.** Fixed by turning off hls.js subtitle rendering (commit "Pitch player: hls.js no longer adds…"); deployed. Verify live.
18. **Pitch transcripts unused** ("raise not shared" when the video says it). The reader was built (ADR 0063, computed on read). Verify Tensorgate's Overview shows "$4M seed · Said in their pitch, 0:43".

### E. Founder side

19. **Data-room requests:** the founder had nowhere to upload, and notifications didn't link to it. Requests inbox, Documents tabs, a permission editor and answering assumption questions were deployed. Not verified live as a founder.
20. **Capital page:** split into tabs, verified live.
21. **Pitch deck quality.** Redesigned and composer fixed; images in `docs/design/2026-10-08/deck-quality/after/`.
    - Not yet verified that a **newly generated** deck on production looks like those images.
    - Generate one as Tobenna (`scripts` in the scratchpad `deck.mjs`) and render it.
22. **Verification nag for members of verified companies; owner-view wording.** `build/verify-nudge`, in progress.

### F. Investor side, deals and real companies

23. **Closing deals after meetings, plus reports at every stage.** `build/deal-close`, in progress.
24. **Real companies:** test accounts created and all 10 claimed and approved on 8 Oct. Unclaimed profiles are not in Discover by design. Verify the investor test accounts (FFA, Partech, TLcom) see claimed real companies once they are marketplace-ready.
25. **Search for seeded companies.** Improved in `build/claim-flow`; deployed. Verify.

### G. Promises scorecard

26. The founder wants to overdeliver on every marketing promise Q.01–Q.08. The audit is `docs/strategy/q-promises-2026-10-07.md`. The previous session's self-scores were roughly 7.6/10 but unverified; re-score from live evidence.

## Working agreement the founder expects

- **Prove it live:** don't say "done" until you've seen it live as the right user. Show screenshots or log evidence.
- **Root causes:** read the logs and transcripts before fixing, and fix the root cause.
- **Research first:** research before redesigning, and design screens before building them.
- **Writing for the founder:** be honest and short in chat, and give him the logins he asks for.
