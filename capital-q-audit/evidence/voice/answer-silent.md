# Evidence: packages/q-specialists/src/answer.ts (lines 2340-2463)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 2340-2463 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: heardAs re-read; spoken unclear turn -> SILENT; not addressed to Q -> no answer.

```ts
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
```

