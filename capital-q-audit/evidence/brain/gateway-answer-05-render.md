# Evidence: packages/model-gateway/src/q/index.ts (lines 2350-2730)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 2350-2730 (HEAD 9177629d)
- Why included: Research tool filter, speculation gate, readiness, facts order, variables (conversation = all earlier messages), environment notes, renderPrompt, budget, streaming publish.

```ts
 2350        let offered =
 2351          research?.mode === "NEVER" && research.fallback !== true
 2352            ? offeredForRun.filter(
 2353                (tool) => tool.definition.name !== "research_public_web",
 2354              )
 2355            : offeredForRun;
 2356        const offeredByName = new Map(
 2357          offered.map((tool) => [tool.definition.name, tool] as const),
 2358        );
 2359        /**
 2360         * Every tool call this answer makes. While the answer is speculative
 2361         * only a READ_ONLY tool runs; any other (or one not known to be
 2362         * READ_ONLY) waits until the turn is read and the answer adopted, and
 2363         * never runs if it is cancelled.
 2364         */
 2365        const classificationOf = (name: string) =>
 2366          (
 2367            offered.find((tool) => tool.definition.name === name) ??
 2368            (availableForRun ?? offeredForRun).find(
 2369              (tool) => tool.definition.name === name,
 2370            )
 2371          )?.classification;
 2372        const callTool: QToolPort["execute"] = async (proposal, context) => {
 2373          if (
 2374            gate !== null &&
 2375            !gate.adopted() &&
 2376            classificationOf(proposal.name) !== "READ_ONLY"
 2377          ) {
 2378            logger?.info(
 2379              { qRunId: request.runId, tool: proposal.name },
 2380              "a speculative answer's tool call is held until the turn is read",
 2381            );
 2382            await gate.ready();
 2383          }
 2384          return tools.execute(proposal, context);
 2385        };
 2386        /** A visible stage: held with the answer's text while speculative. */
 2387        const stageShown = async (stage: QVisibleStage): Promise<void> => {
 2388          if (gate === null) await showStage(request, stage);
 2389          else gate.emit(() => showStage(request, stage));
 2390        };
 2391        /**
 2392         * A setup reminder (founder directive 2026-09-27), only at a natural
 2393         * pause: never while Q is putting a series of questions to them and
 2394         * never on a turn that could not be read. Due-ness is the policy's,
 2395         * under the same own-only scope; a failed read is simply no reminder.
 2396         */
 2397        let onboardingNudge: QOnboardingNudge | null = null;
 2398        const nudgeRead = (async (): Promise<void> => {
 2399          if (
 2400            dependencies.onboardingNudge !== undefined &&
 2401            request.questionSequence === undefined &&
 2402            request.turnUnread !== true &&
 2403            plan.scopes.some(
 2404              (scope) =>
 2405                scope.kind === "OWN_ONBOARDING" && scope.subject === undefined,
 2406            )
 2407          ) {
 2408            try {
 2409              onboardingNudge = await dependencies.onboardingNudge.peek(
 2410                request.actor,
 2411                conversationId,
 2412              );
 2413            } catch (error: unknown) {
 2414              logger?.warn(
 2415                { err: error, qRunId: request.runId },
 2416                "the setup reminder was not read for this answer",
 2417              );
 2418            }
 2419          }
 2420        })();
 2421        /**
 2422         * "What should I do next?" (ADVICE): their own readiness leads the
 2423         * answer (QA 2026-10-03, run 2cba241a). Read through read_my_record,
 2424         * under this plan, only for advice and own-record questions; a person
 2425         * with no company of their own gets nothing here.
 2426         */
 2427        let ownReadiness: AuthorisedFact | null = null;
 2428        const prefetchable = new Set(
 2429          offeredForRun.map((tool) => tool.definition.name),
 2430        );
 2431        if (
 2432          (request.questionKind === "ADVICE" ||
 2433            request.questionKind === "THEIR_OWN_RECORDS") &&
 2434          prefetchable.has("read_my_record")
 2435        ) {
 2436          const outcome = await callTool(
 2437            {
 2438              callId: "q-own-readiness",
 2439              name: "read_my_record",
 2440              arguments: { record: "MARKETPLACE_READINESS" },
 2441            },
 2442            toolContext,
 2443          ).catch(() => null);
 2444          if (outcome?.result.ok === true) {
 2445            const data = outcome.result.data as {
 2446              data?: { companyId?: unknown };
 2447            };
 2448            const ownCompanyId =
 2449              typeof data.data?.companyId === "string"
 2450                ? data.data.companyId
 2451                : null;
 2452            // It leads only when the question is not about someone else.
 2453            const aboutSomeoneElse =
 2454              counterparty !== undefined &&
 2455              !(
 2456                counterparty.kind === "COMPANY" &&
 2457                counterparty.companyId === ownCompanyId
 2458              );
 2459            ownReadiness = ownReadinessFact(outcome.result.data, {
 2460              lead: request.questionKind === "ADVICE" && !aboutSomeoneElse,
 2461              alreadySaid: request.leadLines !== undefined,
 2462            });
 2463          }
 2464          took("own-readiness");
 2465        }
 2466        // Read beside the readiness read above, not before it (L1).
 2467        await nudgeRead;
 2468        took("nudge");
 2469        const facts: readonly AuthorisedFact[] = [
 2470          // Their readiness first when it leads this answer.
 2471          ...(ownReadiness === null ? [] : [ownReadiness]),
 2472          ...onboardingFacts,
 2473          ...(ownProfile === null ? [] : [ownProfile]),
 2474          ...(onScreenCompany === null ? [] : [onScreenCompany]),
 2475          ...namedCompanies,
 2476          ...(onScreenDaily === null ? [] : [onScreenDaily]),
 2477          ...(onScreenDocument === null ? [] : [onScreenDocument]),
 2478          ...onScreenPage,
 2479          ...(ownDay === null ? [] : [ownDay]),
 2480          ...(relationship === null ? [] : [relationship]),
 2481          ...(ownStanding === null ? [] : [ownStanding]),
 2482          ...(ownIndex === null ? [] : [ownIndex]),
 2483          ...(pitchMoment === null ? [] : [pitchMoment]),
 2484          ...assembled.facts,
 2485        ];
 2486
 2487        const variables: Omit<
 2488          CompanyAnalystV4Variables,
 2489          | "operatingMode"
 2490          | "communicationProfile"
 2491          | "communicationGuidance"
 2492          | "environmentNotes"
 2493        > = {
 2494          capability: request.capability,
 2495          userMessage: latest.content,
 2496          conversation: earlier.map((m) => ({
 2497            role: m.role,
 2498            content: m.content,
 2499          })),
 2500          authorisedFacts: [...facts],
 2501          subjectDescription: assembled.subjectDescription,
 2502          institutionalNotes:
 2503            assembled.institutionalNotes ??
 2504            "Nothing was established in advance for this request.",
 2505          memory,
 2506          // Filled below, once the notes are composed.
 2507          turnNotes: "",
 2508        };
 2509        const personality = await personalityRead;
 2510        const asker = await askerRead;
 2511        const noteParts = environmentNoteParts(facts, offered, request.subjects, {
 2512          // Only when the firewall actually granted it. The plan has
 2513          // said so all along; nothing was reading it.
 2514          generalKnowledge: plan.scopes.some(
 2515            (scope) => scope.kind === "GENERAL_MODEL_KNOWLEDGE",
 2516          ),
 2517          ...(openDocumentTitle === undefined ? {} : { openDocumentTitle }),
 2518          ...(request.turnUnread === true ? { turnUnread: true } : {}),
 2519          ...(request.writingDocument === true ? { writingDocument: true } : {}),
 2520          ...(request.spoken === true ? { spoken: true } : {}),
 2521          ...(request.questionSequence === undefined
 2522            ? {}
 2523            : { questionSequence: request.questionSequence }),
 2524          ...(onboardingNudge === null ? {} : { onboardingNudge }),
 2525          ...(personality === null ? {} : { personality }),
 2526          ...(asker === null ? {} : { asker }),
 2527        });
 2528        // COMPANY_ANALYST v16 (prompt-cache order): this turn's notes ride in
 2529        // the task's tail and the charter keeps only what is the same from
 2530        // turn to turn; an earlier version still gets them all in the charter.
 2531        const notesInTail = registry
 2532          .getActive("COMPANY_ANALYST")
 2533          .definition.template.includes("{{turnNotes}}");
 2534        const environmentNotes = notesInTail
 2535          ? noteParts.standing
 2536          : joinedNoteParts(noteParts);
 2537        const etiquetteGuides = await etiquetteRead;
 2538        const rendered = renderPrompt<CompanyAnalystV4Variables>(registry, {
 2539          task: "COMPANY_ANALYST",
 2540          ...(etiquetteGuides === null
 2541            ? {}
 2542            : {
 2543                etiquette: {
 2544                  guides: etiquetteGuides,
 2545                  purpose: "STYLE_ONLY" as const,
 2546                },
 2547              }),
 2548          operatingMode: operatingModeForCapability(request.capability),
 2549          communicationProfile: profile,
 2550          environmentNotes,
 2551          variables: {
 2552            ...variables,
 2553            turnNotes: notesInTail ? noteParts.turn : "",
 2554          },
 2555        });
 2556        // Counted only when the note actually reached the model: the notes
 2557        // are bounded, and a reminder cut off was never offered.
 2558        const nudgeOffered =
 2559          onboardingNudge !== null &&
 2560          joinedNoteParts(noteParts).includes(
 2561            onboardingNudgeNote(onboardingNudge),
 2562          );
 2563
 2564        const budget = budgetForTaskClass(taskClass);
 2565        const base = {
 2566          taskClass,
 2567          sensitivity,
 2568          dataPosture,
 2569          budget,
 2570          attribution: {
 2571            tenantId: request.tenantId,
 2572            userId: request.actorUserId,
 2573            qRunId: request.runId,
 2574            // The request's own correlation id, so a model call is traceable
 2575            // to the HTTP request that caused it; the run id is already
 2576            // attributed separately above.
 2577            correlationId: request.correlationId,
 2578          },
 2579          ...(dependencies.tenantPolicy === undefined
 2580            ? {}
 2581            : { tenantPolicy: dependencies.tenantPolicy }),
 2582        };
 2583        /**
 2584         * The message is named before its text exists, so every fragment
 2585         * that goes out early and the message that is finally stored are
 2586         * one thing to whoever is reading.
 2587         */
 2588        const messageId = QMessageIdSchema.parse(randomUUID());
 2589
 2590        /**
 2591         * The answer, going out a sentence at a time as the model writes it.
 2592         *
 2593         * Three things have to be true of a fragment before a person can
 2594         * have it, and all three are why the unit is a sentence rather than
 2595         * a token. It has to be the ANSWER and not the JSON object around
 2596         * it, so it is read out of the document by key. It has to be whole,
 2597         * because the guard that removes an invented recommendation removes
 2598         * a sentence and cannot judge half of one. And it has to have been
 2599         * through those guards, because on a voice call it is about to be
 2600         * said out loud and nothing said can be unsaid.
 2601         *
 2602         * A turn that reaches for a tool publishes nothing: a tool call
 2603         * carries no text, and text that is not the analyst's object never
 2604         * matches the key. The last, unfinished sentence is never published
 2605         * either — it arrives with the completed message, which is the
 2606         * durable form and the one that decides what was said.
 2607         */
 2608        const partial = createPartialAnswerReader();
 2609        const cutter = createSentenceCutter();
 2610        let streamedText = "";
 2611        let seenText = "";
 2612        /**
 2613         * The answer's prose as far as it has been read, sentences finished
 2614         * or not. Kept apart from what was published because it has one
 2615         * more use: when the object around it is refused after the person
 2616         * has already heard it (below), this is the answer they heard.
 2617         */
 2618        let seenAnswer = "";
 2619        let firstSentence = true;
 2620        /**
 2621         * A sentence that only promises to act is held back until the next
 2622         * sentence shows it was not the last. Said at the end of an answer,
 2623         * "Give me a moment to look that up." is a promise nothing follows;
 2624         * the finished answer drops it, and so a listener must never have
 2625         * heard it. In the middle it is a sentence about a next step, and
 2626         * it is released the moment the answer goes on.
 2627         */
 2628        let heldPromise: string | null = null;
 2629        /** Code's lead list was the last thing said (see publish below). */
 2630        let leadListOpen = request.leadLines !== undefined;
 2631        /** When the person got the first sentence, from the seam's start. */
 2632        let firstPublishedMs: number | null = null;
 2633        /** Out now, or held with the speculation until it is adopted. */
 2634        const send = (delta: Parameters<QLiveDeltaBus["publish"]>[0]): void => {
 2635          if (gate === null) deltas?.publish(delta);
 2636          else gate.emit(() => deltas?.publish(delta));
 2637        };
 2638        const publish = (text: string): void => {
 2639          // Code's opening lines come first on every surface that listens to
 2640          // the stream (voice parity, lead 2026-10-03: a spoken "what should
 2641          // I do next?" heard the model's words and never the readiness
 2642          // lines the stored answer opens with).
 2643          if (firstPublishedMs === null && request.leadLines !== undefined) {
 2644            firstPublishedMs = Date.now() - startedAt;
 2645            for (const line of request.leadLines.split("\n")) {
 2646              const said = line.trim();
 2647              if (said.length === 0) continue;
 2648              streamedText += `${said} `;
 2649              send({
 2650                runId: request.runId,
 2651                tenantId: request.tenantId,
 2652                messageId,
 2653                text: `${said} `,
 2654              });
 2655            }
 2656          }
 2657          firstPublishedMs ??= Date.now() - startedAt;
 2658          streamedText += `${text} `;
 2659          send({
 2660            runId: request.runId,
 2661            tenantId: request.tenantId,
 2662            messageId,
 2663            text: `${text} `,
 2664          });
 2665        };
 2666        // Backed only by a screen move a tool of this run authorised.
 2667        // Or by cards that will render: the model's own card set begun in
 2668        // its object, or two or more fits this run computed (code lays those
 2669        // out when the model wrote none).
 2670        const caveats = createCaveatGuard();
 2671        const screenClaims = createScreenClaimGuard(
 2672          () =>
 2673            clientActionBlocks.some((block) => block.kind === "UI_INTENT") ||
 2674            seenText.includes('"answerCards":{') ||
 2675            runFits.read(request.runId).length >= 2,
 2676        );
 2677        const onTextDelta = (fragment: string): void => {
 2678          seenText += fragment;
 2679          const fresh = partial.push(seenText);
 2680          if (fresh.length === 0) {
 2681            return;
 2682          }
 2683          seenAnswer += fresh;
 2684          for (const sentence of cutter.push(fresh)) {
 2685            // The tool loop has already run, so the grounds -- if the
 2686            // model asked for them -- are known before the first sentence
 2687            // is published.
 2688            // Fact labels are rewritten before a sentence goes out, not only
 2689            // in the stored answer: on a voice call it is said aloud (H3b).
 2690            const sentenceGuarded = guardSentence(
 2691              citeAuthorisedFacts(sentence, facts),
 2692              firstSentence,
 2693              recommendationGrounds,
 2694            );
 2695            firstSentence = false;
 2696            // Nothing is "on your screen" unless a tool put it there (R0).
 2697            const guarded =
 2698              sentenceGuarded === null
 2699                ? null
 2700                : screenClaims.sentence(sentenceGuarded);
 2701            // One boilerplate disclaimer at most (lead live replay 2026-10-07).
 2702            const caveated = guarded === null ? null : caveats.sentence(guarded);
 2703            if (caveated === null || caveated.length === 0) {
 2704              continue;
 2705            }
 2706            // While code's lead list is what was last said, a sentence of
 2707            // the model's that only repeats one of its items is not said
 2708            // again (lead 2026-10-03; the stored answer drops it the same
 2709            // way, afterLeadLines).
 2710            let said = caveated;
 2711            if (leadListOpen && request.leadLines !== undefined) {
 2712              said = afterLeadLines(caveated, request.leadLines).trim();
 2713              // A bare item number cut off as its own sentence ("1.").
 2714              if (said.length === 0 || /^\d+[.)]$/u.test(said)) continue;
 2715              leadListOpen = false;
 2716            }
 2717            if (heldPromise !== null) {
 2718              publish(heldPromise);
 2719              heldPromise = null;
 2720            }
 2721            if (isEmptyPromise(said)) {
 2722              heldPromise = said;
 2723              continue;
 2724            }
 2725            publish(said);
 2726          }
 2727        };
 2728
 2729        const options: ModelGatewayExecuteOptions<CompanyAnalystV17Result> = {
 2730          signal: request.signal,
```
