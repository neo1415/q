# Evidence: apps/q-api/src/voice/duplex/routes.ts (lines 62-117)

- Original path: `apps/q-api/src/voice/duplex/routes.ts`
- Line range: 62-117 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: tool and heard routes: strict schema parse of the broker's result.

```ts
   62    app.post(
   63      Q_VOICE_DUPLEX_TOOL_PATH,
   64      { onRequest: withContext },
   65      async (request, reply) => {
   66        const call = parseContract(
   67          QVoiceDuplexToolCallSchema,
   68          request.body ?? {},
   69          "That tool call is not valid.",
   70        );
   71        // The person spoke over Q and the browser let go: stop the turn.
   72        const controller = new AbortController();
   73        reply.raw.once("close", () => {
   74          if (!reply.raw.writableFinished) controller.abort();
   75        });
   76        const result = await broker.tool({
   77          actor: actorOf(request),
   78          voiceSessionId: idOf(request.params),
   79          call,
   80          signal: controller.signal,
   81        });
   82        if (result === null) return gone(reply);
   83        return reply
   84          .code(200)
   85          .header("Cache-Control", "no-store")
   86          .send(QVoiceDuplexToolResultSchema.parse(result));
   87      },
   88    );
   89
   90    // VOICE-BRAIN: a finished turn of the person's; the server decides who
   91    // answers it, and runs Q for a substantive one.
   92    app.post(
   93      Q_VOICE_DUPLEX_HEARD_PATH,
   94      { onRequest: withContext },
   95      async (request, reply) => {
   96        const heard = parseContract(
   97          QVoiceDuplexHeardSchema,
   98          request.body ?? {},
   99          "That turn is not valid.",
  100        );
  101        const controller = new AbortController();
  102        reply.raw.once("close", () => {
  103          if (!reply.raw.writableFinished) controller.abort();
  104        });
  105        const result = await broker.heard({
  106          actor: actorOf(request),
  107          voiceSessionId: idOf(request.params),
  108          heard,
  109          signal: controller.signal,
  110        });
  111        if (result === null) return gone(reply);
  112        return reply
  113          .code(200)
  114          .header("Cache-Control", "no-store")
  115          .send(QVoiceDuplexHeardResultSchema.parse(result));
  116      },
  117    );
```

# Evidence: packages/contracts/src/q/voice.ts (lines 409-489)

- Original path: `packages/contracts/src/q/voice.ts`
- Line range: 409-489 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: QVoiceDuplexToolResultSchema is .strict() and has no 'silent'; heard result has it.

```ts
  409  /** A model's proposal: untrusted input, validated again by the tool pipeline. */
  410  export const QVoiceDuplexToolCallSchema = z
  411    .object({
  412      callId: z.string().min(1).max(128),
  413      name: z
  414        .string()
  415        .min(1)
  416        .max(64)
  417        .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  418      /** The arguments as the model wrote them (JSON text). */
  419      arguments: z.string().max(8_000),
  420      /**
  421       * BACKCHANNEL, set_listening only: the provider's transcripts of the
  422       * person's latest turns (not the model's words), so the memory Write
  423       * Gate can check the quote against what was actually said.
  424       */
  425      heard: z.array(z.string().max(600)).max(4).optional(),
  426      /** BACKCHANNEL, set_listening only: the level the line is using now. */
  427      listening: QVoiceListeningLevelSchema.optional(),
  428    })
  429    .strict();
  430  export type QVoiceDuplexToolCall = z.infer<typeof QVoiceDuplexToolCallSchema>;
  431
  432  export const QVoiceDuplexToolResultSchema = z
  433    .object({
  434      /** What goes back to the model as the call's output (JSON text). */
  435      output: z.string().max(16_000),
  436      /** Something now waits on screen for the person's approval. */
  437      approvalPending: z.boolean(),
  438      /** BACKCHANNEL: the line's new listening level, applied at once. */
  439      listening: QVoiceListeningLevelSchema.optional(),
  440    })
  441    .strict();
  442  export type QVoiceDuplexToolResult = z.infer<
  443    typeof QVoiceDuplexToolResultSchema
  444  >;
  445
  446  /**
  447   * POST: one finished turn of the person's on a routed duplex line, as the
  448   * provider transcribed it (or as they typed it). The server decides who
  449   * answers: Q (it runs ask_q itself and returns the result for the voice
  450   * to say) or the voice (small talk; a reply to a card in focus).
  451   */
  452  export const Q_VOICE_DUPLEX_HEARD_PATH =
  453    "/v1/q/voice/sessions/:voiceSessionId/duplex/heard" as const;
  454  export const qVoiceDuplexHeardPath = (voiceSessionId: string) =>
  455    `/v1/q/voice/sessions/${encodeURIComponent(voiceSessionId)}/duplex/heard`;
  456  export const QVoiceDuplexHeardSchema = z
  457    .object({
  458      /** The provider's item id for the turn (null when typed). */
  459      itemId: z.string().min(1).max(128).nullable(),
  460      /** The provider's transcript of the person: untrusted input. */
  461      transcript: z.string().min(1).max(2_000),
  462      typed: z.boolean().optional(),
  463      /** A decision card is in focus on their screen (decide_card). */
  464      cardInFocus: z.boolean().optional(),
  465    })
  466    .strict();
  467  export type QVoiceDuplexHeard = z.infer<typeof QVoiceDuplexHeardSchema>;
  468
  469  export const Q_VOICE_DUPLEX_ROUTES = ["ASK_Q", "SMALLTALK", "MODEL"] as const;
  470  export const QVoiceDuplexHeardResultSchema = z.discriminatedUnion("route", [
  471    z
  472      .object({
  473        route: z.literal("ASK_Q"),
  474        /** The call the browser records on the line, then its output. */
  475        callId: z.string().min(1).max(128),
  476        arguments: z.string().max(8_000),
  477        output: z.string().max(16_000),
  478        approvalPending: z.boolean(),
  479        /**
  480         * Q chose to say nothing (words that were only the room): the voice
  481         * is not asked to speak, so it never improvises a reply of its own
  482         * (live 2026-10-08: "could you give me a bit more detail?").
  483         */
  484        silent: z.boolean().optional(),
  485      })
  486      .strict(),
  487    z.object({ route: z.literal("SMALLTALK") }).strict(),
  488    z.object({ route: z.literal("MODEL") }).strict(),
  489  ]);
```
