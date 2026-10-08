# Q sees and responds: rehearsals and Google Meet (2026-10-08)

Branch `build/see-and-respond`. This answers the founder's question: "In rehearsals, can Q see my camera and my screen? In Google meetings, can Q respond immediately and also see the camera and my screen?"

## 1. Rehearsals (in the app)

**Already working before today (checked in the code):**

- **Camera.** `getUserMedia` (640x360) feeds the self-view. Q sees you only after you press **Let Q see you**, on the tile or in the control bar. Seeing is a separate consent from having the camera on. While it is on, the tile says "<name> can see you". Pressing it again stops the frames and makes the server forget the held frame immediately.
- **Frames.** Each frame is a 512px JPEG. One is sent with each of your turns, and one every 30 s between turns. The server keeps the latest frame in memory for 30 s, never on disk and never in logs.
- **Screen.** `getDisplayMedia` sends a frame (up to 1280px JPEG, at most 470 KB) only when the screen changes, plus one every 20 s. The banner reads "You're presenting · <name> can see your screen". **Stop presenting**, or the browser's own stop button, clears the frame on the server immediately.
- **How Q uses the frames.** Each turn sends the frames through the Model Gateway on the VISION route (`requiredCapabilities: ["VISION"]`, CONFIDENTIAL). The played person reacts in character. Presence readings (such as "looking down at notes") and per-slide screen notes (P5) go into your private review.
- **Privacy.** Rehearsals are founder-private. Frames are never stored, and only text notes reach the review.
- **Failures and accessibility.** If camera permission is denied, a notice appears and the rehearsal continues. Cancelling the screen picker does nothing. Screen sharing is offered only on browsers that have `getDisplayMedia`. Nothing here autoplays, so reduced motion is not affected.

**Added today:** a vision budget. Frames go with at most **60 turns per rehearsal** (`VISION_TURNS_PER_REHEARSAL`). After that, turns are text-only, so a runaway session cannot keep paying for vision calls. This is tested with fake frames in `apps/q-api/test/rehearsals.test.ts`.

**Logs.** The q-api log line `rehearsal views` records whether a camera or screen frame went with a turn (`camera`, `cameraAgeMs`, `screen`), never the image itself. Today's retained logs start at the 03:20 UTC container start and contain no rehearsal turns, so the live check is in section 3.

## 2. Google Meet (Recall bot)

### 2a. Respond immediately

**Before.** No live calls were left in the retained logs, so this is estimated from the code and P4's "answers ~4 s":

| Step                                                            | Time       |
| --------------------------------------------------------------- | ---------- |
| Final transcript arrives after you stop (Recall streaming)      | ~0.5–1.0 s |
| Answer composed (`NORMAL_DIALOGUE`, 3 etiquette DB reads first) | ~1.5–2.5 s |
| Answer held until 1.2 s of quiet after the final line arrived   | 0–1.2 s    |
| First sentence synthesised (ElevenLabs turbo)                   | ~0.3–0.6 s |
| Recall `output_audio` starts playing                            | ~0.3–0.5 s |

That adds up to about **3.5–5 s**.

**After.** About **2–2.8 s** (also estimated). The test path with the fake model at 900 ms and synthesis at 300 ms measured under 2.5 s.

- **Partial words.** The bot now subscribes to `transcript.partial_data`, but only with `RECALL_TRANSCRIBER=recallai_streaming`, which production uses. When the partial words address Q, the answer starts the moment the line ends. A line ends when Meet sends `speech_off`, or after 900 ms with no new words (for an open microphone). Q no longer waits for the final transcript.
- **No double answers.** When the final words ask the same thing (at most one new word), the answer started early stands. They do not "talk over" Q and they do not trigger a second model call. When the final words differ, Q answers them instead, without saying "Taking the latest question".
- **Shorter pause.** An answer waits for 400 ms of quiet (`replyQuietMs`) instead of 1.2 s. Q's unprompted lines keep the 1.2 s pause.
- **Short spoken style.** `MEETING_HOST_TURN` v3 asks for a direct first sentence under 15 words and under 35 words in all. If the first sentence is over 70 characters, it is spoken up to its first comma first, so the first audio needs only a few words of synthesis.
- **Etiquette cache.** The etiquette guides are cached for 5 minutes per organiser, which takes three DB reads off the answer path.
- **New log fields.** `meeting host spoke` now logs `heardToAudioMs`, `heardToComposedMs`, `early` and `firstPieceChars`, so the live number can be read straight from the logs.

