# Image model catalog id collision

Why included: Two migrations insert different models under the same UUID with ON CONFLICT DO NOTHING; code references the id.

## `supabase/migrations/20261203090000_model_usage_voice_realtime.sql` lines 23-39

```sql
   23  -- 2. Catalog ---------------------------------------------------------------
   24
   25  insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
   26    supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
   27    sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
   28    ('a2000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000003', 'gpt-realtime-mini', 'gpt-realtime', 'REALTIME', 'ACTIVE',
   29     32000, 4096, true, false, false, true, true, true, false,
   30     'PUBLIC', 'STANDARD', 'REALTIME', '2026-10-04T00:00:00Z',
   31     '{"purpose":"full-duplex voice (CQ_VOICE_REALTIME)","audio_prices_usd_per_million":{"input":10.0,"cached_input":0.30,"output":20.0},"note":"Session minted server-side as an ephemeral client secret; the browser never holds a key. Audio prices live here because model_prices has text columns only.","source_url":"https://developers.openai.com/api/docs/pricing","verified_at":"2026-10-04"}'::jsonb)
   32  on conflict (id) do nothing;
   33
   34  insert into ai_ops.model_prices (id, model_id, pricing_region, currency, input_per_million, cached_input_per_million, output_per_million,
   35    batch_input_per_million, batch_output_per_million, free_tier_description, effective_from, effective_to, source_url, verified_at) values
   36    ('a3000000-0000-4000-8000-000000000022', 'a2000000-0000-4000-8000-000000000022', 'global', 'USD', 0.60, 0.06, 2.40, null, null,
   37     'Text token prices. Audio: input 10.00, cached input 0.30, output 20.00 USD per million (models.metadata).',
   38     '2026-10-04T00:00:00Z', null, 'https://developers.openai.com/api/docs/pricing', '2026-10-04T00:00:00Z')
   39  on conflict (id) do nothing;
```

## `supabase/migrations/20261215090000_image_model_flash_lite.sql` lines 1-20

```sql
    1  -- Q room W5 (R8) · the Gemini image model moves to its named replacement.
    2  --
    3  -- gemini-2.5-flash-image is retired; the Google image adapter now runs
    4  -- gemini-3.1-flash-lite-image (Nano Banana 2 Lite, about $0.034 per 1K
    5  -- image). A new catalog row rather than an edit of the old one: earlier
    6  -- usage rows keep naming the model that actually ran.
    7
    8  insert into ai_ops.models (id, provider_id, model_code, model_family, model_type, status, context_window, max_output_tokens,
    9    supports_tools, supports_structured_output, supports_vision, supports_audio, supports_realtime, supports_prompt_cache, supports_reasoning,
   10    sensitivity_ceiling, quality_class, latency_class, effective_from, metadata) values
   11    ('a2000000-0000-4000-8000-000000000022', 'a1000000-0000-4000-8000-000000000001', 'gemini-3.1-flash-lite-image', 'gemini-image', 'IMAGE_GENERATION', 'ACTIVE',
   12     32000, 1, false, false, false, false, false, false, false,
   13     'PUBLIC', 'STANDARD', 'SLOW', '2026-10-07T00:00:00Z',
   14     '{"purpose":"document illustrations","note":"Paid key only (image models have no free tier). Prompts carry only a slide title, the document''s one-line description and brand colours; never figures, names or people. Max 6 per document.","cost_usd_per_image":0.034,"verified_at":"2026-10-07"}'::jsonb)
   15  on conflict (id) do nothing;
   16
   17  update ai_ops.models
   18     set status = 'RETIRED'
   19   where id = 'a2000000-0000-4000-8000-000000000021'
   20     and model_code = 'gemini-2.5-flash-image';
```

## `packages/model-gateway/src/images/config.ts` lines 1-48

