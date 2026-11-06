# Voice falls back to ElevenLabs when OpenAI is out (DECISIONS 68) — receipts (2026-11-06)

Branch `fix/q-voice-elevenlabs-fallback`, from `fix/resume-asking-cv9ru3` @ `d8e643f`. No live provider call was made: every transport in the tests is a fake, and the keys are `disabled-locally-000000000000`.

## How voice ran before (the OpenAI account out)

The web client asks the server whether GPT-Live is available, then tries the lines in this order:

1. **GPT-Live** (OpenAI realtime). The server's availability answer did not know about credit, and a "yes" was cached for 5 minutes. So the client tried it, and the mint failed with a 402.
   - **Trial person** (a LIVE-only binding): voice ended there with "Voice couldn't connect on this network". That person had no voice at all.
   - **Anyone else:** the client said "Live voice isn't available right now, so I'm on my standard voice" and went on.
2. **The duplex line** (OpenAI realtime WebRTC). The session route tried to mint it on every line, which failed with a 402 at a cost in latency; the error was logged and the line skipped.
3. **The standard line: Deepgram's agent.**
   - Speech in: Deepgram.
   - Answers: the think endpoint is OpenAI's wire format pointed at this server (`voice/think.ts`), so it is Q's own turn path through the Model Gateway, on Claude.
   - Speech out: the ElevenLabs relay, or Aura-2.

   **This line already worked without OpenAI.**

4. **The ElevenLabs Speech Engine** (`providers/elevenlabs.ts`), used only when Deepgram is not composed. ElevenLabs carries the microphone, speech recognition, turn-taking and speech, and Q answers over this server's verified WebSocket. It never uses ElevenLabs' own LLM or persona. **This path also works without OpenAI.**

## How voice runs after (the OpenAI account out)

`voice/provider-accounts.ts` watches the Model Gateway's own provider health at composition. It sees the same records the gateway gets: an exhausted refusal opens the watch; a success, or any answer from the account, closes it; and it lapses after 10 minutes, like the gateway's own block. It makes no second probe, calls no provider, and changes nothing in the gateway.

While OpenAI is out:

