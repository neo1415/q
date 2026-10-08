# Evidence: packages/model-gateway/src/realtime/openai.ts (lines 26-152)

- Original path: `packages/model-gateway/src/realtime/openai.ts`
- Line range: 26-152 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Model gpt-realtime-mini, transcription gpt-4o-transcribe, voices marin/cedar, semantic_vad, create_response false on routed lines.

```ts
   26  export const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
   27  const CLIENT_SECRETS_ENDPOINT =
   28    "https://api.openai.com/v1/realtime/client_secrets";
   29  export const OPENAI_REALTIME_CALLS_URL =
   30    "https://api.openai.com/v1/realtime/calls";
   31
   32  /** USD per million tokens (developers.openai.com/api/docs/pricing, 2026-10-04). */
   33  export const OPENAI_REALTIME_MINI_PRICES: RealtimePrices = {
   34    textInput: 0.6,
   35    cachedTextInput: 0.06,
   36    textOutput: 2.4,
   37    audioInput: 10,
   38    cachedAudioInput: 0.3,
   39    audioOutput: 20,
   40  };
   41
   42  /**
   43   * The input transcription model, and its prices (2026-10-08). On a routed
   44   * line every word Q acts on comes from this transcript, so it is the full
   45   * model, not mini: the founder's "find anything that needs my attention"
   46   * came back from mini as "Fidiani inanituma attention" (live 11:13 UTC).
   47   */
   48  export const OPENAI_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
   49  export const OPENAI_TRANSCRIBE_PRICES: RealtimePrices = {
   50    textInput: 2.5,
   51    cachedTextInput: 2.5,
   52    textOutput: 10,
   53    audioInput: 6,
   54    cachedAudioInput: 6,
   55    audioOutput: 0,
   56  };
   57
   58  /** Q's two voices, in the provider's catalogue. */
   59  const VOICES = { FEMALE: "marin", MALE: "cedar" } as const;
   60
   61  export function createOpenAIRealtimeProvider(options: {
   62    readonly apiKey: string;
   63    readonly fetch?: typeof fetch | undefined;
   64    readonly modelCode?: string | undefined;
   65    readonly prices?: RealtimePrices | undefined;
   66  }): RealtimeSessionProvider {
   67    const call = options.fetch ?? fetch;
   68    return {
   69      code: "openai",
   70      modelCode: options.modelCode ?? OPENAI_REALTIME_MODEL,
   71      providerId: "a1000000-0000-4000-8000-000000000003",
   72      // 20261203090000_model_usage_voice_realtime.sql
   73      modelId: "a2000000-0000-4000-8000-000000000022",
   74      prices: options.prices ?? OPENAI_REALTIME_MINI_PRICES,
   75      transcription: {
   76        modelCode: OPENAI_REALTIME_TRANSCRIBE_MODEL,
   77        prices: OPENAI_TRANSCRIBE_PRICES,
   78      },
   79      mint: async (request, context): Promise<RealtimeSessionGrant> => {
   80        let response: Response;
   81        try {
   82          response = await call(CLIENT_SECRETS_ENDPOINT, {
   83            method: "POST",
   84            headers: {
   85              authorization: `Bearer ${options.apiKey}`,
   86              "content-type": "application/json",
   87            },
   88            body: JSON.stringify({
   89              expires_after: {
   90                anchor: "created_at",
   91                seconds: request.secretTtlSeconds,
   92              },
   93              session: {
   94                type: "realtime",
   95                model: request.modelCode,
   96                instructions: request.instructions,
   97                output_modalities: ["audio"],
   98                max_output_tokens: request.maxOutputTokens,
   99                tool_choice: "auto",
  100                tools: request.tools.map((tool) => ({
  101                  type: "function",
  102                  name: tool.name,
  103                  description: tool.description,
  104                  parameters: tool.inputJsonSchema,
  105                })),
  106                audio: {
  107                  input: {
  108                    // AUTO waits a little longer on a turn that sounds
  109                    // unfinished, which is where Q's reactions go.
  110                    turn_detection: {
  111                      type: "semantic_vad",
  112                      eagerness:
  113                        request.turnEagerness === "AUTO" ? "auto" : "high",
  114                      // VOICE-BRAIN: on a routed line the server decides who
  115                      // answers each turn; the model never answers by itself.
  116                      create_response: request.routeTurns !== true,
  117                      // Not the provider: the browser confirms a barge-in after
  118                      // sustained speech (BARGE_CONFIRM_MS) and then cancels and
  119                      // truncates itself, so a cough or echo never cuts Q
  120                      // mid-sentence (founder live 2026-10-07).
  121                      interrupt_response: false,
  122                    },
  123                    ...(request.transcribeInput === true
  124                      ? {
  125                          transcription: {
  126                            model: OPENAI_REALTIME_TRANSCRIBE_MODEL,
  127                            ...(request.transcriptionHint?.language === undefined
  128                              ? {}
  129                              : {
  130                                  language: request.transcriptionHint.language,
  131                                }),
  132                            ...(request.transcriptionHint?.prompt === undefined
  133                              ? {}
  134                              : { prompt: request.transcriptionHint.prompt }),
  135                          },
  136                        }
  137                      : {}),
  138                  },
  139                  output: {
  140                    voice: VOICES[request.voice],
  141                    ...(request.speechSpeed === undefined
  142                      ? {}
  143                      : {
  144                          speed: Math.min(
  145                            1.5,
  146                            Math.max(0.25, request.speechSpeed),
  147                          ),
  148                        }),
  149                  },
  150                },
  151              },
  152            }),
```