```ts
    1  /**
    2   * Which image model each adapter runs, and what one image costs (Q room
    3   * W5, R8). One place, so a model retirement is a config change rather
    4   * than a hunt for constants: gemini-2.5-flash-image was retired and its
    5   * named replacement is the 3.1 flash-lite image model (Nano Banana 2
    6   * Lite, $0.034 per 1K image; research 2026-10-06 §5.3).
    7   *
    8   * The catalog ids are the ai_ops.models rows the usage ledger references;
    9   * a new model code is a new catalog row (migration), never an edit of the
   10   * old one, so earlier usage rows still name the model that ran.
   11   */
   12  export type ImageModelConfig = {
   13    readonly modelCode: string;
   14    /** Estimated USD per 1K image, recorded on every usage row. */
   15    readonly costPerImageUsd: number;
   16    readonly providerId: string;
   17    readonly modelId: string;
   18  };
   19
   20  export const IMAGE_MODEL_CONFIG = {
   21    google: {
   22      modelCode: "gemini-3.1-flash-lite-image",
   23      costPerImageUsd: 0.034,
   24      providerId: "a1000000-0000-4000-8000-000000000001",
   25      modelId: "a2000000-0000-4000-8000-000000000022",
   26    },
   27    openai: {
   28      modelCode: "gpt-image-1",
   29      // Medium quality, 1536x1024: about four US cents an image.
   30      costPerImageUsd: 0.04,
   31      providerId: "a1000000-0000-4000-8000-000000000003",
   32      modelId: "a2000000-0000-4000-8000-000000000020",
   33    },
   34  } as const satisfies Readonly<Record<string, ImageModelConfig>>;
   35
   36  /**
   37   * Generated images per deck or document, whatever the budgets allow
   38   * (founder direction 2026-10-06). Stock photos and placeholders fill the
   39   * rest.
   40   */
   41  export const GENERATED_IMAGES_PER_DOCUMENT_MAX = 6;
   42
   43  /**
   44   * How long a billing or quota refusal switches generation off for this
   45   * process. A refused key is not retried picture by picture: the deck
   46   * falls back to stock photos and placeholders at once.
   47   */
   48  export const IMAGE_BILLING_COOLDOWN_MS = 30 * 60 * 1000;
```

## `packages/model-gateway/src/realtime/openai.ts` lines 66-74

```ts
   66  }): RealtimeSessionProvider {
   67    const call = options.fetch ?? fetch;
   68    return {
   69      code: "openai",
   70      modelCode: options.modelCode ?? OPENAI_REALTIME_MODEL,
   71      providerId: "a1000000-0000-4000-8000-000000000003",
   72      // 20261203090000_model_usage_voice_realtime.sql
   73      modelId: "a2000000-0000-4000-8000-000000000022",
   74      prices: options.prices ?? OPENAI_REALTIME_MINI_PRICES,
```

## `supabase/tests/database/rls/320_ai_ops.test.sql` lines 38-44

```sql
   38    'groq zero data retention is recorded as enabled for this organisation');
   39  select results_eq(
   40    $$ select model_code from ai_ops.models order by model_code $$,
   41    $$ values ('gemini-2.5-flash-image'), ('gemini-3.5-flash'), ('gemini-3.5-flash-lite'), ('gemini-3.8-flash'),
   42              ('gpt-5.6-luna'), ('gpt-image-1'), ('gpt-realtime-mini'),
   43              ('openai/gpt-oss-120b'), ('openai/gpt-oss-20b'), ('qwen/qwen3.8-27b') $$,
   44    'the ten model ids are seeded, exactly (gpt-realtime-mini for full-duplex voice in 20261203090000, image models gemini-2.5-flash-image and gpt-image-1 in 20261113010000, qwen/qwen3.8-27b joined Groq in 20260918, gpt-5.6-luna in 20261006090000, gemini-3.5-flash in 20261008120000)');
```

## `supabase/tests/database/rls/882_document_jobs.test.sql` lines 84-88

```sql
   84  -- Image model catalog --------------------------------------------------------------
   85  select is((select status from ai_ops.models where id = 'a2000000-0000-4000-8000-000000000022'),
   86    'ACTIVE', 'gemini-3.1-flash-lite-image is the active Gemini image model');
   87  select is((select status from ai_ops.models where id = 'a2000000-0000-4000-8000-000000000021'),
   88    'RETIRED', 'gemini-2.5-flash-image is retired, not deleted');
```

## `packages/model-gateway/src/images/index.ts` lines 212-236

```ts
  212            failure = failureClassOf(error);
  213          }
  214          await options.usage
  215            ?.record({
  216              tenantId: request.attribution.tenantId,
  217              userId: request.attribution.userId,
  218              // Illustrations are for documents, whatever run asked.
  219              purpose: "DOCUMENT",
  220              qRunId: request.attribution.qRunId,
  221              taskClass: IMAGE_GENERATION_TASK_CLASS,
  222              providerId: provider.providerId,
  223              modelId: provider.modelId,
  224              routingPolicyId: undefined,
  225              attempt: Math.min(attempt, 6),
  226              inputTokens: 0,
  227              cachedInputTokens: 0,
  228              outputTokens: 0,
  229              latencyMs: Math.max(0, Math.round(now() - started)),
  230              // A refused or failed image is not billed by either vendor.
  231              costUsd: image === undefined ? 0 : provider.costPerImageUsd,
  232              costBasis: "ESTIMATED",
  233              success: image !== undefined,
  234              errorCode:
  235                image === undefined ? (failure ?? "TRANSIENT") : undefined,
  236              correlationId: request.attribution.correlationId,
```
