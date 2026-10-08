# Evidence: apps/q-api/src/voice/providers/deepgram.ts (lines 106-108)

- Original path: `apps/q-api/src/voice/providers/deepgram.ts`
- Line range: 106-108 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: THINK_PROMPT.

```ts
  106  /** What Deepgram's orchestrator is told; Q's real instructions live on this server. */
  107  const THINK_PROMPT =
  108    "You are Q. Every reply is composed by Capital Q's own server; relay it exactly as given.";
```

# Evidence: apps/q-api/src/voice/providers/deepgram.ts (lines 192-256)

- Original path: `apps/q-api/src/voice/providers/deepgram.ts`
- Line range: 192-256 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Agent settings: flux STT, eot 0.85/4 s, think endpoint, speak relay, 16k/24k PCM.

```ts
  192      settingsFor: ({ voice, greeting, thinkToken, terms, locale }) => {
  193        const multilingual = speaksBeyondEnglish(locale);
  194        return {
  195          agent: {
  196            ...(multilingual ? {} : { language: "en" }),
  197            ...(greeting === undefined ? {} : { greeting }),
  198            listen: {
  199              provider: {
  200                type: "deepgram",
  201                version: "v2",
  202                model: multilingual ? "flux-general-multi" : "flux-general-en",
  203                keyterms: [
  204                  ...new Set([
  205                    ...(terms ?? [])
  206                      .map((term) => term.trim())
  207                      .filter((term) => term.length >= 2 && term.length <= 60),
  208                    ...ASR_KEYWORDS,
  209                  ]),
  210                ].slice(0, 100),
  211                // When a person has finished. The threshold is how sure the
  212                // turn model must be; the timeout is how long it waits for
  213                // that certainty before ending the turn anyway.
  214                //
  215                // It was 0.8 with the provider's default timeout of five
  216                // seconds. A short utterance — "what's up?" — rarely reaches
  217                // 0.8 on its own, so the turn ended only when the timeout did,
  218                // and five seconds of silence sat in front of every reply
  219                // before Q had even begun. The provider's own default is 0.7;
  220                // three seconds is the longest a person reads as "listening"
  221                // rather than "not working".
  222                //
  223                // Then 0.7 split people thinking aloud into a turn per pause
  224                // (live, 2026-09-25: twelve fragments of one thought). Measured
  225                // on the same audio streamed to Flux in real time, 3 runs each
  226                // (design/voice-comparison/flux-end-of-turn.md): 0.85 with a
  227                // four-second ceiling kept a trailing-off thought whole that
  228                // 0.7 and 0.8 split, and split a three-clause sentence in two
  229                // rather than three, for about 0.4 s more on a finished
  230                // sentence (end of speech to end of turn 0.9 s -> 1.3 s). 0.9
  231                // split no less and cost another 0.4 s. What the recogniser
  232                // still ends open is held by the turn (turn.ts, unfinished).
  233                eot_threshold: 0.85,
  234                eot_timeout_ms: 4_000,
  235              },
  236            },
  237            think: {
  238              provider: { type: "open_ai", model: "capital-q" },
  239              endpoint: {
  240                url: thinkUrl,
  241                headers: { authorization: `Bearer ${thinkToken}` },
  242              },
  243              prompt: THINK_PROMPT,
  244            },
  245            speak: speakFor(voice, thinkToken, multilingual),
  246          },
  247          audio: {
  248            input: { encoding: "linear16", sample_rate: 16_000 },
  249            output: {
  250              encoding: "linear16",
  251              sample_rate: 24_000,
  252              container: "none",
  253            },
  254          },
  255        };
  256      },
```

