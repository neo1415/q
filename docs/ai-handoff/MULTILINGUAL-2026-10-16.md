# Multilingual Q, Arabic first — provider research (2026-10-16)

Lane `ml`, branch `claude/ml-oct16`. What each provider in the current voice and video stack actually supports for Arabic, checked against official documentation on 2026-10-16, and what that means for Q. Retrieved pages were treated as data. Where documentation is silent, this file says so; nothing below is assumed parity.

## The stack as configured (code, not docs)

| Path                                              | Where                                                                                               | Listening                                                                          | Speaking                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Standard voice line                               | `apps/q-api/src/voice/providers/deepgram.ts` (Deepgram Voice Agent)                                 | Flux: `flux-general-en`, or `flux-general-multi` for any non-English device locale | Deepgram Aura (English voices) or ElevenLabs `eleven_turbo_v2_5`                                    |
| Q speaking a reply (TTS)                          | `voice/providers/elevenlabs-speak.ts`                                                               | —                                                                                  | ElevenLabs `eleven_v3_conversational`, fallback `eleven_turbo_v2_5`                                 |
| Duplex line (`CQ_VOICE_REALTIME`, off by default) | `packages/model-gateway/src/realtime/openai.ts`                                                     | `gpt-4o-transcribe` input transcription with a `language` hint                     | `gpt-realtime-mini`, voices marin and cedar                                                         |
| GPT-Live line (`CQ_VOICE_LIVE`, trial cohort)     | `voice/providers/gpt-live.ts`                                                                       | the model itself (no separate transcription endpoint)                              | `gpt-live-1`, voices marin and cedar                                                                |
| Rehearsal video, GateQ video                      | `packages/integrations/src/tavus/client.ts` via `composition/rehearsal-video.ts`, `meeting-face.ts` | Tavus STT (`tavus-auto`)                                                           | Tavus TTS (Cartesia or ElevenLabs); the face's default voice; lines come from Q over the LLM bridge |

Before this lane, the persisted language was nowhere: every path used the browser's `navigator.language` as a hint, the GPT-Live prompt said "always speak natural, standard English", and text Q ignored the run's `locale`.

## OpenAI: GPT-Live (`gpt-live-1`) and Realtime

