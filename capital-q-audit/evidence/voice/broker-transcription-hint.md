# Evidence: apps/q-api/src/voice/duplex/broker.ts (lines 216-258)

- Original path: `apps/q-api/src/voice/duplex/broker.ts`
- Line range: 216-258 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Transcriber language + vocabulary prompt.

```ts
  216  /**
  217   * The transcriber's bias. Every routed turn is acted on from its
  218   * transcript, so it is told the language (the device's, English by
  219   * default: unpinned, an accented "find anything that needs my attention"
  220   * came back as "Fidiani inanituma attention", live 2026-10-08) and the
  221   * words this person is likely to say. Names are data for the recogniser,
  222   * never instructions; each is bounded and the list is capped.
  223   */
  224  const TRANSCRIPTION_VOCABULARY = [
  225    "Capital Q",
  226    "Q",
  227    "Discover",
  228    "Explore",
  229    "data room",
  230    "pitch deck",
  231    "one-pager",
  232    "raise",
  233    "investors",
  234    "founders",
  235    "mandate",
  236    "diligence",
  237    "briefing",
  238    "relationships",
  239  ] as const;
  240  const TRANSCRIPTION_NAMES_MAX = 40;
  241  
  242  export function transcriptionHintFor(input: {
  243    readonly locale?: string | undefined;
  244    readonly vocabulary?: readonly string[] | undefined;
  245  }): { readonly language: string; readonly prompt: string } {
  246    const language = /^[a-z]{2}\b/i.exec(input.locale ?? "")?.[0];
  247    const names = [
  248      ...new Set(
  249        (input.vocabulary ?? [])
  250          .map((name) => name.replace(/\s+/g, " ").trim().slice(0, 60))
  251          .filter((name) => name.length > 1),
  252      ),
  253    ].slice(0, TRANSCRIPTION_NAMES_MAX);
  254    return {
  255      language: language?.toLowerCase() ?? "en",
  256      prompt: `A person talking to Q, their investment analyst, on Capital Q, for example: "Find anything that needs my attention." "Open their pitch deck." Words and names: ${[...names, ...TRANSCRIPTION_VOCABULARY].join(", ")}.`,
  257    };
  258  }
```

