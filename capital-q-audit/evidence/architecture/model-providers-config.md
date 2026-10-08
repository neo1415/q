# Excerpt: packages/config/src/model-providers.ts lines 100-140

- Original path: `packages/config/src/model-providers.ts`
- Line range: 100-140
- Why included: Config comment says OpenAI is diagnosis-only and no routing policy names it; contradicted by migration 20261008130000 and q-api main.ts:927.

```
  100      .min(16)
  101      .max(64)
  102      .optional(),
  103    GEMINI_API_KEY: apiKey.optional(),
  104    // Further Gemini keys. The adapter rotates to the next one when a key
  105    // is rate-limited, so one exhausted free tier does not stop Q. Both
  106    // spellings are accepted because the second key was already in use
  107    // without the underscore before this was configurable.
  108    GEMINI_API_KEY_2: apiKey.optional(),
  109    GEMINI_API_KEY2: apiKey.optional(),
  110    GROQ_API_KEY: apiKey.optional(),
  111    // Further GroqCloud keys. The adapter rotates to the next one when a key
  112    // is rate-limited, so one exhausted free tier does not stop Q.
  113    GROQ_API_KEY_2: apiKey.optional(),
  114    GROQ_API_KEY_3: apiKey.optional(),
  115    GROQ_API_KEY_4: apiKey.optional(),
  116    /**
  117     * OpenAI, for diagnosis only (QX-004 core gate).
  118     *
  119     * No routing policy names it. It is reachable only through the
  120     * server-side test route, which refuses to exist outside a local or
  121     * test environment and without the synthetic-demo attestation. The
  122     * account holds a few dollars; the adapter runs one model and refuses
  123     * every other.
  124     */
  125    OPENAI_API_KEY: apiKey.optional(),
  126    // Both spellings, as the Gemini keys already are: the key was in use
  127    // under this name before it was configurable.
  128    OPEN_AI_API_KEY: apiKey.optional(),
  129    /**
  130     * Put one provider's models first, for a deployment that is diagnosing
  131     * rather than serving. Named by code (`openai`). Absent is the ordinary
  132     * case and the production one.
  133     */
  134    CQ_TEST_MODEL_PROVIDER: z.string().trim().max(32).optional(),
  135  };
  136
  137  export type ModelProviderSecrets = {
  138    /**
  139     * The operator asked this deployment to route attested synthetic demo
  140     * material by doc 15 §62. Not a secret and not authority: the gateway
```