- The `gpt-live-1` model page lists input and output modalities as audio and text, $0.05 per minute billed per second, and concurrency limits by tier. **It publishes no language list.** The standalone transcription endpoints are listed as not supported for this model. ([model page](https://developers.openai.com/api/docs/models/gpt-live-1))
- The GPT-Live prompting guide controls language by instruction: "Speak [language] unless the user asks to switch", "Write the prompt and examples in the language you want the assistant to speak", "Use the language configured by your application until the caller chooses another", and listen to samples "to check pronunciation and regional speaking style with your selected voice". ([Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting))
- The OpenAI speech guide says marin and cedar are the recommended voices, "Voices are currently optimized for English", and language support "generally follows the Whisper model". Arabic is in Whisper's list. ([Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech), [Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text))
- Transcription takes an ISO 639-1 `language` hint (`ar`); the newer `gpt-transcribe` takes `languages` instead. Community reports show Arabic Realtime transcription drifting to English without the hint. ([Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text), [community thread](https://community.openai.com/t/arabic-transcription-issue-with-openai-realtime-api/1117262))
- **Dialects:** OpenAI documents none. Modern Standard Arabic (MSA) is the safe output target. Gulf input is plausible but unmeasured; Gulf output by instruction is unverified and voices may carry an English accent.
- **Code-switching:** not documented. It follows from the prompt rule "unless the user asks to switch" and from keeping names and terms verbatim.

## ElevenLabs (TTS)

- Arabic (`ar`) is supported by `eleven_v3`, `eleven_v3_conversational` (about 280 ms), `eleven_v4`, `eleven_flash_v2_5` (about 75 ms) and the deprecated `eleven_turbo_v2_5`. `eleven_multilingual_v2` names "Arabic (Saudi Arabia, UAE)". The v3 and v4 families accept a `language_code` (ISO 639-1). ([Models](https://elevenlabs.io/docs/overview/models), [Languages](https://elevenlabs.io/docs/help-center/other/what-languages-do-you-support))
- Both models Q uses support Arabic. Dialect beyond the Saudi/UAE note on Multilingual v2 is not documented; accent comes from the voice, so a voice chosen for English may sound foreign in Arabic. That needs a human listen.
- The Scribe STT language list was not on the fetched page, so it is not relied on here.

## Deepgram (STT, Voice Agent)

- **Flux Multilingual (`flux-general-multi`) does not include Arabic.** Its 10 languages are en, es, fr, de, hi, ru, pt, ja, it and nl, with code-switching among those only; `language_hint` works only on that model. ([Flux language prompting](https://developers.deepgram.com/docs/flux/language-prompting), [changelog 2026-04-15](https://developers.deepgram.com/changelog/2026/4/15))
- **Nova-3 Arabic** (changelog 2026-01-27) supports `ar` plus 16 dialect codes, including the Gulf ones: `ar-AE`, `ar-SA`, `ar-QA` and `ar-KW`, as well as `ar-EG`, `ar-LB`, `ar-JO` and others. The changelog does not say streaming or batch. ([changelog 2026-01-27](https://developers.deepgram.com/changelog/2026/1/27))
- In the Voice Agent, `agent.listen.provider.language` sets the Nova language ("Flux models automatically leverage the language within the model's name"), and `agent.speak.provider.language` "Maps to Eleven Labs `language_code`". ([Configure the Voice Agent](https://developers.deepgram.com/docs/configure-voice-agent))
- **Consequence:** before this lane, an Arabic device got `flux-general-multi`, which cannot recognise Arabic. Arabic must listen with `nova-3` + `ar` (or the Gulf dialect code), and speak through ElevenLabs, not Aura.

## Tavus CVI

- Language is set as `languages`, an array of ISO codes, on the PAL (default) or on `properties.languages` of a conversation, which **replaces** the PAL's set. The first entry is the opening language. With neither set, the conversation runs in English. The single `properties.language` is deprecated. Arabic `ar` is one of the 42 supported languages. ([Language support](https://docs.tavus.io/sections/conversational-video-interface/language-support.md))
- "A conversation whose pinned STT or TTS engine cannot support every language in the field is rejected." Q pins neither engine, so `tavus-auto` chooses a model covering the set. ([Language support](https://docs.tavus.io/sections/conversational-video-interface/language-support.md), [STT layer](https://docs.tavus.io/sections/conversational-video-interface/persona/stt.md))
- **Replicas/faces:** the replica docs say replicas support conversations "in up to 30 languages with accent preservation", without a per-stock-replica language table. ([Replica overview](https://docs.tavus.io/sections/replica/overview)) Lip-sync is audio-driven, but whether a given stock face's default voice sounds natural in Arabic is **undocumented and unverified**.
- **LLM bridge:** Q's lines come from Q's own bridge (`layers.llm.base_url`), so the language of what the face says is decided by Q's prompt, not by Tavus. Tavus only needs `languages` to listen and speak Arabic.

## Implications

| Surface                          | Arabic plan                                                                                                                                               | Status after this lane |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Text Q                           | A language note in the gateway's per-person notes: reply in MSA, follow the person if they switch, keep names, figures, currency codes and terms verbatim | Planned (this lane)    |
| Standard voice                   | `nova-3` + `ar` listen, ElevenLabs speak with `language: ar`                                                                                              | Planned (this lane)    |
| Duplex                           | Transcription hint `ar`; instructions in Arabic                                                                                                           | Planned (this lane)    |
| GPT-Live                         | Prompt: speak Arabic (MSA) unless asked to switch                                                                                                         | Planned (this lane)    |
| Rehearsals (voice)               | The played investor speaks Arabic when the founder chose Arabic                                                                                           | Planned (this lane)    |
| Rehearsals / GateQ video (Tavus) | `properties.languages: ["ar","en"]`; Arabic spoken disclosure                                                                                             | Planned (this lane)    |
| Voice onboarding                 | The onboarding prompts (lane ob1) receive the effective language through an exposed parameter                                                             | Planned (this lane)    |

**Only a human can verify:** naturalness of Arabic speech per voice (marin, cedar, the ElevenLabs voices, Tavus faces), Gulf-dialect comprehension in real speech, code-switching mid-sentence in live audio, and lip-sync quality in Arabic.
