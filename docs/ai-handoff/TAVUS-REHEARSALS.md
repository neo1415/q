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
- **Unknown:** which Phoenix version the four interviewer faces (`rdd4c86e5e1a`, `rd27826c12a6`, `re6220ec0195`, `r55e6793f10f`) are on. A read-only `GET /v2/faces?face_type=system&verbose=true` answers it at no minute cost.

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
