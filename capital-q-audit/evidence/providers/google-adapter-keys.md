# Gemini adapter: key rotation and deadline floor

Why included: Rotates multiple free-tier keys on RATE_LIMIT; 10 s deadline floor.

## `packages/model-gateway/src/providers/google.ts` lines 455-560

```ts
  455  /** Gemini refuses a request deadline below this and returns HTTP 400. */
  456  export const GEMINI_MIN_DEADLINE_MS = 10_000;
  457
  458  /**
  459   * The deadline to send Gemini for a caller who will wait `budgetMs`.
  460   *
  461   * Floored, because Gemini refuses anything under ten seconds outright —
  462   * "Manually set deadline 8s is too short. Minimum allowed deadline is
  463   * 10s", HTTP 400, every call. A caller with a shorter budget is not
  464   * asking for something invalid; it is asking to stop waiting sooner, and
  465   * the abort signal is what enforces that. Sending a number the vendor
  466   * rejects turns a short budget into a broken conversation, which is what
  467   * it did (local, 2026-09-22).
  468   */
  469  export function geminiDeadlineMs(budgetMs: number): number {
  470    return Math.max(GEMINI_MIN_DEADLINE_MS, budgetMs);
  471  }
  472
  473  export function createGoogleModelProvider(
  474    options: GoogleModelProviderOptions,
  475  ): ModelProvider {
  476    const clients = [options.apiKey, ...(options.additionalApiKeys ?? [])].map(
  477      (apiKey) => new GoogleGenAI({ apiKey }),
  478    );
  479    /** Per key: when it may be tried again. Index into `clients`. */
  480    const blockedUntil = clients.map(() => 0);
  481    let cursor = 0;
  482
  483    /** Keys to try for one request: from the cursor, unblocked first. */
  484    const keyOrder = (now: number): number[] => {
  485      const all = clients.map((_, index) => (cursor + index) % clients.length);
  486      const until = (index: number) => blockedUntil[index] ?? 0;
  487      return [
  488        ...all.filter((index) => until(index) <= now),
  489        ...all.filter((index) => until(index) > now),
  490      ];
  491    };
  492
  493    /**
  494     * Run one call against the keys in turn.
  495     *
  496     * `spoke` is whether anything has already been streamed to the person:
  497     * once a word has left, the same answer cannot be started again on
  498     * another key, so the failure stands.
  499     */
  500    const withKey = async <T>(
  501      run: (client: GoogleGenAI) => Promise<T>,
  502      spoke: () => boolean,
  503    ): Promise<T> => {
  504      let lastFailure: ModelProviderFailure | undefined;
  505      for (const index of keyOrder(Date.now())) {
  506        const client = clients[index];
  507        if (client === undefined) continue;
  508        try {
  509          const value = await run(client);
  510          cursor = index;
  511          return value;
  512        } catch (error: unknown) {
  513          const failure = normalizeError(error);
  514          const keyScoped =
  515            failure.failureClass === "RATE_LIMIT" ||
  516            failure.failureClass === "AUTHENTICATION";
  517          if (spoke() || !keyScoped || clients.length === 1) {
  518            throw failure;
  519          }
  520          // This key is spent or refused for now; the next one takes the
  521          // same request.
  522          blockedUntil[index] =
  523            Date.now() +
  524            (failure.failureClass === "AUTHENTICATION"
  525              ? REFUSED_KEY_COOLDOWN_MS
  526              : KEY_COOLDOWN_MS);
  527          lastFailure = failure;
  528        }
  529      }
  530      throw (
  531        lastFailure ??
  532        new ModelProviderFailure("gemini request failed", {
  533          failureClass: "TRANSIENT",
  534          providerCode: GOOGLE_PROVIDER_CODE,
  535        })
  536      );
  537    };
  538
  539    return {
  540      code: GOOGLE_PROVIDER_CODE,
  541      capabilities: () => ({
  542        structuredOutput: true,
  543        toolCalling: true,
  544        streaming: true,
  545        cancellation: true,
  546      }),
  547      generate: async (
  548        request: ModelProviderRequest,
  549        context: ModelExecutionContext,
  550      ): Promise<ModelProviderResult> => {
  551        const { systemInstruction, contents } = toContents(request.messages);
  552        // Thinking levels are Gemini 3's; a 2.x model refuses the field.
  553        const level = /^gemini-2\./.test(request.modelCode)
  554          ? undefined
  555          : thinkingLevel(request.reasoning);
  556        const config: GenerateContentConfig = {
  557          abortSignal: context.signal,
  558          // The gateway owns retry and its own timeout; the SDK gets one shot.
  559          //
  560          // Floored: see geminiDeadlineMs. The abort signal above is what
```
