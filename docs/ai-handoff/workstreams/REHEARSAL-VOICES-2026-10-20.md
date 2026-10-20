# Rehearsal voices — Kuuza persona voices in Q's rehearsals (2026-10-20)

Owner: Claude session `rehearsal-voices` (branch `claude/rehearsal-voices-7cf96d`, cut from `speed/q-oct20`).
Scope: rehearsal composition, the ElevenLabs/Deepgram voice providers, the persona voice catalog, the GateQ interview voice.
Not in scope: Q's own voice (GPT-Live, the turn-latency session), arrival, onboarding, artifacts, meetings.

Source ported (read-only): `C:\Users\Dell\Desktop\kuuza-ai-backend` — `voice/voice_db.py`, `elevenlabs/config_builder.py`, `elevenlabs/provider.py`, `shared/system_prompt.py`, `app/scripts/sync_voice_catalog.py`.

## 1. Inventory (before this branch, from the code)

### Which line a rehearsal speaks on

| Rehearsal | Transport | Who voices the counterpart | Where |
| --- | --- | --- | --- |
| Investor organisation / company (founder ↔ investor) | Standard line: Deepgram Voice Agent (Flux listens) → Q think route → ElevenLabs via this server's speak relay (BYO-TTS) | ElevenLabs premade voice, hash of `KIND:id` over 3 per gender (George/Brian/Roger, Charlotte/Alice/Jessica) | web `rehearsal-room.tsx` (`live: false` for these); `voice/routes.ts` session start; `providers/elevenlabs-speak.ts` `personaVoiceId` + `createElevenLabsSpeechRelay` |
| Researched external person | GPT-Live (speech-to-speech) when available; standard line otherwise | GPT-Live's own voice for the binding (`config.voices[binding.voice]` = marin/cedar, i.e. Q's own GPT voices) | `voice/live/broker.ts` (rehearsalLine.prepare → `rehearsals.externalLine`) |
| Live-trial users (`liveOnly`) | GPT-Live only | GPT-Live voice | `voice/routes.ts` `liveOnly` |
| Video rehearsal | Tavus (face + voice + turn-taking; LLM layer = Q bridge) | Tavus stock face's own voice (Steve/Julia/Raj/Mary) | `composition/rehearsal-video.ts` `createPal` |
| GateQ interview | Tavus (Q as interviewer) or typed | Tavus stock face voice — this is **Q**, not a persona | `apps/api/src/gateq/video-provider.ts` |

### How the persona voice was chosen
`voice/routes.ts` (POST session) reads `rehearsals.opening()` → `seed = "KIND:id"`, then `dependencies.rehearsals.voiceIdFor(voice, seed)` = `personaVoiceId` (`elevenlabs-speak.ts`): 31-hash over `PERSONA_VOICE_IDS[voice]`. Only input: the gender the person picked in the lobby. Nothing about the counterpart (place, age, temperament) reached the voice. The id is sealed into the session token (`session-token.ts` claim `spk`) and the relay validates it against an allow-list.

### TTS model
`providers/elevenlabs-speak.ts` `DEFAULT_MODEL = "eleven_v3_conversational"` for everything on the relay — Q's lines and persona lines alike — with `eleven_turbo_v2_5` per utterance when v3 fails or has no first byte in `FIRST_AUDIO_DEADLINE_MS` (1.2 s), then Deepgram Aura-2. Config `Q_VOICE_TTS_MODEL` (`packages/config/src/q-api.ts`). Deepgram is told `model_id: eleven_turbo_v2_5` but the relay decides. The Speech Engine admin (`dev/voice-setup.ts`) is Q's own voice and was not touched.

### How emotion reached speech
Turn model returns typed `mood`/`intensity`/`reaction` beside the line (bounded by `rehearsal-temperament.ts` `deliveryFor`/`nextTemperament`). `voice/rehearsal-turn.ts` `performRehearsalLine` → `speech-performance.ts` board → relay `renderSpeech` (`providers/speech-markup.ts`): on v3 as audio tags (`[skeptical]`, `[frustrated]`, `[shouting]` + Creative stability 0); on turbo **dropped** (tone not rendered at all); Aura none.

### Turn-taking
Deepgram Flux `eot_threshold 0.85`, `eot_timeout_ms 4000` for every line (`providers/deepgram.ts` `settingsFor`); barge-in by the agent; no per-persona tuning. Tavus: `sparrow-2`, patience `medium`.

### Latencies (where they are measured)
| Stage | Measured by | Value known |
| --- | --- | --- |
| Persona preparation | lobby, `rehearsals.ts` `ensurePersona` (PERSONA_BUDGET 40 s/attempt); external: `external-rehearsal-latency.ts` `persona_preparation_ms` | not in repo; p50/p95 in memory only |
| First audio (external, GPT-Live) | `external-rehearsal-latency.ts` `first_audio_ms` | in memory |
| Per turn | `turn-timing.ts` (`ttsRequestMs`, `firstAudioMs`, `served`); TURN_BUDGET 8 s; external `turn_latency_ms` | in memory |
| TTS first byte | comment in `elevenlabs-speak.ts`: v3 TTFA p95 301–563 ms from Lagos, worst 615 ms | measured 2026-09-24 |

## 2. Map: Kuuza → Q

