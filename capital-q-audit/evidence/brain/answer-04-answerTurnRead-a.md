# Evidence: packages/q-specialists/src/answer.ts (lines 2240-2600)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 2240-2600 (HEAD 9177629d)
- Why included: Turn reading, retry, heardAs (v44), decide pending, earlierNotForQ, addressedToQ, UNCLEAR -> SILENT for spoken, reference/openReferenced/retryLast, profile gaps, actOnTool.

```ts
 2240        speculative.current = startSpeculation({
 2241          request: {
 2242            ...request,
 2243            research: Promise.resolve(speculativeResearch),
 2244            capabilities: manifestOf(capabilities),
 2245            turnKind: SPECULATIVE_READING.kind,
 2246            spoken: true,
 2247            // What a plain question's focus is (toolFocusOf): the purpose's
 2248            // list with the public-web tools leading, so the speculation
 2249            // holds the web exactly as the turn's own answer would.
 2250            toolFocus: { areas: [], tools: [...RESEARCH_TOOLS], widen: true },
 2251          },
 2252          answer: (shaped) => delegate.answer(shaped),
 2253          observe: (event) => {
 2254            logger?.info(
 2255              {
 2256                qRunId: event.runId,
 2257                speculation:
 2258                  event.outcome === "ADOPTED" ? "adopted" : "cancelled",
 2259                reason: event.reason,
 2260                decidedAfterMs: event.decidedAfterMs,
 2261              },
 2262              "q voice speculation",
 2263            );
 2264            dependencies.speculation?.observe?.(event);
 2265          },
 2266        });
 2267      }
 2268      const readTurn = () =>
 2269        turns.read(
 2270          turnReaderInput(
 2271            history,
 2272            latest,
 2273            actions,
 2274            {
 2275              tenantId: request.tenantId,
 2276              userId: request.actor.userId,
 2277              correlationId: request.correlationId,
 2278              signal: request.signal,
 2279            },
 2280            referenceNote(shown, lastAction),
 2281          ),
 2282        );
 2283      // Read early, beside the firewall (ADR 0035), with the same words, the
 2284      // same turns and the same actions as now: taken up only when all three
 2285      // match; anything else is read again here.
 2286      const early = prereads.get(request.runId);
 2287      prereads.delete(request.runId);
 2288      lastActions.delete(conversationId);
 2289      lastActions.set(conversationId, actionsKey(actions));
 2290      if (lastActions.size > MAX_CONVERSATIONS) {
 2291        const oldest = lastActions.keys().next().value;
 2292        if (oldest !== undefined) lastActions.delete(oldest);
 2293      }
 2294      const ready = early === undefined ? null : await early;
 2295      const earlyRead =
 2296        ready !== null &&
 2297        ready.messageId === latest.id &&
 2298        ready.actionsKey === actionsKey(actions)
 2299          ? await ready.reading
 2300          : null;
 2301      // A reading that failed is tried once more: the gateway has parked the
 2302      // provider that failed, so the second try goes to the fallback model.
 2303      // A request to make something must never be dropped because one model
 2304      // was down (B1, 2026-09-25).
 2305      let read = earlyRead ?? (await readTurn().catch(() => null));
 2306      let turnUnread = false;
 2307      if (read === null && request.signal?.aborted !== true) {
 2308        read = await readTurn().catch(() => null);
 2309        turnUnread = read === null;
 2310        logger?.warn(
 2311          { qRunId: request.runId, recovered: read !== null },
 2312          "a turn to Q was not read on the first try",
 2313        );
 2314      }
 2315      const research: Promise<QResearchDirective> = Promise.resolve(
 2316        read === null
 2317          ? NO_RESEARCH
 2318          : researchDirectiveFor(state, readingFromTurnReader(read), {
 2319              available: dependencies.researchAvailable ?? true,
 2320              aboutNamedOther: read.aboutNamedOther,
 2321            }),
 2322      );
 2323      if (read !== null) {
 2324        logger?.info(
 2325          {
 2326            qRunId: request.runId,
 2327            kind: read.kind,
 2328            confidence: read.confidence,
 2329            transcript: read.transcript,
 2330            question: read.question?.kind ?? null,
 2331            aboutNamedOther: read.aboutNamedOther,
 2332            addressedToQ: read.addressedToQ ?? true,
 2333            earlierNotForQ: read.earlierNotForQ ?? false,
 2334            research: (await research).mode,
 2335            tool: read.tool?.kind ?? null,
 2336          },
 2337          "q turn read",
 2338        );
 2339      }
 2340      // TURN_READER v44 (Zino live 2026-10-08 11:13): garbled speech read by
 2341      // sound. The likely words become their turn, recorded beside what the
 2342      // recogniser heard (kept, never overwritten), and the turn is answered
 2343      // from them; going silent let the voice ask "could you give me more
 2344      // detail?" about "find anything that needs my attention". Once per run.
 2345      const heardAs = spoken ? (read?.heardAs?.trim() ?? "") : "";
 2346      if (
 2347        heardAs.length > 0 &&
 2348        heardAs.toLowerCase() !== latest.content.trim().toLowerCase() &&
 2349        latest.utteranceRef !== undefined &&
 2350        read?.addressedToQ !== false &&
 2351        !reheard.has(request.runId)
 2352      ) {
 2353        speculative.current?.cancel("ACTED");
 2354        const utteranceRef = latest.utteranceRef;
 2355        await transactions.run((tx) =>
 2356          repositories.messages.insert(tx, {
 2357            tenantId: request.tenantId,
 2358            conversationId,
 2359            runId: request.runId,
 2360            role: "USER",
 2361            content: heardAs,
 2362            // Its own utterance, so it never supersedes the run's first line.
 2363            ...(utteranceRef.length <= 249
 2364              ? { utteranceRef: `${utteranceRef}:heard` }
 2365              : {}),
 2366          }),
 2367        );
 2368        logger?.info(
 2369          { qRunId: request.runId, kind: read?.kind ?? null },
 2370          "q read garbled speech by sound",
 2371        );
 2372        reheard.add(request.runId);
 2373        try {
 2374          return await answerTurn(request);
 2375        } finally {
 2376          reheard.delete(request.runId);
 2377        }
 2378      }
 2379      // A reading the speculation cannot be is known now: stop it at once
 2380      // rather than at the end of the path.
 2381      const misread = readingMisfit(read);
 2382      if (misread !== null) speculative.current?.cancel(misread);
 2383      if (decide !== undefined) {
 2384        const line = await decide(
 2385          read === null
 2386            ? null
 2387            : {
 2388                kind: read.kind,
 2389                addressedToQ: read.addressedToQ ?? true,
 2390                // A turn that asks for an action in its own right is a request,
 2391                // never a reply to the card (the reader named one, or a hand).
 2392                namesAction:
 2393                  (typeof read.askedAction === "string" &&
 2394                    read.askedAction.length > 0) ||
 2395                  appActionOf(read) !== null ||
 2396                  (read.tool ?? null) !== null ||
 2397                  (read.handOver ?? null) !== null,
 2398              },
 2399        );
 2400        if (line !== null) return recordAnswer(request, conversationId, line);
 2401      }
 2402      // Spoken words plainly meant for someone else (a call, a colleague,
 2403      // the room) are not a turn to Q: nothing is answered, nothing is
 2404      // recorded as theirs, and Q keeps listening (founder live 2026-09-29:
 2405      // answering the room made Q "talk to itself").
 2406      // The person said what came before was not for Q ("wasn't talking to
 2407      // you"): those lines -- theirs, since Q last spoke -- are kept out of
 2408      // what Q reads back from now on, context, readings and memory alike
 2409      // (founder live 2026-10-01). Nothing is deleted.
 2410      if (read !== null && read.earlierNotForQ === true) {
 2411        // What they said just before: their latest run of lines, and Q's
 2412        // reply to them if Q answered (live check 2026-10-01: Q's reply to
 2413        // a line not meant for it kept the line alive in context).
 2414        const before: string[] = [];
 2415        let seenTheirs = false;
 2416        for (let index = history.length - 1; index >= 0; index -= 1) {
 2417          const message = history[index];
 2418          if (message === undefined || message.id === latest.id) continue;
 2419          if (message.role === "USER") seenTheirs = true;
 2420          else if (seenTheirs) break;
 2421          before.push(message.id);
 2422          if (before.length >= 30) break;
 2423        }
 2424        await markNotForQ(request, conversationId, seenTheirs ? before : []);
 2425      }
 2426      if (spoken && read !== null && read.addressedToQ === false) {
 2427        // Not theirs to Q: kept out of what Q reads back, so a name said to
 2428        // someone else or a dictation never becomes context or memory.
 2429        await markNotForQ(request, conversationId, [latest.id]);
 2430        logger?.info({ qRunId: request.runId }, "q turn not addressed to Q");
 2431        return {
 2432          kind: "ANSWERED",
 2433          messageId: null,
 2434          modelPolicyVersion: "none",
 2435          promptBundleVersion: "none",
 2436        };
 2437      }
 2438      // Words that could not be made out are a transcription matter, not a
 2439      // question: no model is asked (it answered with a meta-statement).
 2440      // One brief prompt; a second unclear turn in a row gets silence, so
 2441      // the prompt is never repeated. A clear turn resets the count.
 2442      if (read !== null && isUnclearTurn(read)) {
 2443        const before = unclearInARow.get(conversationId) ?? 0;
 2444        unclearInARow.set(conversationId, before + 1);
 2445        // Spoken, an unclear turn is almost always the room, not the
 2446        // person: asking "say that again?" to background noise is Q talking
 2447        // to itself. Typed, it is a real message worth one prompt.
 2448        const reply = spoken
 2449          ? ({ kind: "SILENT" } as const)
 2450          : unclearTurnReply(read, before);
 2451        logger?.info(
 2452          { qRunId: request.runId, unclearInARow: before + 1, reply: reply.kind },
 2453          "q turn unclear",
 2454        );
 2455        return reply.kind === "PROMPT"
 2456          ? recordAnswer(request, conversationId, reply.line)
 2457          : {
 2458              kind: "ANSWERED",
 2459              messageId: null,
 2460              modelPolicyVersion: "none",
 2461              promptBundleVersion: "none",
 2462            };
 2463      }
 2464      unclearInARow.delete(conversationId);
 2465      // What the turn points back at (TURN_READER v40, follow-55): one record
 2466      // to open, or Q's last action again. Bound here by code to a record of
 2467      // theirs or to that action, before any screen is opened for the turn
 2468      // (Zino live 2026-10-04: "open the questions for…" opened the
 2469      // Documents list; "now try again" opened the profile page again).
 2470      const reference =
 2471        read !== null && read.confidence !== "LOW"
 2472          ? (read.reference ?? null)
 2473          : null;
 2474      if (reference !== null && reference.open !== null) {
 2475        const opened = await openReferenced(
 2476          request,
 2477          conversationId,
 2478          reference,
 2479          shown,
 2480          history,
 2481        );
 2482        if (opened !== null) return opened;
 2483      }
 2484      if (
 2485        reference !== null &&
 2486        reference.retryLast &&
 2487        lastAction !== null &&
 2488        dependencies.appActions !== undefined &&
 2489        dependencies.appActions.tools.has(lastAction.tool)
 2490      ) {
 2491        const again = await repeatLastAction(
 2492          request,
 2493          conversationId,
 2494          lastAction,
 2495          reference.sameFor,
 2496        );
 2497        if (again !== null) return again;
 2498      }
 2499      // A LOW reading is a guess, and a guess never moves anybody's screen or
 2500      // prepares a change: it is answered like any other turn. A document
 2501      // asked for "from what you can find publicly" may be read as a
 2502      // research request as much as a tool request; either way it is a
 2503      // request for the document, and the document is what they get.
 2504      const tool =
 2505        read !== null &&
 2506        read.confidence !== "LOW" &&
 2507        (read.kind === "TOOL_REQUEST" ||
 2508          (read.kind === "RESEARCH_REQUEST" &&
 2509            read.tool?.kind === "PREPARE_DOCUMENT"))
 2510          ? read.tool
 2511          : null;
 2512      // A piece Q writes for them as a document (Q_REPORT) is answered
 2513      // first and filed after; any other document asked with it is made
 2514      // then too, in the same follow-up.
 2515      const documents =
 2516        tool?.kind === "PREPARE_DOCUMENT"
 2517          ? [tool, ...(read?.moreDocuments ?? [])]
 2518          : [];
 2519      const writingDocument =
 2520        artifacts !== undefined &&
 2521        documents.some((document) => document.documentType === "Q_REPORT");
 2522      // Permission to put what research finds into their own profile
 2523      // (TURN_READER v27, by meaning): code fills the open fields and
 2524      // prepares one change; the answer model is not asked (live
 2525      // 2026-10-02, Nixo: it lectured about verification instead).
 2526      if (
 2527        dependencies.profileGaps !== undefined &&
 2528        read !== null &&
 2529        read.confidence !== "LOW" &&
 2530        read.saveToOwnProfile === true &&
 2531        !writingDocument
 2532      ) {
 2533        const filled = await dependencies.profileGaps
 2534          .fill(request)
 2535          .catch((error: unknown) => {
 2536            logger?.warn(
 2537              { err: error, qRunId: request.runId },
 2538              "profile gaps were not filled; answering normally",
 2539            );
 2540            return null;
 2541          });
 2542        if (filled !== null) {
 2543          logger?.info(
 2544            { qRunId: request.runId },
 2545            "their profile's gaps were filled by code, not by the answer",
 2546          );
 2547          return recordAnswer(request, conversationId, filled.line);
 2548        }
 2549      }
 2550      // SET_VISIBILITY is the company's hand (parity eval 2026-10-02, run
 2551      // 1ec08a4b: "make our fund visible to founders" was read as it, and an
 2552      // investor was told Q changes who sees a company). With no company in
 2553      // this run and the fund's own visibility action offered, the request is
 2554      // that action's, filled from their words below.
 2555      const fundVisibility =
 2556        tool?.kind === "SET_VISIBILITY" &&
 2557        !request.subjects.some((subject) => subject.kind === "COMPANY") &&
 2558        offeredNames.has(INVESTOR_VISIBILITY_TOOL) &&
 2559        (dependencies.appActions?.tools.has(INVESTOR_VISIBILITY_TOOL) ?? false);
 2560      // SET_VISIBILITY read for words that name a deck or a pitch of theirs:
 2561      // that record's own action, when this run offers it.
 2562      const audienceTool =
 2563        tool?.kind === "SET_VISIBILITY"
 2564          ? recordAudienceTool(latest.content)
 2565          : null;
 2566      const recordAudience =
 2567        audienceTool !== null &&
 2568        offeredNames.has(audienceTool) &&
 2569        (dependencies.appActions?.tools.has(audienceTool) ?? false)
 2570          ? audienceTool
 2571          : null;
 2572      if (
 2573        tool !== null &&
 2574        !writingDocument &&
 2575        !fundVisibility &&
 2576        recordAudience === null
 2577      ) {
 2578        const acted = await actOnTool(
 2579          request,
 2580          conversationId,
 2581          tool,
 2582          history,
 2583          manifestOf(capabilities).navigate,
 2584          read?.moreDocuments ?? [],
 2585          capabilities.some(
 2586            (capability) =>
 2587              capability.performedBy.kind === "TOOL" &&
 2588              capability.performedBy.providerName === "open_page",
 2589          ),
 2590        );
 2591        if (acted !== null) {
 2592          remember(
 2593            conversationId,
 2594            reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
 2595          );
 2596          return acted;
 2597        }
 2598      }
 2599      // A declared app action the reading names (ADR 0040): code runs its
 2600      // generated tool, with its own authorize step and approval card, and
```
