# Evidence: packages/q-specialists/src/answer.ts (lines 3069-3390)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 3069-3390 (HEAD 9177629d)
- Why included: answerOnce: specialist supports() vs delegate; company specialist synthesis, recommendation-claim guard, artifacts; screenActOf regexes.

```ts
 3069    const answerOnce = async (
 3070      request: QAnswerRequest,
 3071      route: {
 3072        readonly ownRecords?: boolean;
 3073        /** The turn reader's reading; absent when no reader is composed. */
 3074        readonly reading?: QSpecialistTurnReading | null;
 3075      } = {},
 3076    ): Promise<QAnswerOutcome> => {
 3077      // The conversation, not the run: a voice turn is its own run, and a
 3078      // specialist that sees one sentence cannot follow what is being
 3079      // talked about.
 3080      const history = await repositories.messages.listRecentForConversationOfRun(
 3081        sql,
 3082        request.tenantId,
 3083        request.runId,
 3084        64,
 3085      );
 3086      const conversationId = history[0]?.conversationId;
 3087      const latest = [...history].reverse().find((m) => m.role === "USER");
 3088      if (conversationId === undefined || latest === undefined) {
 3089        return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
 3090      }
 3091
 3092      const probe: QSpecialistProbe = {
 3093        capability: request.capability,
 3094        // Their own firm, carried as context for a fit question, is not a
 3095        // second subject: the question is still about the company
 3096        // (CQ-QX-007). The specialist reads their mandate from the plan.
 3097        subjects: askedSubjects(request.subjects, request.plan),
 3098        question: latest.content,
 3099        ...(route.reading === undefined ? {} : { reading: route.reading }),
 3100      };
 3101      // R18: a question asked while watching a pitch is about the moment in
 3102      // the video, which the conversational path reads (get_pitch_moment);
 3103      // the company analysis has no transcript. Decided by the structured
 3104      // context the Q API authorised, never by the question's words.
 3105      if (
 3106        request.plan.viewing !== undefined ||
 3107        route.ownRecords === true ||
 3108        !specialist.supports(probe)
 3109      ) {
 3110        return delegate.answer(request);
 3111      }
 3112      const company = request.subjects.find(
 3113        (subject) => subject.kind === "COMPANY",
 3114      );
 3115      if (company === undefined || company.kind !== "COMPANY") {
 3116        return delegate.answer(request);
 3117      }
 3118
 3119      last = null;
 3120      // The conversation core's decision for this turn (CQ-QX-005): only a
 3121      // turn read as explicitly asking for public information reads the web.
 3122      const directive =
 3123        request.research === undefined ? undefined : await request.research;
 3124      const result = await specialist.investigate(
 3125        {
 3126          company,
 3127          question: latest.content,
 3128          conversation: earlierTurns(history, latest.id),
 3129          publicResearch: directive?.mode === "EXPLICIT",
 3130          // A gap question changes what is emphasised, never what is read.
 3131          ...(asksAboutGaps(latest.content) ? { focus: ["GAPS"] as const } : {}),
 3132          // Their own conversation's most recent document, so a request
 3133          // to change it reads as one.
 3134          ...(() => {
 3135            const card = latestArtifactCardIn(history);
 3136            return card === null ? {} : { openDocument: { title: card.title } };
 3137          })(),
 3138        },
 3139        {
 3140          actor: request.actor,
 3141          runId: request.runId,
 3142          correlationId: request.correlationId,
 3143          capability: request.capability,
 3144          plan: request.plan,
 3145          ...(request.signal === undefined ? {} : { signal: request.signal }),
 3146          showStage: (stage) => showStage(request, stage),
 3147        },
 3148      );
 3149      last = result;
 3150
 3151      if (result.blocked === "CANCELLED") {
 3152        return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
 3153      }
 3154      // Last surface before a person reads it (CQ-Q-023). Capital Q has no
 3155      // deterministic recommendation factors yet, so a sentence explaining
 3156      // why something was recommended, ranked or matched was invented — and
 3157      // the prompt forbidding it is not what stops it reaching an investor.
 3158      // A model route that is out is not the end of the answer: what the
 3159      // deterministic pass computed still stands, and saying it beats an
 3160      // apology. Only when nothing was computed does the person hear why.
 3161      const degraded =
 3162        result.blocked === "MODEL_UNAVAILABLE" && result.findings.length > 0;
 3163      const guarded = withoutRecommendationClaims(
 3164        degraded
 3165          ? `${synthesisFromFindings(result)}\n\nThat is what's on record; the fuller review didn't come through this time, so ask again in a moment for more.`
 3166          : result.blocked !== null
 3167            ? publicBlockedMessage(result.blocked)
 3168            : (result.synthesis ?? synthesisFromFindings(result)),
 3169      );
 3170      if (guarded.removed > 0) {
 3171        logger?.warn(
 3172          { qRunId: request.runId, removed: guarded.removed },
 3173          "recommendation claims removed from a Q answer",
 3174        );
 3175      }
 3176      // What the person stated about their own company was recorded as
 3177      // their claim (CQ-Q-RESEARCH-001 §21, §40); the answer says so, in
 3178      // Capital Q's words, deterministically.
 3179      const acknowledgement =
 3180        result.recordedStatements.length === 0
 3181          ? ""
 3182          : `\n\n${quietlyNoted(result.recordedStatements)}`;
 3183      /**
 3184       * Preparing the document they asked for (QX-003D/F; ADR 0013).
 3185       *
 3186       * Everything before this composed; this persists, and it does so
 3187       * through the artifact application service, which re-derives
 3188       * authority from the run's own plan. The model read the request into
 3189       * a closed schema field and the specialist checked it against their
 3190       * own words; nothing here asks a model whether to write.
 3191       *
 3192       * A failure is not a failed answer. The findings still stand and the
 3193       * person still reads them; they are told the document did not come
 3194       * through, which is true and actionable, rather than shown an error.
 3195       */
 3196      const preparation =
 3197        artifacts === undefined || result.artifactRequest === null
 3198          ? null
 3199          : await prepareOrReviseArtifact({
 3200              artifacts,
 3201              request,
 3202              company,
 3203              companyName: "your company",
 3204              saidVerbatim: latest.content,
 3205              result,
 3206              history,
 3207              showStage: (stage) => showStage(request, stage),
 3208              ...(logger === undefined ? {} : { logger }),
 3209            });
 3210      const prepared =
 3211        preparation?.kind === "PREPARED" ? preparation.summary : null;
 3212      /**
 3213       * What the person is told about the document, by how it ended. A
 3214       * record too thin to write from is said as that, with what would fix
 3215       * it; "ask again in a moment" is kept for a failure another moment
 3216       * might cure (CQ-QX-005: never send a person round a loop the
 3217       * platform knows will fail the same way).
 3218       */
 3219      const documentNote =
 3220        prepared !== null
 3221          ? prepared.currentVersion <= 1
 3222            ? `\n\nI've prepared **${prepared.title}** from what's on record. It's a private draft in your workspace — nothing has been shared or sent.`
 3223            : `\n\nI've updated **${prepared.title}** — that's version ${String(prepared.currentVersion)}. The previous version is still there, and nothing has been shared or sent.`
 3224          : preparation?.kind === "THIN_RECORD"
 3225            ? `\n\nThere isn't enough on record about the company yet to build ${preparation.artifactType === "PITCH_DECK" ? "a deck" : "a brief"} worth sending — it would be mostly blanks. Add your existing deck or model on your company page, or tell me what you do, for whom, and the traction so far, and I'll build it from that.`
 3226            : preparation?.kind === "FAILED"
 3227              ? "\n\nI couldn't put that document together just now. What's above is what the record supports; ask again in a moment and I'll try the document again."
 3228              : "";
 3229      // Where the answer's supported findings came from, named the way the
 3230      // person knows it (CQ-QX-007 F1). Resolved from the citations that
 3231      // held, so it can never name a source the answer did not rest on.
 3232      const provenance = (() => {
 3233        if (result.blocked !== null && !degraded) return "";
 3234        const line = provenanceLine(result.findings);
 3235        return line === null
 3236          ? ""
 3237          : `
 3238
 3239  ${line}`;
 3240      })();
 3241      const content =
 3242        `${guarded.text}${provenance}${acknowledgement}${documentNote}`
 3243          .slice(0, ANSWER_LIMIT_CHARS)
 3244          .trim();
 3245      // An answer that was nothing but talk about acting (CQ-QX-007) had
 3246      // every sentence removed; Capital Q's own lines say what happened, and
 3247      // without one it is acknowledged and no more.
 3248      const said =
 3249        content.length === 0 && result.blocked === null && result.synthesis === ""
 3250          ? "Understood."
 3251          : content;
 3252      if (said.length === 0) {
 3253        return { kind: "FAILED", diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE" };
 3254      }
 3255
 3256      // The message and its durable completion event commit together
 3257      // (CQ-Q-009 §16-§18), so a client that missed every live delta
 3258      // converges on this text.
 3259      // One projection, used for the event and for the row, so a reopened
 3260      // conversation shows exactly what the live one did.
 3261      const analystBlocks = analystResultBlocks({
 3262        result: {
 3263          findings: result.findings,
 3264          contradictions: result.contradictions.map((contradiction) =>
 3265            contradiction.statements.join(" — and — "),
 3266          ),
 3267        },
 3268        subjects: askedSubjects(request.subjects, request.plan),
 3269      });
 3270
 3271      const blocks: QResultBlock[] | undefined =
 3272        prepared === null
 3273          ? analystBlocks === undefined
 3274            ? undefined
 3275            : [...analystBlocks]
 3276          : [
 3277              ...(analystBlocks ?? []),
 3278              {
 3279                kind: "ARTIFACT_REFERENCE" as const,
 3280                artifactId: prepared.artifactId,
 3281                type: prepared.type,
 3282                status: prepared.status,
 3283                title: prepared.title,
 3284              },
 3285            ];
 3286      const message = await transactions.run(async (tx) => {
 3287        const stored = await repositories.messages.insert(tx, {
 3288          tenantId: request.tenantId,
 3289          conversationId,
 3290          runId: request.runId,
 3291          role: "Q",
 3292          content: said,
 3293          ...(blocks === undefined ? {} : { blocks }),
 3294        });
 3295        await appendRunEvent(
 3296          repositories,
 3297          tx,
 3298          { id: request.runId, tenantId: request.tenantId },
 3299          {
 3300            type: "q.message.completed",
 3301            data: {
 3302              message: {
 3303                ...(toQMessage(stored) as QResponseMessage),
 3304                // What the specialist already found, as blocks a client
 3305                // can act on (QX-002/003 §C). The same projection the
 3306                // conversational seam uses, so one answer does not carry
 3307                // a different shape depending on which brain produced it.
 3308                ...(blocks === undefined ? {} : { blocks }),
 3309              },
 3310            },
 3311          },
 3312        );
 3313        return stored;
 3314      });
 3315
 3316      logger?.debug(
 3317        {
 3318          qRunId: request.runId,
 3319          findings: result.findings.length,
 3320          blocked: result.blocked,
 3321        },
 3322        "specialist answer recorded",
 3323      );
 3324
 3325      return {
 3326        kind: "ANSWERED",
 3327        messageId: message.id,
 3328        modelPolicyVersion: result.telemetry.routingPolicyCode ?? "none",
 3329        promptBundleVersion: result.telemetry.promptBundleVersion ?? "none",
 3330      };
 3331    };
 3332
 3333    return {
 3334      lastResult: () => last,
 3335      answer: answerTurn,
 3336      preread,
 3337      discard: (runId: string) => {
 3338        prereads.delete(runId);
 3339        delegate.discard?.(runId);
 3340      },
 3341      failureNotice: (runId: string) => {
 3342        const notice = notices.get(runId);
 3343        notices.delete(runId);
 3344        return notice;
 3345      },
 3346    };
 3347  }
 3348
 3349  /**
 3350   * The few bare screen commands done in code (scroll, top, bottom, back).
 3351   * Deliberately narrow: the whole message must be the command, optionally
 3352   * with "Q", "please" or "the page", so a question never matches.
 3353   */
 3354  export function screenActOf(text: string): {
 3355    readonly act:
 3356      "PAGE_DOWN" | "PAGE_UP" | "SCROLL_TOP" | "SCROLL_BOTTOM" | "GO_BACK";
 3357    readonly said: string;
 3358  } | null {
 3359    const t = text
 3360      .toLowerCase()
 3361      .replace(/[^a-z ]+/g, " ")
 3362      .replace(/\b(hey|ok|okay|hi|hello)\s+q\b/g, " ")
 3363      .replace(
 3364        /\b(please|q|can you|could you|now|for me|a bit|a little|the page|this page|on this page|on the page)\b/g,
 3365        " ",
 3366      )
 3367      .replace(/\s+/g, " ")
 3368      .trim();
 3369    if (
 3370      /^(scroll|go|move) down( more)?$|^(scroll|page) down$|^keep scrolling$|^scroll$/.test(
 3371        t,
 3372      )
 3373    ) {
 3374      return { act: "PAGE_DOWN", said: "Scrolling down." };
 3375    }
 3376    if (/^(scroll|go|move|page) up$/.test(t))
 3377      return { act: "PAGE_UP", said: "Scrolling up." };
 3378    if (
 3379      /^(scroll |go |take me )?(to )?(the )?top$|^back to (the )?top$/.test(t)
 3380    ) {
 3381      return { act: "SCROLL_TOP", said: "Back to the top." };
 3382    }
 3383    if (/^(scroll |go |take me )?(to )?(the )?bottom$/.test(t)) {
 3384      return { act: "SCROLL_BOTTOM", said: "To the bottom." };
 3385    }
 3386    if (/^go back$|^back$|^go to the previous page$/.test(t)) {
 3387      return { act: "GO_BACK", said: "Going back." };
 3388    }
 3389    return null;
 3390  }
```
