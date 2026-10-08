# Evidence: packages/model-gateway/src/q/index.ts (lines 3106-3500)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 3106-3500 (HEAD 9177629d)
- Why included: Messages = rendered + capability note + TOOLS_FIRST_NOTE; tool loop rounds, text round retry, say-do and screen-subject re-rounds.

```ts
 3106        let modelCalls = 0;
 3107        // What Capital Q says about a change approved by conversation this
 3108        // turn, from the approve tool's result (live 2026-09-27 #1, #2).
 3109        let approvalLine: string | null = null;
 3110        /**
 3111         * fill_profile_gaps (HARDEN P0, live 2026-10-02): the reply is the
 3112         * tool's own line. A first call's line ("couldn't settle values")
 3113         * stands only when no second call followed.
 3114         */
 3115        /** ADR 0040: what each app action that ran said, in its own words. */
 3116        const actedLines: string[] = [];
 3117        /**
 3118         * An app action prepared a card this turn: the engine says its status
 3119         * after the turn, so the model's own approval talk goes (lead
 3120         * 2026-10-03: one status per card per answer).
 3121         */
 3122        let preparedByTool = false;
 3123        let gaps: { readonly status: string; readonly line: string } | null =
 3124          null;
 3125        // The order matters more than the words: a model handed tools and a
 3126        // response shape at once reaches for the shape first.
 3127        // What this run can do and what the conversation already produced,
 3128        // as facts: the model claims neither more nor less (CQ-QX-008).
 3129        // Right after the prompt, so the tools-first note stays last.
 3130        const receipts = await receiptsRead;
 3131        const capabilities = capabilityNote(
 3132          request.capabilities,
 3133          offered.map((tool) => ({
 3134            name: tool.definition.name,
 3135            description: tool.definition.description,
 3136            classification: tool.classification,
 3137          })),
 3138          receipts,
 3139          plan.screen,
 3140        );
 3141        const workNote: readonly ModelMessage[] = workQuestion
 3142          ? [{ role: "SYSTEM", content: Q_WORK_LINE }]
 3143          : [];
 3144        let messages: ModelMessage[] =
 3145          offered.length === 0
 3146            ? [...rendered.messages, capabilities, ...workNote]
 3147            : [...rendered.messages, capabilities, ...workNote, TOOLS_FIRST_NOTE];
 3148  
 3149        if (ownProfileCall !== null) {
 3150          toolCalls.push(ownProfileCall);
 3151        }
 3152        if (relationshipCall !== null) {
 3153          toolCalls.push(relationshipCall);
 3154        }
 3155        if (onScreenCompanyCall !== null) {
 3156          toolCalls.push(onScreenCompanyCall);
 3157        }
 3158        toolCalls.push(...namedCompanyCalls);
 3159        if (onScreenDocumentCall !== null) {
 3160          toolCalls.push(onScreenDocumentCall);
 3161        }
 3162        toolCalls.push(...onScreenPageCalls);
 3163        if (onScreenDailyCall !== null) {
 3164          toolCalls.push(onScreenDailyCall);
 3165        }
 3166        toolCalls.push(...ownDayCalls);
 3167        if (ownStandingCall !== null) {
 3168          toolCalls.push(ownStandingCall);
 3169        }
 3170        if (ownProfile !== null || onboardingFacts.length > 0) {
 3171          messages = [...messages, OWN_MANDATE_NOTE];
 3172        }
 3173  
 3174        type AnswerResult = Awaited<
 3175          ReturnType<typeof gateway.execute<CompanyAnalystV17Result>>
 3176        >;
 3177  
 3178        try {
 3179          let final: AnswerResult | undefined;
 3180          let analyst: CompanyAnalystV17Result | undefined;
 3181  
 3182          if (offered.length > 0) {
 3183            took("prepare");
 3184            let rounds = 0;
 3185            let calls = 0;
 3186            // One more round, once, when every call of a round was refused
 3187            // or failed: the model picked the wrong tool and has no way to
 3188            // pick again (live smoke 2026-10-01: "which documents have you
 3189            // made me" called relationship.get, was denied, and the answer
 3190            // could only promise "I'll check"). Costs a call only then.
 3191            let recoveryRounds = 0;
 3192            // One more round, once, when the answer described doing
 3193            // something instead of calling the tool that does it.
 3194            let sayDoRounds = 0;
 3195            // One more round, once, after fill_profile_gaps searched: the
 3196            // second call carries the values the sources support.
 3197            let gapsRounds = 0;
 3198            // One more round, once, after use_capability loaded a tool: the
 3199            // model calls it in the next step of the same turn.
 3200            let loadRounds = 0;
 3201            let textRound = false;
 3202            /**
 3203             * The chained look-up rounds beyond the first
 3204             * (Q_TOOL_LOOP_MAX_ROUNDS). Never after public-web content was
 3205             * read (D/E: a retrieved page is data; the round after it holds
 3206             * no tools), and never in place of the research hop below: when
 3207             * the platform came back empty, the world is asked before Q
 3208             * answers.
 3209             */
 3210            const chainedRoundAllowed = (): boolean =>
 3211              !toolCalls.some(
 3212                (call) => call.providerName === "research_public_web",
 3213              ) && !(researchToolNow() !== undefined && researchHopDue());
 3214            while (
 3215              rounds <
 3216                1 +
 3217                  (chainedRoundAllowed() ? Q_TOOL_LOOP_MAX_ROUNDS - 1 : 0) +
 3218                  recoveryRounds +
 3219                  sayDoRounds +
 3220                  gapsRounds +
 3221                  loadRounds &&
 3222              calls < Q_TOOL_LOOP_MAX_CALLS
 3223            ) {
 3224              modelCalls += 1;
 3225              let result: Awaited<
 3226                ReturnType<typeof gateway.execute<CompanyAnalystV17Result>>
 3227              >;
 3228              try {
 3229                result = await gateway.execute<CompanyAnalystV17Result>(
 3230                  {
 3231                    ...base,
 3232                    messages,
 3233                    /**
 3234                     * The answer's schema beside the tools (live 2026-10-01:
 3235                     * as text, 5 of 8 first rounds came back in a shape the
 3236                     * schema refused, and each paid a second full call). The
 3237                     * OpenAI adapter sends both; the Gemini and Groq ones,
 3238                     * which refuse that pairing, send the tools and leave the
 3239                     * shape to the prompt. Either way the reply is accepted by
 3240                     * the same Zod schema as the call below.
 3241                     */
 3242                    // After a structured refusal this turn, the round asks
 3243                    // in text, tools kept (parity eval 2026-10-02).
 3244                    output: textRound
 3245                      ? ({ kind: "TEXT" } as const)
 3246                      : rendered.output,
 3247                    tools: offered.map((tool) => tool.definition),
 3248                  },
 3249                  options,
 3250                );
 3251              } catch (error: unknown) {
 3252                // Groq validates a model's tool call against the declared
 3253                // schema and refuses the whole request when the model got it
 3254                // wrong (tool_use_failed) — including on turns that never
 3255                // needed a tool at all. That is the model's output failing,
 3256                // not the person's question: the answer is produced without
 3257                // tools instead of the run failing (CQ-PRE-REC-001 §8).
 3258                if (
 3259                  isModelGatewayError(error) &&
 3260                  error.failureClass === "INVALID_MODEL_OUTPUT"
 3261                ) {
 3262                  // A structured answer the schema refused (parity eval
 3263                  // 2026-10-02: "answer:too_small" -- an empty answer where
 3264                  // the model meant to act) is not a reason to take the tools
 3265                  // away: the round is asked once more in text, tools kept,
 3266                  // and only then is the answer written without them.
 3267                  if (!textRound) {
 3268                    textRound = true;
 3269                    logger?.warn(
 3270                      { qRunId: request.runId, rounds, calls },
 3271                      "tool round's structured answer refused; asking again in text with the tools",
 3272                    );
 3273                    continue;
 3274                  }
 3275                  logger?.warn(
 3276                    { qRunId: request.runId, rounds, calls },
 3277                    "tool round refused by the provider; answering without tools",
 3278                  );
 3279                  break;
 3280                }
 3281                throw error;
 3282              }
 3283              took(`round${String(rounds)}`);
 3284              /**
 3285               * Said instead of done. The answer talks about doing something
 3286               * (actionTalk) while tools that could do it are in hand and
 3287               * nothing was called: one more round, with a trusted note to do
 3288               * it rather than describe it (founder live 2026-10-01: "what
 3289               * are these companies, can you list them" was answered "I need
 3290               * to retrieve your discovery slate first" instead of calling
 3291               * discovery_slate). Read from the answer's own structure, never
 3292               * from its words; once. Talk about a change that was in fact
 3293               * prepared this turn (a PREPARE or SIDE_EFFECT tool succeeded)
 3294               * is not a gap.
 3295               */
 3296              const saidInsteadOfDone = (
 3297                value: CompanyAnalystV17Result,
 3298                dropped: readonly string[] | undefined,
 3299              ): boolean =>
 3300                (value.actionTalk.length > 0 ||
 3301                  (dropped ?? []).some((path) =>
 3302                    path.startsWith("actionTalk"),
 3303                  )) &&
 3304                !toolCalls.some((call) => {
 3305                  const kind = offeredByName.get(
 3306                    call.providerName,
 3307                  )?.classification;
 3308                  return (
 3309                    call.status === "SUCCEEDED" &&
 3310                    kind !== undefined &&
 3311                    kind !== "READ_ONLY" &&
 3312                    kind !== "ANALYTICAL"
 3313                  );
 3314                }) &&
 3315                sayDoRounds === 0 &&
 3316                calls < Q_TOOL_LOOP_MAX_CALLS &&
 3317                request.signal?.aborted !== true;
 3318              /**
 3319               * Asked what the screen already answers. The answer puts a
 3320               * question back to the person while their screen shows a
 3321               * company, investor or document (founder live 2026-10-01: on
 3322               * Kazikit's page "get me a meeting with this person" got "who
 3323               * should I arrange the meeting with?"). One more round, with
 3324               * the screen's subject named as the referent; a question about
 3325               * something else (a time, an amount) is kept. From the
 3326               * answer's structure and the screen, never the words; once.
 3327               */
 3328              const screenNote = screenSubjectNote(plan.screen);
 3329              const askedWhatScreenShows = (
 3330                value: CompanyAnalystV17Result,
 3331              ): boolean =>
 3332                screenNote !== null &&
 3333                value.clarifyingQuestions.length > 0 &&
 3334                sayDoRounds === 0 &&
 3335                calls < Q_TOOL_LOOP_MAX_CALLS &&
 3336                request.signal?.aborted !== true;
 3337              const askToDoIt = (
 3338                said: string,
 3339                note: ModelMessage = SAY_DO_NOTE,
 3340              ): void => {
 3341                sayDoRounds = 1;
 3342                rounds += 1;
 3343                messages = [
 3344                  ...messages,
 3345                  { role: "ASSISTANT", content: said },
 3346                  note,
 3347                ];
 3348              };
 3349              if (result.output.kind === "STRUCTURED") {
 3350                if (
 3351                  saidInsteadOfDone(result.output.value, result.output.dropped)
 3352                ) {
 3353                  askToDoIt(JSON.stringify(result.output.value));
 3354                  continue;
 3355                }
 3356                if (
 3357                  screenNote !== null &&
 3358                  askedWhatScreenShows(result.output.value)
 3359                ) {
 3360                  askToDoIt(JSON.stringify(result.output.value), screenNote);
 3361                  continue;
 3362                }
 3363                // Nothing to look up, and the answer in the task's shape.
 3364                final = result;
 3365                analyst = result.output.value;
 3366                break;
 3367              }
 3368              if (result.output.kind === "TEXT") {
 3369                /**
 3370                 * Nothing (more) to look up, so this is the answer.
 3371                 *
 3372                 * This round carries the analyst's own prompt, so an answer
 3373                 * written here is written under the analyst's rules, and it
 3374                 * is accepted only if it satisfies the task's schema —
 3375                 * exactly as the structured call below would accept it.
 3376                 * Anything else falls through to that call.
 3377                 *
 3378                 * The alternative, asking a cheap throwaway prompt whether a
 3379                 * tool is wanted and then asking again for the answer, was
 3380                 * measured: the small prompt saved almost nothing, because
 3381                 * the cost of a turn is how many calls it makes rather than
 3382                 * how large they are, and it put a second and a half in
 3383                 * front of every question that needed no tool at all.
 3384                 */
 3385                const accepted = acceptStructuredOutput(
 3386                  result.output.text,
 3387                  CompanyAnalystV17ResultSchema,
 3388                  {
 3389                    invalidListItems: "DROP",
 3390                    lenientFields: ANALYST_LENIENT_FIELDS,
 3391                  },
 3392                );
 3393                if (
 3394                  accepted.ok &&
 3395                  saidInsteadOfDone(accepted.value, accepted.dropped)
 3396                ) {
 3397                  askToDoIt(result.output.text);
 3398                  continue;
 3399                }
 3400                if (
 3401                  accepted.ok &&
 3402                  screenNote !== null &&
 3403                  askedWhatScreenShows(accepted.value)
 3404                ) {
 3405                  askToDoIt(result.output.text, screenNote);
 3406                  continue;
 3407                }
 3408                if (accepted.ok) {
 3409                  final = result;
 3410                  analyst = accepted.value;
 3411                  if ((accepted.dropped?.length ?? 0) > 0) {
 3412                    logger?.warn(
 3413                      { qRunId: request.runId, dropped: accepted.dropped },
 3414                      "analyst reading kept; refused list elements were dropped",
 3415                    );
 3416                  }
 3417                } else {
 3418                  // Info, not debug: every such turn pays a second full
 3419                  // model call for the structured answer (live 2026-10-01:
 3420                  // ~1.6-2.2 s on most Home Q turns). The stage and the
 3421                  // refused paths say why; never the model's text.
 3422                  logger?.info(
 3423                    {
 3424                      qRunId: request.runId,
 3425                      stage: accepted.stage,
 3426                      refusals: (accepted.refusals ?? []).slice(0, 8),
 3427                      chars: result.output.text.length,
 3428                    },
 3429                    "a tool round answered outside the task's shape",
 3430                  );
 3431                }
 3432                break;
 3433              }
 3434              if (result.output.kind !== "TOOL_CALLS") {
 3435                break;
 3436              }
 3437              rounds += 1;
 3438              took(`round${String(rounds)}`);
 3439              const proposals = result.output.calls.slice(
 3440                0,
 3441                Q_TOOL_LOOP_MAX_CALLS - calls,
 3442              );
 3443              const assistant: ModelMessage = {
 3444                role: "ASSISTANT",
 3445                content: result.output.text,
 3446                toolCalls: [...proposals],
 3447              };
 3448              const results: ModelMessage[] = [];
 3449              // Reads run side by side (Zino live 2026-10-07: eight fit.profile
 3450              // reads in a row, one after another). Only when every call in
 3451              // the round is READ_ONLY and none changes what is offered; any
 3452              // other round keeps its order, one at a time, as before. The
 3453              // outcomes are still handled below in the order proposed.
 3454              const together =
 3455                proposals.length > 1 &&
 3456                proposals.every(
 3457                  (call) =>
 3458                    call.name !== USE_CAPABILITY_TOOL &&
 3459                    classificationOf(call.name) === "READ_ONLY",
 3460                );
 3461              const early = together
 3462                ? proposals.map((call) =>
 3463                    callTool(
 3464                      {
 3465                        callId: call.callId,
 3466                        name: call.name,
 3467                        arguments: call.arguments,
 3468                      },
 3469                      toolContext,
 3470                    ).then(
 3471                      (outcome) => ({ ok: true as const, outcome }),
 3472                      (error: unknown) => ({ ok: false as const, error }),
 3473                    ),
 3474                  )
 3475                : null;
 3476              for (const [index, call] of proposals.entries()) {
 3477                calls += 1;
 3478                const tool = offeredByName.get(call.name);
 3479                if (
 3480                  tool?.visibleStage !== undefined &&
 3481                  tool.visibleStage !== null
 3482                ) {
 3483                  await stageShown(tool.visibleStage);
 3484                }
 3485                const settled = await early?.[index];
 3486                if (settled !== undefined && !settled.ok) throw settled.error;
 3487                const outcome =
 3488                  settled !== undefined
 3489                    ? settled.outcome
 3490                    : await callTool(
 3491                        {
 3492                          callId: call.callId,
 3493                          name: call.name,
 3494                          arguments: call.arguments,
 3495                        },
 3496                        toolContext,
 3497                      );
 3498                toolCalls.push({
 3499                  toolName: outcome.toolName,
 3500                  providerName: call.name,
```
