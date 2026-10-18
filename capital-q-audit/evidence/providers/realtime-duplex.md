# Realtime (duplex) provider, config, spend cap

Why included: gpt-realtime-mini + gpt-4o-transcribe; daily cap sums browser-reported usage.

## `packages/model-gateway/src/realtime/openai.ts` lines 1-198

```ts
    1  import { ModelProviderFailure } from "../errors.js";
    2  import type {
    3    RealtimePrices,
    4    RealtimeSessionGrant,
    5    RealtimeSessionProvider,
    6  } from "./index.js";
    7
    8  /**
    9   * OpenAI's Realtime API behind the realtime adapter (DUPLEX).
   10   *
   11   * The server mints a client secret (`POST /v1/realtime/client_secrets`)
   12   * with the whole session configured on it: model, instructions, the tools
   13   * the Tool Registry offered for this plan, the voice, turn detection that
   14   * interrupts Q when the person speaks, and a per-response output cap. The
   15   * browser opens WebRTC with that secret against `/v1/realtime/calls` and
   16   * never sees the API key. Input transcription (a small second model) is
   17   * requested only when the line listens like a person (BACKCHANNEL): the
   18   * transcripts give Q's reactions their context and give the memory Write
   19   * Gate the person's own words to check a spoken preference against. Its
   20   * usage is reported per item and priced at its own rates.
   21   *
   22   * Prompt caching is the provider's automatic prefix cache: the
   23   * instructions put the stable charter first and the per-line context last,
   24   * and tools keep the registry's order, so the prefix repeats.
   25   */
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
  153            signal: context.signal,
  154          });
  155        } catch (error) {
  156          throw new ModelProviderFailure(
  157            "openai realtime secret request failed",
  158            {
  159              failureClass: "TRANSIENT",
  160              providerCode: "openai",
  161              cause: error,
  162            },
  163          );
  164        }
  165        if (!response.ok) {
  166          throw new ModelProviderFailure("openai realtime secret refused", {
  167            failureClass:
  168              response.status === 429
  169                ? "RATE_LIMIT"
  170                : response.status === 401 || response.status === 403
  171                  ? "AUTHENTICATION"
  172                  : response.status === 400
  173                    ? "INVALID_REQUEST"
  174                    : "PROVIDER_OUTAGE",
  175            providerCode: "openai",
  176            providerStatus: response.status,
  177          });
  178        }
  179        const body: unknown = await response.json().catch(() => null);
  180        const value: unknown = Reflect.get(Object(body), "value");
  181        const expiresAt: unknown = Reflect.get(Object(body), "expires_at");
  182        if (typeof value !== "string" || value.length === 0) {
  183          throw new ModelProviderFailure("openai realtime secret was empty", {
  184            failureClass: "INVALID_MODEL_OUTPUT",
  185            providerCode: "openai",
  186          });
  187        }
  188        return {
  189          clientSecret: value,
  190          expiresAt:
  191            typeof expiresAt === "number" && Number.isFinite(expiresAt)
  192              ? new Date(expiresAt * 1000)
  193              : new Date(Date.now() + request.secretTtlSeconds * 1000),
  194          callsUrl: OPENAI_REALTIME_CALLS_URL,
  195        };
  196      },
  197    };
  198  }
```

## `apps/q-api/src/voice/duplex/config.ts` lines 1-140