| Kuuza | Q (this branch) |
| --- | --- |
| `voice_catalog.json` + `sync_voice_catalog.py` | `apps/q-api/src/voice/persona-voices/catalog-data.ts` (generated, public ids/labels only) + `apps/q-api/src/dev/sync-voice-catalog.ts` (API or `--from` export) |
| `voice_db.py` nationality → accent → regional fallback → American/British; English tiers; gender; nearest age; random choice | `persona-voices/catalog.ts` `accentForPlace` (nationalities **plus** countries, ISO-2 codes and investor cities), `pickVoice` (same chain/tiers/age), choice is a **deterministic hash of the counterpart** so it is sticky without a stored id |
| `selected_voice_id` + `voice_fits` | stickiness by deterministic choice; voice sealed in the session token |
| `shape_voice_settings_for_age` | `catalog.ts` `shapeForAge` (age is unknown in Q today, so it changes nothing yet) |
| `config_builder` stability 0.65 / similarity 0.85 | `persona-voice.ts` `PERSONA_STABILITY`, `PERSONA_SIMILARITY`; relay `personaVoiceSettings` |
| turn_eagerness from speed | patience (persona conduct) → `TurnTaking` → Flux end-of-turn (`deepgram.ts` `END_OF_TURN`) and pace |
| 20 suggested audio tags (v3) | Q already has 15 measured v3 tone tags + reactions (`speech-markup.ts`); v3 now used only for peaks |
| `ELEVENLABS_TTS_MODEL=eleven_v4_turbo` | `Q_REHEARSAL_TTS_MODEL` (default `eleven_v4_turbo`), chain v4 → flash v2.5 |
| English-only voice retry with `eleven_flash_v2` | relay `refusalKind` ENGLISH_ONLY → retry same voice on `eleven_flash_v2`, remembered per voice |
| system_prompt nationality idiom line | not ported (see row 12) |

## 3. Build table

| # | Row | Status |
| --- | --- | --- |
| 1 | Inventory of every rehearsal / GateQ voice path (above) | DONE |
| 2 | Voice catalog generated by a script, committed as data, no secrets | DONE — script done; **data is a seed from the owner's Kuuza account export** (Q has no ElevenLabs key locally). Re-run `node --import ../../scripts/dev-env.mjs src/dev/sync-voice-catalog.ts` in `apps/q-api` with Q's key. Library voices missing from Q's account fall back at runtime (row 8) |
| 3 | Typed picker: place → accent → regional → neutral; English tiers; gender; age; sticky | DONE (`catalog.ts`) |
| 4 | Persona attributes from what Q prepared: place (investor HQ country, company HQ, researched organisation location), gender (lobby choice), age (unknown), patience (persona conduct) | DONE (`rehearsals.ts` `voiceProfile`, `main.ts` `basedIn`, `persona-voice.ts`). A researched **real person** keeps a neutral voice (see Conflicts) |
| 5 | Unknown stays unknown → neutral accent, never an invented nationality | DONE (tested) |
| 6 | Per-turn emotion into TTS: v3 tags (existing) and **voice settings on turbo/flash/v4** (new `toneSettings`) | DONE |
| 7 | Model default via config: v4 turbo for personas, flash v2.5 behind it, v3 only for peaks (laugh/sigh/cry/raised/angry/sad); Q's own model unchanged | DONE (`Q_REHEARSAL_TTS_MODEL`, `Q_REHEARSAL_TTS_PEAKS`) |
| 8 | Fallbacks: English-only voice → flash v2; voice not in account → premade persona voice (never Q's); model unavailable → skipped 10 min; unknown id → premade persona voice | DONE (tested) |
| 9 | Turn-taking from patience (Flux end of turn: EAGER 0.8/3 s, NORMAL 0.85/4 s = Q's, PATIENT 0.9/5 s) | DONE |
| 10 | Interruptions | Already on (Deepgram barge-in aborts the relay request) — no change |
| 11 | Soft-timeout filler 3 s, pre_tool_speech, opener delay | NOT DONE — ElevenLabs-Agents settings with no equivalent on the Deepgram line; Q's silence ladder already covers waits, persona lines use no tools, and the persona already speaks first |
| 12 | Persona idiom/code-switching line | NOT DONE — persona `style` is already written by the persona model from a profile that includes "Based in"; changing the q-core turn prompt needs a prompt version and evals, and the external-person prompt deliberately forbids accent/dialect |
| 13 | External-person rehearsal on GPT-Live speaks with Q's GPT voice | NOT DONE — GPT-Live is speech-to-speech and cannot use an ElevenLabs voice; options for the owner: (a) open external-person rehearsals on the standard line (persona voice, ~1–2 s slower per turn), (b) give the persona a non-Q GPT voice (broker change, turn-latency session's file) |
| 14 | Tavus video rehearsal voice | NOT DONE — needs Tavus `layers.tts` (`tts_engine: elevenlabs`, `external_voice_id`), cannot be verified without a paid room (forbidden this session), and a stock face's look may not match a place-chosen accent |
| 15 | GateQ interview voice | NO CHANGE (by design) — the interviewer is Q, and Q's voice stays as it is |
| 16 | Spend caps / trial guards | Unchanged: the relay is only reachable through a sealed voice session that already passed them; the catalog adds no new provider calls |
| 17 | Unit tests: picker, settings, model fallbacks, English-only retry, turn-taking | DONE (`apps/q-api/test/rehearsal-voices.test.ts`) |
| 18 | Live samples + v4/v3 first-byte latency | see section 5 |

## Conflicts flagged (not overridden)
- `external-persona.ts` instructs the GPT-Live persona never to put on an accent "whatever the name, nationality or location suggests". The owner now wants accents. This branch applies place-based accents to organisations and companies only; a researched real person keeps a neutral voice, because location is not nationality. Owner decision needed to change that.

## 4. Gates
(filled in below after running)

## 5. Live check
(filled in below)