The gateway's structured output does not stream, so the model's time to a full answer still dominates. Getting under 2 s would need a streaming text route for this turn, or a faster route for `NORMAL_DIALOGUE`.

### 2b. See cameras and the screen

- **What Recall sends.** Recall already streams `video_separate_png.data` (each participant at 360p and 2 fps, typed `webcam` or `screenshare`) to the signed websocket. This needs `RECALL_SCREEN_VISION=on`, which is set in production. Recall needs no new configuration.
- **New flag.** With **`RECALL_CAMERA_VISION=on`** (new, off by default), webcam frames are looked at as well. Each look goes through `MEETING_CAMERA_NOTE` v1, which notes behaviour, setup and objects only and never faces, appearance, identity or mood.
- **Camera budget.** One camera look every 30 s per call, each person at most once every 120 s, and at most 20 per call.
- **Screen budget.** Unchanged: once every 15 s, only when the screen changes, at most 40 per call.
- **Private notes.** Notes go to `communication.meeting_private_observations`, which is visible only to the assistant's owner (RLS). Camera notes use the new `source = 'CAMERA'` value from migration `20261219090000`. They are never sent to participants and never in the recap.
- **Answers use what is on screen.** When someone asks Q a question, the model receives what each recent look _showed_ (descriptions only, never Q's private take). If the question is about what is shown (screen, slide, see, camera, holding…), the latest frame goes along too: the screen if one is shared, otherwise the asker's camera. The frame is held in memory for 30 s and sent on the VISION route.
- **Consent line.** With cameras on, the greeting says "I can also see shared screens and cameras, for my own private notes." With cameras off, the line is unchanged: "...never your cameras."

## 3. Founder checks: 2 minutes each

**Rehearsal**

1. Open Rehearsals and start any rehearsal.
2. Turn the camera on, press **Let Q see you**, hold up a phone and ask "can you see what I'm holding?". The persona should describe the object.
3. Press **Present your screen**, share a slide, and ask "what do you think of this slide?". The persona should answer about it.
4. Optional, for the logs: `railway logs --service @capital-q/q-api | grep "rehearsal views"` should show `camera:true` and `screen:true`.

**Google Meet**

1. In Railway, on `@capital-q/q-api`, set `RECALL_CAMERA_VISION=on`. Keep `RECALL_SCREEN_VISION=on` and `RECALL_TRANSCRIBER=recallai_streaming`. Apply the migration, then redeploy.
2. Book a call on Capital Q and join from Meet. The greeting should mention cameras.
3. Say "Q, what's the agenda?" and time it from when you stop to Q's voice. Then grep `meeting host spoke` for `heardToAudioMs`; the target is below 2500.
4. Share a slide and ask "Q, what do you make of this slide?". Q should answer from the slide (`meeting host composed` shows `looked:1`).
5. Hold a product up to the camera for about 30 s.
6. After the call, open your private notes for the call. A line should start "On <name>'s camera: …".

## 4. Costs and caps

**Recall**

- Partial transcripts cost nothing extra; they come from the same `recallai_streaming` transcription.
- Camera vision adds nothing at Recall either: `RECALL_SCREEN_VISION=on` already pays for the 4-core bot plus separate video (`web_4_core`, which costs more per bot-hour than the standard bot).
- Check the per-hour rate on the Recall plan or dashboard. No live Recall call was made, and no pricing figure is in the repo.

**Model, per call**

| What                          | Cost per item | Cap per call | Cost cap      |
| ----------------------------- | ------------- | ------------ | ------------- |
| Screen notes                  | ≤ $0.02       | 40           | ≤ $0.80       |
| Camera notes                  | ≤ $0.02       | 20           | ≤ $0.40       |
| Answers                       | ≤ $0.02       |              |               |
| Answers that carry a frame    | ≤ $0.03       |              |               |
| All model calls (60 per call) | —             | 60           | ≤ about $1.80 |

**Model, per rehearsal:** at most 60 turns carry frames, at ≤ $0.03 each.

**ElevenLabs:** unchanged (turbo v2.5). The comma split adds no characters.

## 5. Needs a live call to verify

- The real `heardToAudioMs` numbers.
- That Recall sends `transcript.partial_data` to the webhook endpoint for this bot type, as its docs list for `recallai_streaming`.
- How well Meet's `speech_off` timing lines up.
- How readable 360p screen frames are for small slide text.
- Frames are held in each q-api process's memory. With more than one replica, a frame and the turn that needs it can land on different instances, so keep q-api at one replica.
