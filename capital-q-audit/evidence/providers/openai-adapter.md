# OpenAI text adapter (Responses API)

Why included: Only OpenAI text path; hardcoded single model; store:false; SDK retries off.

## `packages/model-gateway/src/providers/openai.ts` lines 34-143

```ts
   34  /**
   35   * OpenAI adapter, behind the official SDK's Responses API. The only file
   36   * in Capital Q that imports it.
   37   *
   38   * Added as DIAGNOSTIC INFRASTRUCTURE, not as a provider strategy. Gemini
   39   * spent a day answering "this model is currently experiencing high
   40   * demand" and Groq's free tier spent it rate-limited, and with both
   41   * unreliable there was no way to tell a Capital Q defect from a vendor
   42   * outage — every failing journey had the same symptom. A provider that
   43   * answers reliably makes the core acceptance suite executable, which is
   44   * the whole reason it is here.
   45   *
   46   * It is reachable only where the catalogue lists it AND the deployment
   47   * has turned the test route on (see `createTestRoutingCatalog`). It is
   48   * not in any routing policy's own lists, so ordinary traffic cannot
   49   * reach it, and no browser can ask for it.
   50   *
   51   * Everything the other adapters are held to holds here. The OpenAI shape
   52   * is mapped in this file and stops here; the only functions declared are
   53   * the canonical tool definitions the Tool Registry offered; SDK retries
   54   * are off because the gateway owns them; no reasoning summary is
   55   * requested and none is surfaced, so no chain of thought reaches a
   56   * result; and the key never leaves this process.
   57   */
   58
   59  export const OPENAI_PROVIDER_CODE = "openai";
   60
   61  /** The one model this adapter is permitted to run. */
   62  export const OPENAI_TEST_MODEL = "gpt-5.6-luna";
   63
   64  /**
   65   * The caller's requested effort, as this vendor spells it (CQ-VOICE-010).
   66   *
   67   * It used to be "low" whatever was asked. On the interview turn, which
   68   * asks for NONE, that cost about a second at the median and three at the
   69   * tail. Measured on the real rendered INTERVIEW_CONDUCTOR request, 5
   70   * interleaved runs: "none" p50 3.76 s / p95 4.31 s against "low" p50
   71   * 4.61 s / p95 7.51 s, all fifteen outputs valid. "minimal" is refused by
   72   * this model, so nothing maps to it.
   73   */
   74  const OPENAI_REASONING_EFFORT: Readonly<
   75    Record<ModelReasoningLevel, "none" | "low" | "medium" | "high">
   76  > = {
   77    NONE: "none",
   78    LOW: "low",
   79    MEDIUM: "medium",
   80    HIGH: "high",
   81  };
   82
   83  export type OpenAIProviderOptions = {
   84    readonly apiKey: string;
   85    /** For tests: a client already built. */
   86    readonly client?: OpenAI | undefined;
   87  };
   88
   89  function isApiError(error: unknown): error is APIError {
   90    return error instanceof APIError;
   91  }
   92
   93  /**
   94   * The account, not the request: nothing will be served until someone tops
   95   * up or raises a limit. Live 2026-10-01: "credit_balance_exhausted" came
   96   * back classed TRANSIENT, so every turn retried a model that could not
   97   * answer before falling back, and runs failed after 50 to 95 seconds.
   98   */
   99  const ACCOUNT_EXHAUSTED_CODES: ReadonlySet<string> = new Set([
  100    "credit_balance_exhausted",
  101    "insufficient_quota",
  102    "billing_hard_limit_reached",
  103    "billing_not_active",
  104  ]);
  105
  106  export function accountExhausted(
  107    status: number | undefined,
  108    vendorErrorCode: string | undefined,
  109  ): boolean {
  110    return (
  111      status === 402 ||
  112      (vendorErrorCode !== undefined &&
  113        ACCOUNT_EXHAUSTED_CODES.has(vendorErrorCode))
  114    );
  115  }
  116
  117  /**
  118   * How a refusal is classed. An exhausted account is PERMANENT for the
  119   * attempt -- no retry on this model; another candidate may answer -- and
  120   * flagged, so the provider is skipped rather than retried every turn.
  121   */
  122  export function refusalClass(
  123    status: number | undefined,
  124    vendorErrorCode: string | undefined,
  125  ): {
  126    readonly failureClass: ModelFailureClass;
  127    readonly accountExhausted: boolean;
  128  } {
  129    return accountExhausted(status, vendorErrorCode)
  130      ? { failureClass: "PERMANENT", accountExhausted: true }
  131      : { failureClass: classify(status), accountExhausted: false };
  132  }
  133
  134  function classify(status: number | undefined): ModelFailureClass {
  135    if (status === 401 || status === 403) return "AUTHENTICATION";
  136    if (status === 429) return "RATE_LIMIT";
  137    if (status === 408) return "TIMEOUT";
  138    if (status === 400 || status === 404 || status === 422) {
  139      return "INVALID_REQUEST";
  140    }
  141    if (status !== undefined && status >= 500) return "PROVIDER_OUTAGE";
  142    return "TRANSIENT";
  143  }
```

