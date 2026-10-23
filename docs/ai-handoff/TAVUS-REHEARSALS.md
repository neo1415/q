# Tavus in rehearsals — scoping note (2026-10-23, lane 5)

Owner: Tavus is part of rehearsals. The investor persona should get a face that shows emotion, powered by the Builder plan's expressive replicas.

This is a scoping note only: nothing is built yet, and no Tavus call that spends minutes has been made.

## 1. What already exists and is reused

Rehearsals already have a Tavus video mode: `apps/q-api/src/composition/rehearsal-video.ts`, on top of `packages/integrations/src/tavus`.

| Reused as is                                                                                                                                                                                                                | Where                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| A PAL whose brain is **Q's own rehearsal turn**, through the custom-LLM bridge. The face only says what Q wrote: the same persona, temperament, R5 beats and v12 local greeting.                                            | `rehearsal-video.ts` bridge                       |
| Four stock interviewer faces (Steve, Julia, Raj, Mary), each with a gender. Never a likeness of the real counterpart.                                                                                                       | `REHEARSAL_INTERVIEWERS`                          |
| The persona's **ElevenLabs voice** on the face: Tavus `layers.tts`, `tts_engine: elevenlabs`, a public `external_voice_id`, persona settings, no key sent. Built and tested; off behind `CQ_REHEARSAL_VIDEO_PERSONA_VOICE`. | `tavusTtsLayer` (`persona-voice.ts`)              |
| Spend guards: 180 s rooms (+30 s join grace), the weekly video allowance shared with GateQ, the monthly safeguard, concurrency, key pool, sweep, disclosure.                                                                | `rehearsal-video.ts`, `billing.video_allowance_*` |
| From the meeting face (lane 6): the Phoenix-4 / 4.5 face ids, and a face prompt that asks for expression to follow the words.                                                                                               | `MEETING-FACE-2026-10-21.md`                      |

## 2. Which Tavus models carry emotion

- **Faces:**
  - Phoenix-4 and Phoenix-4.5 express emotion "out of the box", shaped by what is said and by the PAL's `system_prompt`.
  - Phoenix-3 does not.
  - Tavus recommends the 4.5 "Pro" faces for expression.
  - There is no emotion flag.