```ts
    1  /**
    2   * Full-duplex voice settings (DUPLEX), from the environment.
    3   *
    4   * Off unless CQ_VOICE_REALTIME is "on". Every cap has a safe default and a
    5   * hard bound: a typo or an absurd value falls back to the default rather
    6   * than lifting a cap, because the provider budget is the founder's own.
    7   */
    8
    9  export type DuplexConfig = {
   10    readonly enabled: boolean;
   11    /** The line hands over to the standard voice after this long. */
   12    readonly maxSessionMs: number;
   13    /** Platform-wide realtime spend per UTC day; reaching it ends lines. */
   14    readonly dailyCapUsd: number;
   15    /** Silence for this long ends the line. */
   16    readonly idleMs: number;
   17    /** Held against the daily cap for each open line until it reports. */
   18    readonly sessionReserveUsd: number;
   19    /** Per response: bounds what one spoken answer can cost. */
   20    readonly maxOutputTokens: number;
   21    /** Read-only registry tools offered directly, beside ask_q. */
   22    readonly maxDirectTools: number;
   23    /** The client secret is only for opening the line. */
   24    readonly secretTtlSeconds: number;
   25    /**
   26     * BACKCHANNEL: the line listens like a person (reactions, bridges,
   27     * input transcription). On unless CQ_VOICE_REALTIME_BACKCHANNEL is
   28     * "off": the kill switch that leaves duplex exactly as before.
   29     */
   30    readonly backchannel: boolean;
   31    /**
   32     * voiceq-63: the realtime voice's speaking rate. The founder heard
   33     * "rapid-fire" speech; 0.95 is unhurried without sounding slow.
   34     * CQ_VOICE_REALTIME_SPEED, bounded 0.8-1.2.
   35     */
   36    readonly speechSpeed: number;
   37    /**
   38     * VOICE-BRAIN (founder live 2026-10-08): the server, not the realtime
   39     * model, decides who answers each turn; substantive turns always go to
   40     * Q's pipeline. On unless CQ_VOICE_REALTIME_ROUTE_TURNS is "off".
   41     */
   42    readonly routeTurns: boolean;
   43  };
   44
   45  export const DUPLEX_DEFAULTS: DuplexConfig = {
   46    enabled: false,
   47    maxSessionMs: 10 * 60 * 1000,
   48    dailyCapUsd: 1,
   49    idleMs: 30 * 1000,
   50    sessionReserveUsd: 0.25,
   51    maxOutputTokens: 800,
   52    maxDirectTools: 6,
   53    secretTtlSeconds: 60,
   54    backchannel: true,
   55    speechSpeed: 0.95,
   56    routeTurns: true,
   57  };
   58
   59  function bounded(
   60    raw: string | undefined,
   61    fallback: number,
   62    min: number,
   63    max: number,
   64  ): number {
   65    if (raw === undefined || raw.trim().length === 0) return fallback;
   66    const value = Number(raw);
   67    return Number.isFinite(value) && value >= min && value <= max
   68      ? value
   69      : fallback;
   70  }
   71
   72  export function duplexConfigFrom(
   73    env: Readonly<Record<string, string | undefined>>,
   74  ): DuplexConfig {
   75    const flag = env.CQ_VOICE_REALTIME?.trim().toLowerCase();
   76    const backchannel = env.CQ_VOICE_REALTIME_BACKCHANNEL?.trim().toLowerCase();
   77    const routeTurns = env.CQ_VOICE_REALTIME_ROUTE_TURNS?.trim().toLowerCase();
   78    return {
   79      enabled: flag === "on" || flag === "true" || flag === "1",
   80      maxSessionMs:
   81        bounded(
   82          env.CQ_VOICE_REALTIME_MAX_SESSION_SECONDS,
   83          DUPLEX_DEFAULTS.maxSessionMs / 1000,
   84          30,
   85          3600,
   86        ) * 1000,
   87      dailyCapUsd: bounded(
   88        env.CQ_VOICE_REALTIME_DAILY_CAP_USD,
   89        DUPLEX_DEFAULTS.dailyCapUsd,
   90        0,
   91        20,
   92      ),
   93      idleMs:
   94        bounded(
   95          env.CQ_VOICE_REALTIME_IDLE_SECONDS,
   96          DUPLEX_DEFAULTS.idleMs / 1000,
   97          5,
   98          600,
   99        ) * 1000,
  100      sessionReserveUsd: bounded(
  101        env.CQ_VOICE_REALTIME_SESSION_RESERVE_USD,
  102        DUPLEX_DEFAULTS.sessionReserveUsd,
  103        0.01,
  104        5,
  105      ),
  106      maxOutputTokens: Math.floor(
  107        bounded(
  108          env.CQ_VOICE_REALTIME_MAX_OUTPUT_TOKENS,
  109          DUPLEX_DEFAULTS.maxOutputTokens,
  110          100,
  111          4096,
  112        ),
  113      ),
  114      maxDirectTools: Math.floor(
  115        bounded(
  116          env.CQ_VOICE_REALTIME_DIRECT_TOOLS,
  117          DUPLEX_DEFAULTS.maxDirectTools,
  118          0,
  119          16,
  120        ),
  121      ),
  122      secretTtlSeconds: DUPLEX_DEFAULTS.secretTtlSeconds,
  123      speechSpeed: bounded(
  124        env.CQ_VOICE_REALTIME_SPEED,
  125        DUPLEX_DEFAULTS.speechSpeed,
  126        0.8,
  127        1.2,
  128      ),
  129      routeTurns: !(
  130        routeTurns === "off" ||
  131        routeTurns === "false" ||
  132        routeTurns === "0"
  133      ),
  134      backchannel: !(
  135        backchannel === "off" ||
  136        backchannel === "false" ||
  137        backchannel === "0"
  138      ),
  139    };
  140  }
```

## `apps/q-api/src/voice/duplex/spend.ts` lines 1-35

