# Evidence: apps/q-api/src/composition/instructions/engine.ts lines 2340-2600

- Original path: `apps/q-api/src/composition/instructions/engine.ts`
- Line range: 2340-2600 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Firing: near-miss -> ASK NEAR_THE_BAR, HELD -> REFUSED BELOW_THE_BAR, fan-out cap, runStep HOLD/REFUSED/AUTO execution.

```ts
 2340                ...(counterpartId === undefined
 2341                  ? []
 2342                  : (material?.counterparts.get(counterpartId) ?? [])
 2343                ).map((fact) => `Their ${fact.label}: ${fact.text}`),
 2344              ].join("\n");
 2345              const outcome = await review.review(
 2346                { tenantId: row.tenant_id, userId: row.user_id },
 2347                { kind: "INSTRUCTION", id: row.id, goal: row.goal_text },
 2348                {
 2349                  principalName,
 2350                  counterpartName,
 2351                  channel: "CHAT",
 2352                  stage:
 2353                    thread?.lastFrom === "THEM" ||
 2354                    (subject !== null && paces.get(subject)?.lastFrom === "THEM")
 2355                      ? "REPLY"
 2356                      : sidesWritten(subject, recheckContext)
 2357                        ? "FOLLOW_UP"
 2358                        : "FIRST",
 2359                  purpose: `${step.words} (their standing instruction: ${row.goal_text})`,
 2360                  material: factsText,
 2361                  thread:
 2362                    (subject === null
 2363                      ? undefined
 2364                      : transcripts.get(subject)?.thread) ?? "",
 2365                  theirLatest:
 2366                    subject === null
 2367                      ? null
 2368                      : (transcripts.get(subject)?.theirLatest ?? null),
 2369                  body,
 2370                },
 2371                {
 2372                  recheck: (redrafted) =>
 2373                    messageProblem(
 2374                      withTextBody(verdict.input, redrafted),
 2375                      subject,
 2376                      recheckContext,
 2377                      step,
 2378                      verdict.verdict === "ASK" &&
 2379                        verdict.code === "MEETING_NEEDS_YES",
 2380                    ).problem,
 2381                  nearMiss: true,
 2382                },
 2383              );
 2384              graded.set(index, outcome);
 2385              logger?.info(
 2386                {
 2387                  instructionId: row.id,
 2388                  relationshipId: subject,
 2389                  verdict: outcome.verdict,
 2390                  reason: outcome.verdict === "HELD" ? outcome.reason : null,
 2391                  nearMiss:
 2392                    outcome.verdict === "HELD" && outcome.nearMiss === true,
 2393                  score: outcome.score,
 2394                  jobId: outcome.jobId,
 2395                  draftId: outcome.draftId,
 2396                },
 2397                "standing instruction draft reviewed",
 2398              );
 2399              if (outcome.verdict === "HELD" && outcome.nearMiss === true) {
 2400                // Tensorgate, 8 Oct: a good reply held just under the bar was
 2401                // lost. The best draft code had nothing against goes to the
 2402                // person as their card -- their yes, never sent by Q.
 2403                const offered = verdict.action.input.safeParse(
 2404                  withTextBody(verdict.input, outcome.body),
 2405                );
 2406                if (offered.success) {
 2407                  return {
 2408                    verdict: "ASK",
 2409                    action: verdict.action,
 2410                    input: offered.data,
 2411                    relationshipId: subject,
 2412                    code: "NEAR_THE_BAR",
 2413                  };
 2414                }
 2415              }
 2416              if (outcome.verdict === "HELD") {
 2417                noteRefusal(subject, "BELOW_THE_BAR");
 2418                return {
 2419                  verdict: "REFUSED",
 2420                  code: "BELOW_THE_BAR",
 2421                  relationshipId: subject,
 2422                };
 2423              }
 2424              const reparsed = verdict.action.input.safeParse(
 2425                withTextBody(verdict.input, outcome.body),
 2426              );
 2427              return reparsed.success
 2428                ? { ...verdict, input: reparsed.data }
 2429                : {
 2430                    verdict: "REFUSED",
 2431                    code: "BAD_ARGUMENTS",
 2432                    relationshipId: subject,
 2433                  };
 2434            }),
 2435          );
 2436        }
 2437
 2438        let done = 0;
 2439        let asked = 0;
 2440        const askedWords: string[] = [];
 2441        let refusedCount = 0;
 2442        // S8 fan-out: at most FANOUT_MAX people are acted for in one firing;
 2443        // steps for anyone beyond are left for the next firing (not recorded,
 2444        // so they can be planned again). Each person's steps run in order;
 2445        // different people's run side by side.
 2446        const steps = plan.steps;
 2447        const whoOf = (index: number): string => {
 2448          const verdict = verdicts[index];
 2449          if (
 2450            verdict?.relationshipId !== null &&
 2451            verdict?.relationshipId !== undefined
 2452          ) {
 2453            return verdict.relationshipId;
 2454          }
 2455          const raw = steps[index]?.argumentsJson ?? "";
 2456          const company = /"companyId"\s*:\s*"([^"]+)"/u.exec(raw)?.[1];
 2457          return company === undefined ? "" : `company:${company}`;
 2458        };
 2459        const groups = new Map<string, number[]>();
 2460        for (const index of verdicts.keys()) {
 2461          const who = whoOf(index);
 2462          groups.set(who, [...(groups.get(who) ?? []), index]);
 2463        }
 2464        const acting = [...groups.keys()].filter((who) => who !== "");
 2465        const allowed = new Set(acting.slice(0, FANOUT_MAX));
 2466        const deferred = acting
 2467          .slice(FANOUT_MAX)
 2468          .reduce((sum, who) => sum + (groups.get(who)?.length ?? 0), 0);
 2469        if (deferred > 0) {
 2470          logger?.info(
 2471            { instructionId: row.id, people: acting.length, deferred },
 2472            "standing instruction fan-out capped; the rest waits for the next firing",
 2473          );
 2474          // QA run 8a1d57b9: Tallyloom was skipped with no record. Who waits
 2475          // is said on their work page (a NOTED step, once per firing).
 2476          const nameOf = (who: string): string =>
 2477            (who.startsWith("company:")
 2478              ? people.find(
 2479                  (person) =>
 2480                    person.counterpartKind === "COMPANY" &&
 2481                    person.counterpartId === who.slice("company:".length),
 2482                )?.name
 2483              : people.find((person) => person.relationshipId === who)?.name
 2484            )?.slice(0, 80) ?? "someone";
 2485          const waiting = acting.slice(FANOUT_MAX).map(nameOf);
 2486          await store
 2487            .recordStep({
 2488              instruction: row,
 2489              runKey,
 2490              stepIndex: 199,
 2491              action: "q.note",
 2492              mode: "ASK",
 2493              status: "NOTED",
 2494              relationshipId: null,
 2495              words: `Next firing: ${waiting.join(", ")}. I act for at most ${String(FANOUT_MAX)} people at a time.`,
 2496              reasonCode: "FANOUT_NEXT_FIRING",
 2497              qActionId: null,
 2498              idempotencyKey: keyOf(199),
 2499            })
 2500            .catch(() => false);
 2501        }
 2502        const runStep = async (index: number): Promise<void> => {
 2503          const verdict = verdicts[index];
 2504          if (verdict === undefined) return;
 2505          const step = steps[index];
 2506          if (step === undefined) return;
 2507          const key = keyOf(index);
 2508          if (await store.stepDone(key)) return;
 2509          const record = (input: {
 2510            readonly status: "DONE" | "ASKED" | "REFUSED" | "FAILED" | "NOTED";
 2511            readonly mode: "AUTO" | "ASK";
 2512            readonly words: string;
 2513            readonly reasonCode: string | null;
 2514            readonly qActionId: string | null;
 2515            readonly messageId?: string | null | undefined;
 2516          }) =>
 2517            store.recordStep({
 2518              instruction: row,
 2519              runKey,
 2520              stepIndex: index,
 2521              action: step.action,
 2522              relationshipId: verdict.relationshipId,
 2523              idempotencyKey: key,
 2524              ...input,
 2525            });
 2526
 2527          if (verdict.verdict === "HOLD") {
 2528            // ADR 0050: Q held back; the person sees why, and nothing is
 2529            // replanned around it.
 2530            await record({
 2531              status: "NOTED",
 2532              mode: "ASK",
 2533              words: `Holding off: ${step.words} -- ${verdict.reason}.`,
 2534              reasonCode: `PACE_${verdict.code}`,
 2535              qActionId: null,
 2536            });
 2537            return;
 2538          }
 2539          if (verdict.verdict === "REFUSED") {
 2540            if (verdict.code === "NOT_CONNECTED_YET") {
 2541              // Founder rule: a message to someone who hasn't accepted is not
 2542              // even recorded as a step on their page; the replan was told.
 2543              logger?.info(
 2544                { instructionId: row.id, action: step.action },
 2545                "instruction step dropped: not connected yet",
 2546              );
 2547              return;
 2548            }
 2549            refusedCount += 1;
 2550            const words = REFUSAL_WORDS[verdict.code];
 2551            await record({
 2552              status: "REFUSED",
 2553              mode: "ASK",
 2554              words: `Didn't: ${step.words} -- ${words.reason}; ${words.instead}.`,
 2555              reasonCode: verdict.code,
 2556              qActionId: null,
 2557            });
 2558            return;
 2559          }
 2560          if (verdict.verdict === "AUTO" && !dependencies.autoEnabled) {
 2561            logger?.info(
 2562              { instructionId: row.id, action: step.action },
 2563              "instruction AUTO step asked: autonomy is off",
 2564            );
 2565          }
 2566          // A delegated message goes only once the reviewer passed it: with no
 2567          // grade (no reviewer, or not read), it is the person's card instead.
 2568          const unreviewed =
 2569            verdict.verdict === "AUTO" &&
 2570            verdict.delegationId !== undefined &&
 2571            verdict.action.name === "chat.message.send" &&
 2572            graded.get(index)?.verdict !== "PASSED";
 2573          if (
 2574            verdict.verdict === "AUTO" &&
 2575            dependencies.autoEnabled &&
 2576            !unreviewed
 2577          ) {
 2578            const context = {
 2579              actor,
 2580              idempotencyKey: key,
 2581              correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
 2582              surface: "Q" as const,
 2583            };
 2584            try {
 2585              // The declaration's own authorize step, then its one service
 2586              // call: the same command the person's own button runs.
 2587              const allowed = await verdict.action.authorize(
 2588                dependencies.ports,
 2589                context,
 2590                verdict.input,
 2591              );
 2592              if (!allowed.ok) {
 2593                refusedCount += 1;
 2594                await record({
 2595                  status: "REFUSED",
 2596                  mode: "AUTO",
 2597                  words: `Didn't: ${step.words} -- it isn't available to you right now.`,
 2598                  reasonCode: "NOT_AUTHORIZED",
 2599                  qActionId: null,
 2600                });
```
