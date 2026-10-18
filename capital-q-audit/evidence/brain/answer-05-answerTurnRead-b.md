# Evidence: packages/q-specialists/src/answer.ts (lines 2600-2900)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 2600-2900 (HEAD 9177629d)
- Why included: Pending app action continuation, readerNamed, router, delegation, app action run with retry, hand-over.

```ts
 2600      // generated tool, with its own authorize step and approval card, and
 2601      // says the tool's own line; the model is not asked to choose it.
 2602      // Named but not filled (parity eval 2026-10-02: 3 of 12 Discover turns
 2603      // read askedAction pass_company / save_company with appAction empty):
 2604      // one small extraction against that tool's own input schema fills it.
 2605      const appTools = dependencies.appActions?.tools ?? new Set<string>();
 2606      // The reply to a question a declared action asked (QA 7d7e7260 ->
 2607      // 5c2f71aa: "Lagos" after "Which city are you in…" got no card): that
 2608      // action continues, its arguments merged with what this reply adds,
 2609      // read against its own schema. A reply, or the same action asked for
 2610      // again, continues it; anything else is answered as itself.
 2611      const waiting = await pendingActions.take({
 2612        tenantId: request.tenantId,
 2613        conversationId,
 2614      });
 2615      if (
 2616        waiting !== null &&
 2617        dependencies.appActions !== undefined &&
 2618        read !== null &&
 2619        (read.kind === "ANSWER" ||
 2620          read.kind === "CLARIFICATION" ||
 2621          read.kind === "CORRECTION" ||
 2622          read.askedAction === waiting.action.tool)
 2623      ) {
 2624        const added = await dependencies
 2625          .appActionArguments?.(request, {
 2626            tool: waiting.action.tool,
 2627            utterance: latest.content,
 2628          })
 2629          .catch(() => null);
 2630        const merged: Record<string, unknown> = {
 2631          ...waiting.action.arguments,
 2632          ...(added !== null && added !== undefined && typeof added === "object"
 2633            ? added
 2634            : {}),
 2635        };
 2636        // The place they gave when asked for their time zone, turned into
 2637        // one by code (QA runs a87ca38f, 2e053864: "Lagos" was asked about
 2638        // again); the reader's own reading is the fallback.
 2639        if (waiting.needs === "TIME_ZONE") {
 2640          const zone =
 2641            zoneFromWords(latest.content) ??
 2642            (typeof merged["timeZone"] === "string"
 2643              ? zoneFromWords(merged["timeZone"])
 2644              : null);
 2645          if (zone !== null) merged["timeZone"] = zone;
 2646        }
 2647        const action: TurnAppAction = {
 2648          tool: waiting.action.tool,
 2649          arguments: merged,
 2650        };
 2651        logger?.info(
 2652          {
 2653            qRunId: request.runId,
 2654            tool: action.tool,
 2655            needs: waiting.needs,
 2656            added: added !== null && added !== undefined,
 2657          },
 2658          "a declared action waiting on their reply continues",
 2659        );
 2660        const continued = await dependencies.appActions
 2661          .run(request, action)
 2662          .catch(() => null);
 2663        if (continued !== null) {
 2664          return saidByAction(request, conversationId, action, continued);
 2665        }
 2666      }
 2667      const readerNamed =
 2668        read !== null &&
 2669        read.kind === "TOOL_REQUEST" &&
 2670        read.confidence !== "LOW" &&
 2671        typeof read.askedAction === "string" &&
 2672        appTools.has(read.askedAction) &&
 2673        offeredNames.has(read.askedAction)
 2674          ? read.askedAction
 2675          : null;
 2676      // The reader's own app action, only when it is a declared one.
 2677      const readerAppAction = (() => {
 2678        const own = appActionOf(read);
 2679        return own !== null && appTools.has(own.tool) ? own : null;
 2680      })();
 2681      /**
 2682       * A request to act that named no declared action (lead 2026-10-03,
 2683       * runs 9b4ef8d1, 7dd0bc2c, 31d085ac): one small routing call over the
 2684       * declared actions this person may take here, on any purpose. Not for
 2685       * a hand, a hand-over or a document, which have their own paths.
 2686       */
 2687      // What else they said about the grant, read against the tool's own
 2688      // schema by the same small reader app actions use.
 2689      const readDelegationArguments =
 2690        (request: QAnswerRequest, utterance: string) =>
 2691        async (): Promise<Readonly<Record<string, unknown>> | null> => {
 2692          const args = await dependencies.appActionArguments?.(request, {
 2693            tool: DELEGATION_TOOL,
 2694            utterance,
 2695          });
 2696          return args !== null &&
 2697            args !== undefined &&
 2698            typeof args === "object" &&
 2699            !Array.isArray(args)
 2700            ? args
 2701            : null;
 2702        };
 2703      const routed =
 2704        dependencies.appActionRouter !== undefined &&
 2705        dependencies.appActions !== undefined &&
 2706        read !== null &&
 2707        read.kind === "TOOL_REQUEST" &&
 2708        read.confidence !== "LOW" &&
 2709        readerNamed === null &&
 2710        readerAppAction === null &&
 2711        !fundVisibility &&
 2712        recordAudience === null &&
 2713        (read.tool ?? null) === null &&
 2714        (read.handOver ?? null) === null &&
 2715        !writingDocument
 2716          ? await dependencies
 2717              .appActionRouter(request, {
 2718                utterance: latest.content,
 2719                candidates: [
 2720                  ...offeredActions.filter((action) => appTools.has(action.name)),
 2721                  // Handing work over in general is one of the meanings a
 2722                  // request to act can have; the router weighs it with the
 2723                  // rest (QA 2026-10-03).
 2724                  // Always, when composed: the tool is called under the run's
 2725                  // own plan, whatever this turn's focus offered (QA
 2726                  // 2026-10-03, run d77f9934).
 2727                  ...(dependencies.delegation !== undefined
 2728                    ? [DELEGATION_CANDIDATE]
 2729                    : []),
 2730                ],
 2731              })
 2732              .catch(() => null)
 2733          : null;
 2734      if (routed === DELEGATION_TOOL && dependencies.delegation !== undefined) {
 2735        logger?.info(
 2736          { qRunId: request.runId, routed },
 2737          "q request route: handed over in general; standing instruction",
 2738        );
 2739        return recordAnswer(
 2740          request,
 2741          conversationId,
 2742          await actOnDelegation(
 2743            dependencies.delegation,
 2744            request,
 2745            latest.content,
 2746            readDelegationArguments(request, latest.content),
 2747          ),
 2748        );
 2749      }
 2750      const namedAction =
 2751        readerNamed ??
 2752        (fundVisibility ? INVESTOR_VISIBILITY_TOOL : (recordAudience ?? routed));
 2753      // How a request to act was routed, said once before any path can
 2754      // return (lead 2026-10-03: the focus line came after the code-run
 2755      // return, so a request done by code never logged one).
 2756      if (read?.kind === "TOOL_REQUEST") {
 2757        logger?.info(
 2758          {
 2759            qRunId: request.runId,
 2760            confidence: read.confidence,
 2761            readerNamed,
 2762            readerAppAction: readerAppAction?.tool ?? null,
 2763            hand: read.tool?.kind ?? null,
 2764            recordAudience,
 2765            routed,
 2766            action: readerAppAction?.tool ?? namedAction,
 2767          },
 2768          "q request route",
 2769        );
 2770      }
 2771      const appAction =
 2772        readerAppAction ??
 2773        (dependencies.appActions !== undefined &&
 2774        dependencies.appActionArguments !== undefined &&
 2775        namedAction !== null
 2776          ? await (async () => {
 2777              const tool = namedAction;
 2778              const args = await dependencies
 2779                .appActionArguments?.(request, {
 2780                  tool,
 2781                  utterance: latest.content,
 2782                })
 2783                .catch(() => null);
 2784              logger?.info(
 2785                { qRunId: request.runId, tool, filled: args != null },
 2786                "app action named without arguments; arguments read for it",
 2787              );
 2788              if (args === null || args === undefined) {
 2789                // Asked for and not prepared: "try again" binds to it.
 2790                noteAction(
 2791                  request,
 2792                  conversationId,
 2793                  { tool, arguments: null },
 2794                  "NOT_DONE",
 2795                );
 2796                return null;
 2797              }
 2798              return { tool, arguments: args };
 2799            })()
 2800          : null);
 2801      if (
 2802        dependencies.appActions !== undefined &&
 2803        appAction !== null &&
 2804        read !== null &&
 2805        read.confidence !== "LOW" &&
 2806        dependencies.appActions.tools.has(appAction.tool) &&
 2807        !writingDocument
 2808      ) {
 2809        const said = await dependencies.appActions
 2810          .run(request, appAction)
 2811          .catch(() => null);
 2812        if (said !== null) {
 2813          return saidByAction(request, conversationId, appAction, said);
 2814        }
 2815        // The reader's own arguments did not fit the tool (parity eval
 2816        // 2026-10-02: "Change our fund's website to ..." failed
 2817        // INVALID_ARGUMENTS): once, the arguments are read again against the
 2818        // tool's own schema, and the same tool runs with them.
 2819        if (
 2820          appActionOf(read) !== null &&
 2821          dependencies.appActionArguments !== undefined &&
 2822          offeredNames.has(appAction.tool)
 2823        ) {
 2824          const again = await dependencies
 2825            .appActionArguments(request, {
 2826              tool: appAction.tool,
 2827              utterance: latest.content,
 2828            })
 2829            .catch(() => null);
 2830          logger?.info(
 2831            {
 2832              qRunId: request.runId,
 2833              tool: appAction.tool,
 2834              reread: again !== null,
 2835            },
 2836            "app action refused its read arguments; arguments read for it again",
 2837          );
 2838          if (
 2839            again !== null &&
 2840            JSON.stringify(again) !== JSON.stringify(appAction.arguments)
 2841          ) {
 2842            const retried = await dependencies.appActions
 2843              .run(request, { tool: appAction.tool, arguments: again })
 2844              .catch(() => null);
 2845            if (retried !== null) {
 2846              return saidByAction(
 2847                request,
 2848                conversationId,
 2849                { tool: appAction.tool, arguments: again },
 2850                retried,
 2851              );
 2852            }
 2853          }
 2854        }
 2855        // Tried and not done: what "try again" will run, with its inputs.
 2856        noteAction(request, conversationId, appAction, "NOT_DONE");
 2857      }
 2858      // A hand-over (TURN_READER v22): "get me a meeting with this person",
 2859      // "handle this for me", in any language. Code prepares Q's errand for
 2860      // the subject they are looking at, for their approval, instead of the
 2861      // answer asking who (founder live 2026-10-01).
 2862      if (
 2863        dependencies.handOver !== undefined &&
 2864        read !== null &&
 2865        read.confidence !== "LOW" &&
 2866        read.handOver !== undefined &&
 2867        read.handOver !== null &&
 2868        tool === null &&
 2869        !writingDocument
 2870      ) {
 2871        const handed = await actOnHandOver(
 2872          dependencies.handOver,
 2873          request,
 2874          read.handOver,
 2875          read.timeWindow ?? null,
 2876        ).catch((error: unknown) => {
 2877          logger?.warn(
 2878            { err: error, qRunId: request.runId },
 2879            "a hand-over was not prepared; answering normally",
 2880          );
 2881          return { kind: "NONE" } as const;
 2882        });
 2883        if (handed.kind === "STANDING") {
 2884          if (dependencies.delegation !== undefined) {
 2885            return recordAnswer(
 2886              request,
 2887              conversationId,
 2888              await actOnDelegation(
 2889                dependencies.delegation,
 2890                request,
 2891                latest.content,
 2892                readDelegationArguments(request, latest.content),
 2893              ),
 2894            );
 2895          }
 2896        } else if (handed.kind !== "NONE") {
 2897          return recordAnswer(request, conversationId, handed.line);
 2898        }
 2899      }
 2900      // Where a requested series of questions stands, decided from the
```