## `packages/model-gateway/src/providers/openai.ts` lines 341-466

```ts
  341  export function createOpenAIModelProvider(
  342    options: OpenAIProviderOptions,
  343  ): ModelProvider {
  344    const client =
  345      options.client ??
  346      new OpenAI({
  347        apiKey: options.apiKey,
  348        // The gateway owns retry; the SDK gets one shot.
  349        maxRetries: 0,
  350      });
  351
  352    return {
  353      code: OPENAI_PROVIDER_CODE,
  354      capabilities: () => ({
  355        structuredOutput: true,
  356        toolCalling: true,
  357        streaming: true,
  358        cancellation: true,
  359      }),
  360      generate: async (
  361        request: ModelProviderRequest,
  362        context: ModelExecutionContext,
  363      ): Promise<ModelProviderResult> => {
  364        if (request.modelCode !== OPENAI_TEST_MODEL) {
  365          // The adapter is here to run one model. Anything else is a
  366          // configuration fault, and a loud one: this account has a few
  367          // dollars on it and an expensive model would eat them silently.
  368          throw new ModelProviderFailure(
  369            `openai adapter refuses model ${request.modelCode}`,
  370            {
  371              failureClass: "INVALID_REQUEST",
  372              providerCode: OPENAI_PROVIDER_CODE,
  373            },
  374          );
  375        }
  376        const { instructions, input } = toInput(request.messages);
  377        const tools = toTools(request.tools);
  378        const shared = {
  379          model: request.modelCode,
  380          input,
  381          ...(instructions === undefined ? {} : { instructions }),
  382          max_output_tokens: request.maxOutputTokens,
  383          ...(request.temperature === undefined
  384            ? {}
  385            : { temperature: request.temperature }),
  386          ...(tools === undefined ? {} : { tools: [...tools] }),
  387          // No summary is asked for and none is read: a reasoning trace is
  388          // not something Capital Q surfaces or stores (doc 12).
  389          reasoning: { effort: OPENAI_REASONING_EFFORT[request.reasoning] },
  390          // Nothing is kept on the vendor's side between calls.
  391          store: false,
  392          ...(request.output.kind === "STRUCTURED"
  393            ? {
  394                text: {
  395                  format: {
  396                    type: "json_schema" as const,
  397                    name: request.output.schemaName,
  398                    schema: request.output.jsonSchema,
  399                    strict: false,
  400                  },
  401                },
  402              }
  403            : {}),
  404        };
  405
  406        try {
  407          if (context.onTextDelta === undefined) {
  408            const params: ResponseCreateParamsNonStreaming = {
  409              ...shared,
  410              stream: false,
  411            };
  412            const response = await client.responses.create(params, {
  413              signal: context.signal,
  414              timeout: context.attemptTimeoutMs,
  415            });
  416            return {
  417              text: textOf(response),
  418              toolCalls: toToolCalls(response),
  419              usage: toUsage(response),
  420              finish: finishOf(response),
  421              modelCode: response.model,
  422              providerReference: response.id,
  423            };
  424          }
  425
  426          const params: ResponseCreateParamsStreaming = {
  427            ...shared,
  428            stream: true,
  429          };
  430          const stream = await client.responses.create(params, {
  431            signal: context.signal,
  432            timeout: context.attemptTimeoutMs,
  433          });
  434          let completed: OpenAIResponse | undefined;
  435          for await (const event of stream) {
  436            if (event.type === "response.output_text.delta") {
  437              context.onTextDelta(event.delta);
  438              continue;
  439            }
  440            if (
  441              event.type === "response.completed" ||
  442              event.type === "response.incomplete"
  443            ) {
  444              completed = event.response;
  445            }
  446          }
  447          if (completed === undefined) {
  448            throw new ModelProviderFailure("openai stream ended with no result", {
  449              failureClass: "TRANSIENT",
  450              providerCode: OPENAI_PROVIDER_CODE,
  451            });
  452          }
  453          return {
  454            text: textOf(completed),
  455            toolCalls: toToolCalls(completed),
  456            usage: toUsage(completed),
  457            finish: finishOf(completed),
  458            modelCode: completed.model,
  459            providerReference: completed.id,
  460          };
  461        } catch (error: unknown) {
  462          throw normalizeError(error);
  463        }
  464      },
  465    };
  466  }
```