- **The session route** issues the ElevenLabs Speech Engine line (`provider: "elevenlabs"`): speech in and out by ElevenLabs, with every answer from Q's turn path through the gateway, on Claude. If ElevenLabs is not composed, Deepgram's line is still used, and it is OpenAI-free.
- **No duplex credential is minted,** so no wasted 402.
- **No LIVE-only binding is issued,** so a trial person gets the ElevenLabs line rather than no voice.
- **GPT-Live availability says no.** That "no" is never answered from the 5-minute cache and never written to it, so the client tries no OpenAI line and there is no "standard voice" notice.
- **Unchanged on this line:** one conversation (the binding carries the same `conversationId`), the continuation opener (passed as the line's first message, which the ElevenLabs session speaks), mic release, and End.

**Recovery:** when the gateway's 30-second probe succeeds (`recordSuccess`), the watch clears, and the next line is Deepgram plus duplex, with GPT-Live offered again.

## The cost choice to confirm

A trial person's LIVE-only binding "never authorises an unmetered fallback", according to the live routes' comment. DECISIONS 68 says voice falls back to ElevenLabs with no exception, so while OpenAI is out a trial person gets the ElevenLabs line. To restrict that to non-trial people, `liveOnly` would ignore `openAiOut`; that is a one-line change.

## Tests

- **New:** `apps/q-api/test/voice-openai-exhausted.test.ts` (6 tests):
  - the watch opens and closes as the gateway's health does, and passes every record through;
  - while out, the line is ElevenLabs, with no duplex mint;
  - a trial person gets a voice;
  - GPT-Live is not offered even when a "yes" was cached, and is offered again at once afterwards;
  - after recovery, the line is Deepgram plus duplex.

  **Failing-first** against the base `voice/routes.ts` and `voice/live/routes.ts`: the 4 route tests failed. The 2 watch tests passed there, because the module is new.

- **New:** `apps/web/test/voice-openai-out-client.test.tsx` (1 test): with GPT-Live unavailable and an ElevenLabs credential, the client opens only the ElevenLabs line, with Q's own first words, tries no OpenAI line, and End ends it. This is existing client behaviour, so the test passes on the base too. It guards the path.

## Gates (exact results)

- `pnpm exec turbo run build --filter=./packages/*`: exit 0.
- Root tsc: exit 0. The first run failed on a failure-class literal in the new test, which is now fixed.
- q-api tsc: exit 0.
- eslint on the 7 touched files: exit 0. The first run flagged two unbound method references in the new test, which are now fixed.
- Full q-api vitest: 336 files passed and 1 skipped; 3129 tests passed and 3 skipped; exit 0.
- Web voice and Q-home vitest (`voice-*`, `q-voice*`, `q-home*`): 39 files and 370 tests passed.
- prettier: clean.

## Addendum: the lead's decision B (`c75b1bc`)

**Owner detail:** Q's voice on the fallback is `eleven_v4_turbo`, in Q's own Sarah (FEMALE, `EXAVITQu4vr4xnSDxMaL`) or Daniel (MALE, `onwK4e9ZLuTAKqWW03F9`), following the person's choice, and never a persona or story voice.

**Decision B** (replacing the Speech-Engine-first choice above). While OpenAI's account is out:

- **The line stays Deepgram's.** Deepgram listens, and Q's own turn path answers (`think.ts`, the Model Gateway, on Claude).
- **q-api's ElevenLabs relay speaks** in Q's own voice on `eleven_v4_turbo`, with turbo v2.5 behind it per utterance and Aura-2 as the last resort.
  - The relay asks for the model per utterance (`modelNow`), so recovery needs no restart.
  - Persona voices keep their own chain.
- **`Q_VOICE_TTS_MODEL` still wins when set** (config `ttsModelPinned`). The code default on this path is `eleven_v4_turbo`, with no Railway variable needed.
- **Without Deepgram composed,** the ElevenLabs Speech Engine carries the line (the earlier path).
- **Unchanged:** GPT-Live and duplex stay off, and trial people keep a voice (the lead's call under DECISIONS 68).

**Tests:**

- `voice-openai-out-speech.test.ts` (new): while out, the relay speaks `eleven_v4_turbo` in Sarah (FEMALE) and Daniel (MALE). Once OpenAI is back, it speaks the deployment's model again.
- `voice-openai-exhausted.test.ts` (updated to B, 7 tests):
  - while out, the line is Deepgram with no duplex mint and no Speech Engine;
  - without Deepgram, it falls through to the Speech Engine;
  - a trial person gets Deepgram;
  - recovery brings back Deepgram plus duplex.
- **Failing-first** against `f07bb32`: the relay test and 3 route tests failed. The watch tests, the fall-through and GPT-Live availability passed, because those already held there.

### Follow-up, option A (not done)

The Speech Engine's own TTS model is set on the ElevenLabs resource by `dev/voice-setup.ts`, and is currently `eleven_v3_conversational`. The repository's SDK (`@elevenlabs/elevenlabs-js` 2.68) types the Speech Engine's model as `TtsConversationalModel`, which does not list `eleven_v4_turbo`.

Moving the Speech Engine to v4 turbo needs two things: a live admin check that ElevenLabs accepts it there (`pnpm voice:setup -- --dry-run`, then a real run), and an SDK version that types it. There is no SDK change now.

### Gates at `c75b1bc` (exact results)

- `pnpm exec turbo run build --filter=./packages/*`: exit 0.
- Root tsc: exit 0.
- q-api tsc: exit 0.
- eslint on the 6 touched files: exit 0.
- `vitest run apps/q-api packages/config`: 351 files passed and 1 skipped; 3279 tests passed and 3 skipped; exit 0.
- prettier: clean.