- **Emotion tags** (`<emotion value=…/>`) are documented for Echo mode only. They are unconfirmed with a custom-LLM stream, so they are not used.
- **Today the rehearsal PAL prompt is flat:** "Speak exactly the lines you are given, naturally, and nothing else." The face therefore has little to express from.
- **Resolved without spend** (Tavus's public stock face model map, `docs.tavus.io/sections/faces/stock-face-model-map.md`, read 2026-10-23; no Tavus key in this sandbox for the API read):
  - Steve `rdd4c86e5e1a`, Raj `re6220ec0195` and Mary `r55e6793f10f` are **Phoenix-4**, with no 4.5 version of those looks.
  - Julia `rd27826c12a6` is **not in the map** (Phoenix-3 or retired), so she moves to "Julia - Casual" on Phoenix-4, `raf6459c9b82`.
  - Phoenix-4.5 "Pro" ids exist for other looks, for example Victor - Office `rb1d65103218` and Rose - Business `rf1bd7e252de`. They are not used until the plan is confirmed to include 4.5.
  - `docs/seed/tavus-20/plan.json` (pitch-video seed, not this lane) still names `rd27826c12a6`.

## 3. Cost against the Builder plan

These are from the public Tavus pricing page on 23 Oct. The page also lists an older, conflicting price set, so confirm them in the account.

| Plan    | Price/month | Included minutes | Overage   | Concurrent |
| ------- | ----------- | ---------------- | --------- | ---------- |
| Builder | $59         | 175              | $0.35/min | 3          |

- **One rehearsal room** is at most 3.5 min (180 s live + 30 s grace). That is about **$1.23** at overage, or about 2% of the monthly minutes.
- **175 minutes is about 50 rehearsal rooms a month**, if nothing else used the plan. Meeting faces (10 min each today) and GateQ use the same minutes, so the existing weekly allowance and monthly safeguard stay the guard. Nothing new is needed for spend.

## 4. How the persona's voice and accent map to Tavus

- **Voice:** the same picker as the audio rehearsal (origin, then place, then gender, from the 232-voice catalog). It goes to Tavus as the public `external_voice_id`, so the Saudi persona's face speaks in the Saudi or Arabic voice, with the local greeting.
  - The model is `eleven_flash_v2_5`, which supports Arabic script. Tavus has not been checked for v4 turbo.
  - Library voices need no account slot.
- **Emotion in the voice:** today the Tavus layer has **static** persona settings. Per-turn tone, which the audio line gets through R5, does not reach Tavus. The face's expression has to carry the emotion, driven by the words and the PAL prompt.
- **Face:** matched by gender only, from the lobby choice or the face's own gender.
  - Faces are stock and never a likeness.
  - Matching a face's look to nationality is **not proposed**: it would mean choosing a face by ethnicity, which is a policy question for the owner, not an engineering default.

## 5. Smallest slice (no code beyond a prompt line and config)

1. **Read-only:** list the system faces and confirm the four interviewers are Phoenix-4 or 4.5. If they're not, switch to 4.5 "Pro" ids of the same gender (config, `REHEARSAL_INTERVIEWERS`).
2. **PAL prompt:** reuse lane 6's expression rule. Speak the given line exactly, and let face and tone follow its feeling: warm when it's warm, sceptical on a pushback, never more than the words carry.
3. **Flag:** set `CQ_REHEARSAL_VIDEO_PERSONA_VOICE=on` (already built and tested).
4. **One paid test room** with your go: about 3.5 min, about $1.23, for example the QInvest persona. Evidence is a recording, plus the expression and voice as heard.

**Not in the slice:**

- Echo-mode emotion tags (unconfirmed);
- Raven perception (camera analysis, a consent question);
- per-turn voice tone on Tavus;
- longer rooms.

## Live test (owner-approved, 23 Oct, production adbbbe2ef)

Two rooms, founder.souqsheet × QInvest, interviewer Steve (`rdd4c86e5e1a`, Phoenix-4). Script: `scripts/handoff/live/rehearsal-video-room.mjs`.

| Room | Rehearsal  | PAL            | Live → ended        | Seconds counted | Outcome                                                                                                                                   |
| ---- | ---------- | -------------- | ------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `1dd0d05e` | `pb3ad83bcb2c` | 13:40:35 → 13:41:28 | 58              | Opened and ended cleanly. The headless browser sat on Daily's "Enter your name" prompt and never joined, so **no evidence**. Script fixed |
| 2    | `5991975b` | `p0b233ecff9d` | 13:58:41 → 14:00:15 | 100             | Joined. 90 s recorded: 3 tracks (2 video, 1 audio)                                                                                        |

- **Total:** 158 s, about 2.6 Builder minutes, about $0.92 at the $0.35/min overage (or 2.6 of the 175 included minutes).
- **Room ready:** in 6.3 s for room 2 (16.5 s for room 1).
- **What room 2 showed:**
  - **Tile and disclosure:** the tile reads "QInvest LLC Q rehearsal". The banner reads "This is an AI rehearsal informed by public sources. It is not the real person and does not predict what they would say."
  - **Speech:** speech-to-text of the recording hears "Not the real QInvest LLC. **Assalamu alaikum.** Thanks for making the time. A quick note first: this is an AI rehearsal informed by public sources, not the real person. To begin, tell me about Souqsheet, and in particular, the exact financing structure on the table and whether it is Sharia compliant…". The first word comes at 0.5 s.
  - **Face:** lip-synced, and attentive and composed through the opening, which is a neutral question. Stronger expression would need a pushback turn, which wasn't recorded (the room had no founder speech).
  - **Voice:** whether Tavus used the persona's ElevenLabs voice (Helal) or its stock voice can't be told from speech-to-text. Compare `opening-audio.mp3` here with `../rehearsal-voices-2026-10-23/qinvest-live-opening.mp3` by ear, or read the PAL's `layers.tts` with the Builder key (`GET /v2/pals/p0b233ecff9d`, read-only).
- **Evidence:** `evidence/tavus-rehearsal-2026-10-23/`, holding `room-joined.png`, `frame-3/8/20.jpg`, `opening-audio.mp3` (first 30 s) and `room.json`. The full 22 MB recording is kept out of git.

### Room 3 (owner "go", 14:15 UTC): a pushback turn, attempted

- **Room:** rehearsal `3d094c3e`, PAL `p25ac0f8b98f`, live 14:15:18 → 14:17:05, **112 s** counted. Ready in 6.6 s.
- **Setup:** the "founder" was a fake microphone (`FAKE_MIC`, Chromium `--use-file-for-fake-audio-capture`): 28 s of silence, then an evasive answer ("…I'd rather not get into Sharia details. Can we just talk about the valuation?").
- **Result:** the face again said the opening ("As-salamu alaykum. Thanks for making the time…", per speech-to-text). **The founder's line never reached the rehearsal**: it holds only the opening turn, so there was no pushback and no reaction to see. Not established whether Chromium didn't play the file or Tavus didn't take it (it may have come while the face was still speaking).
- **Spend so far (3 rooms):** 270 s, about 4.5 Builder minutes, about $1.58 at overage.
- **Still open:**
  - Expression on a pushback.
  - Persona voice vs stock voice (compare by ear, or `GET /v2/pals/<id>` with the Builder key).
- **Next attempt** (needs a go):
  - Start the founder line later (about 45 s), after the opening has been spoken.
  - Check that Daily's mic is live before speaking, or speak through the Tavus interactions channel.
