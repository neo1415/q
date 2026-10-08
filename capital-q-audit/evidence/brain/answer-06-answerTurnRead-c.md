# Evidence: packages/q-specialists/src/answer.ts (lines 2900-3068)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 2900-3068 (HEAD 9177629d)
- Why included: Question series, readinessLead, ownRecords, tool focus, finalRequest, speculation adopt, answerOnce, conversation state reduce.

```ts
 2900      // Where a requested series of questions stands, decided from the
 2901      // reading alone (R35): the answer is told which question it is on,
 2902      // and the series moves only once that answer has landed.
 2903      const series = stepQuestionSequence(
 2904        sequences.get(conversationId) ?? null,
 2905        read === null ? null : { kind: read.kind, sequence: read.sequence },
 2906      );
 2907      if (series.step !== null) {
 2908        logger?.info(
 2909          {
 2910            qRunId: request.runId,
 2911            sequence: series.step.kind,
 2912            ...("number" in series.step ? { number: series.step.number } : {}),
 2913            total: "total" in series.step ? series.step.total : null,
 2914          },
 2915          "q question series",
 2916        );
 2917      }
 2918      // A question about what is on their own record ("what do you have on
 2919      // record about my company", "summarise my raise") is read from the
 2920      // record by the conversational path, which reads it directly; the
 2921      // company analysis is for assessment (lead decision 2026-10-01: the
 2922      // analysis took 12.4 s and 1,100 tokens to restate a profile).
 2923      // "What should I do next?" about themselves (ADVICE, no one else
 2924      // named): their readiness gaps open the answer, composed by code, and
 2925      // the conversational path answers the rest (lead 2026-10-03, run
 2926      // 2cba241a: the company analysis led with an operating-market detail).
 2927      const readinessLead =
 2928        !writingDocument &&
 2929        read?.question?.kind === "ADVICE" &&
 2930        read.aboutNamedOther !== true &&
 2931        dependencies.readinessLead !== undefined
 2932          ? await dependencies.readinessLead(request).catch(() => null)
 2933          : null;
 2934      const ownRecords =
 2935        readinessLead !== null ||
 2936        (!writingDocument && read?.question?.kind === "THEIR_OWN_RECORDS");
 2937      // What the turn is about narrows the tool offer (lead 2026-10-02);
 2938      // "yes" to Q's own offer keeps the previous turn's focus.
 2939      const named = [
 2940        ...(read?.askedAction !== undefined &&
 2941        read.askedAction !== null &&
 2942        actions.some((action) => action.name === read.askedAction)
 2943          ? [read.askedAction]
 2944          : []),
 2945        ...(appActionOf(read) === null ? [] : [appActionOf(read)?.tool ?? ""]),
 2946        // What the router named, so a code-run miss still offers it.
 2947        ...(routed === null ? [] : [routed]),
 2948      ].filter((name) => name.length > 0);
 2949      const toolFocus = toolFocusOf({
 2950        reading:
 2951          read === null
 2952            ? null
 2953            : {
 2954                kind: read.kind,
 2955                questionKind: read.question?.kind ?? null,
 2956                namedTools: named,
 2957                hand: read.tool?.kind ?? null,
 2958                handOver: (read.handOver ?? null) !== null,
 2959                research: (await research).mode,
 2960                text: latest.content,
 2961              },
 2962        subjectKinds: request.subjects.map((subject) => subject.kind),
 2963        counterparty: await aboutCounterparty(request, latest.content, read),
 2964        areaOf: toolAreaOf,
 2965        previous: focuses.get(conversationId) ?? null,
 2966        onboarding: request.plan.screen?.route === "ONBOARDING",
 2967      });
 2968      focuses.delete(conversationId);
 2969      if (read?.kind === "TOOL_REQUEST") {
 2970        logger?.info(
 2971          {
 2972            qRunId: request.runId,
 2973            areas: toolFocus?.areas ?? null,
 2974            tools: toolFocus?.tools ?? null,
 2975            widened: toolFocus?.widen === true,
 2976            routed,
 2977          },
 2978          "q tool focus for a request",
 2979        );
 2980      }
 2981      if (toolFocus !== null) {
 2982        focuses.set(conversationId, toolFocus);
 2983        if (focuses.size > MAX_CONVERSATIONS) {
 2984          const oldest = focuses.keys().next().value;
 2985          if (oldest !== undefined) focuses.delete(oldest);
 2986        }
 2987      }
 2988      const finalRequest: QAnswerRequest = {
 2989        ...request,
 2990        research,
 2991        capabilities: manifestOf(capabilities),
 2992        ...(turnUnread ? { turnUnread: true } : {}),
 2993        // Said aloud: the answer is shaped for the ear (2026-10-07).
 2994        ...(spoken ? { spoken: true } : {}),
 2995        ...(read === null ? {} : { turnKind: read.kind }),
 2996        ...(read?.question?.kind === undefined
 2997          ? {}
 2998          : { questionKind: read.question.kind }),
 2999        ...(readinessLead === null ? {} : { leadLines: readinessLead }),
 3000        // Only a name the reader was given counts (ADR 0040 parity).
 3001        ...(read?.askedAction === undefined ||
 3002        read.askedAction === null ||
 3003        !actions.some((action) => action.name === read.askedAction)
 3004          ? {}
 3005          : { askedAction: read.askedAction }),
 3006        ...(writingDocument ? { writingDocument: true } : {}),
 3007        ...(series.step === null ? {} : { questionSequence: series.step }),
 3008        ...(toolFocus === null ? {} : { toolFocus }),
 3009      };
 3010      const finalRoute = {
 3011        ownRecords,
 3012        reading:
 3013          read === null
 3014            ? null
 3015            : {
 3016                kind: read.kind,
 3017                questionKind: read.question?.kind ?? null,
 3018                aboutNamedOther: read.aboutNamedOther,
 3019              },
 3020      };
 3021      // The turn's own path has arrived at its answer: the speculation is
 3022      // adopted only when that answer is the one it is already writing.
 3023      const speculation = speculative.current;
 3024      const misfit =
 3025        speculation === null
 3026          ? null
 3027          : speculationMisfit({
 3028              final: finalRequest,
 3029              finalResearch: await research,
 3030              ownRecords,
 3031              speculative: speculation.request,
 3032              speculativeResearch,
 3033            });
 3034      if (misfit !== null) speculation?.cancel(misfit);
 3035      const outcome =
 3036        speculation !== null && misfit === null
 3037          ? await speculation.adopt()
 3038          : await answerOnce(finalRequest, finalRoute);
 3039      if (writingDocument && outcome.kind === "ANSWERED") {
 3040        await fileWrittenAnswer(
 3041          request,
 3042          conversationId,
 3043          outcome,
 3044          documents.filter((document) => document.documentType !== "Q_REPORT"),
 3045        );
 3046      }
 3047      if (outcome.kind === "ANSWERED" && series.step !== null) {
 3048        keepSequence(conversationId, series.next);
 3049      }
 3050      if (outcome.kind === "FAILED") {
 3051        const operation = operationOf(outcome.diagnosticCode);
 3052        if (operation !== null) {
 3053          const noted = noteAnswerFailure(state, operation);
 3054          remember(conversationId, noted.state);
 3055          if (noted.notice !== null) notices.set(request.runId, noted.notice);
 3056        }
 3057      } else if (outcome.kind === "ANSWERED") {
 3058        remember(
 3059          conversationId,
 3060          reduceConversation(
 3061            reduceConversation(state, { type: "SUCCEEDED", operation: "MODEL" }),
 3062            { type: "SUCCEEDED", operation: "TOOL" },
 3063          ),
 3064        );
 3065      }
 3066      return outcome;
 3067    };
 3068
```