```ts
    1  import type { DatabaseExecutor } from "@capital-q/database";
    2
    3  /**
    4   * Today's full-duplex spend (DUPLEX): the sum of the VOICE_REALTIME rows
    5   * the Model Gateway wrote to ai_ops.model_usage since 00:00 UTC, across
    6   * every tenant, because the cap is the provider account's, not a
    7   * person's. Read through a partial index (20261203090000).
    8   */
    9  export type DuplexSpendLedger = {
   10    readonly spentTodayUsd: (at: Date) => Promise<number>;
   11  };
   12
   13  export function utcDayStart(at: Date): Date {
   14    return new Date(
   15      Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
   16    );
   17  }
   18
   19  export function createPostgresDuplexSpend(
   20    sql: DatabaseExecutor,
   21  ): DuplexSpendLedger {
   22    return {
   23      spentTodayUsd: async (at) => {
   24        const rows = await sql<{ usd: string }[]>`
   25          select coalesce(sum(cost_usd), 0)::text as usd
   26            from ai_ops.model_usage
   27           where purpose = 'VOICE_REALTIME'
   28             and occurred_at >= ${utcDayStart(at).toISOString()}::timestamptz`;
   29        const usd = Number(rows[0]?.usd ?? "0");
   30        // A sum that cannot be read as a number is not "nothing spent".
   31        if (!Number.isFinite(usd)) throw new Error("unreadable realtime spend");
   32        return usd;
   33      },
   34    };
   35  }
```

## `apps/q-api/src/voice/duplex/broker.ts` lines 643-665

```ts
  643      open: async ({ binding, firstMessage, locale, vocabulary }) => {
  644        if (!enabled) return { kind: "FALLBACK", reason: "OFF" };
  645        // A rehearsal line speaks only as the person Q plays; never duplex.
  646        if (binding.thread.rehearsal !== undefined) return fallback("REHEARSAL");
  647        const { actor } = binding;
  648        sweep();
  649        // One duplex line per person: a new one replaces what was open.
  650        for (const [id, line] of lines) {
  651          if (line.actor.userId === actor.userId) lines.delete(id);
  652        }
  653
  654        let spent: number;
  655        try {
  656          spent = await spend.spentTodayUsd(new Date(now()));
  657        } catch (error: unknown) {
  658          // Unknown spend is not zero spend: fail closed.
  659          logger.warn({ err: error }, "duplex spend ledger unreadable");
  660          return fallback("LEDGER_UNAVAILABLE");
  661        }
  662        if (spent + reserved() + config.sessionReserveUsd > config.dailyCapUsd) {
  663          return fallback("CAP_REACHED");
  664        }
  665
```

## `apps/q-api/src/voice/duplex/broker.ts` lines 1017-1068

```ts
 1017      },
 1018
 1019      usage: async ({ actor, voiceSessionId, report }) => {
 1020        const line = ownLine(actor, voiceSessionId);
 1021        if (line === null) return null;
 1022        const at = now();
 1023        line.lastActivityAt = at;
 1024        if (!line.seen.has(report.responseId)) {
 1025          line.seen.add(report.responseId);
 1026          const { responseId: _responseId, kind, ...usage } = report;
 1027          const counted = kind ?? "RESPONSE";
 1028          line.kinds[counted] = (line.kinds[counted] ?? 0) + 1;
 1029          try {
 1030            line.spentUsd += await gateway.record({
 1031              usage,
 1032              kind: counted,
 1033              attribution: {
 1034                tenantId: actor.tenantId,
 1035                userId: actor.userId,
 1036                correlationId: `rt_${voiceSessionId}`,
 1037              },
 1038            });
 1039          } catch (error: unknown) {
 1040            // Spend that could not be recorded cannot be capped: stop.
 1041            logger.warn({ err: error }, "duplex usage could not be recorded");
 1042            lines.delete(voiceSessionId);
 1043            return { continue: false };
 1044          }
 1045        }
 1046        if (at - line.openedAt >= config.maxSessionMs) {
 1047          // Kept (I1): the browser rejoins this line with a fresh call; an
 1048          // abandoned one is swept GRACE_MS past its length.
 1049          return { continue: false };
 1050        }
 1051        let spent: number;
 1052        try {
 1053          spent = await spend.spentTodayUsd(new Date(at));
 1054        } catch {
 1055          lines.delete(voiceSessionId);
 1056          return { continue: false };
 1057        }
 1058        if (spent >= config.dailyCapUsd) {
 1059          lines.delete(voiceSessionId);
 1060          logger.info({ spentUsd: spent }, "duplex daily cap reached");
 1061          return { continue: false, notice: DUPLEX_CAP_NOTICE };
 1062        }
 1063        return { continue: true };
 1064      },
 1065
 1066      narration: async ({ actor, voiceSessionId, after, signal }) => {
 1067        const line = ownLine(actor, voiceSessionId);
 1068        if (line === null) return null;
```
