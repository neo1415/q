# Evidence: apps/q-api/src/composition/instructions/engine.ts lines 2600-2860

- Original path: `apps/q-api/src/composition/instructions/engine.ts`
- Line range: 2600-2860 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Firing: AUTO run with idempotency key, ASK card creation, REPLY_WAITING notice, misleading 'nothing needs a reply' quiet note, NEEDS_YOU notice, cannot lines.

```ts
 2600                });
 2601                return;
 2602              }
 2603              const out = await verdict.action.run(
 2604                dependencies.ports,
 2605                context,
 2606                verdict.input,
 2607              );
 2608              done += 1;
 2609              const delegationId = verdict.delegationId;
 2610              if (delegationId !== undefined) {
 2611                // Done for you: recorded, audited and (a message) unsendable
 2612                // from Work for a short while.
 2613                const messageId = sentMessageId(out);
 2614                await record({
 2615                  status: "DONE",
 2616                  mode: "AUTO",
 2617                  words: `Done for you: ${step.words}`,
 2618                  reasonCode: "DELEGATED",
 2619                  qActionId: null,
 2620                  messageId,
 2621                });
 2622                await dependencies
 2623                  .auditDelegated?.({
 2624                    actor,
 2625                    delegationId,
 2626                    instructionId: row.id,
 2627                    action: step.action,
 2628                    relationshipId: verdict.relationshipId,
 2629                    idempotencyKey: key,
 2630                    messageId,
 2631                  })
 2632                  .catch((error: unknown) => {
 2633                    logger?.warn(
 2634                      { err: error, instructionId: row.id, delegationId },
 2635                      "delegated step audit not written",
 2636                    );
 2637                  });
 2638                const sentDraft = graded.get(index);
 2639                if (sentDraft !== undefined) {
 2640                  await review?.settle(
 2641                    { tenantId: row.tenant_id, userId: row.user_id },
 2642                    sentDraft,
 2643                    "SENT",
 2644                  );
 2645                }
 2646                return;
 2647              }
 2648              const sentDraft = graded.get(index);
 2649              if (sentDraft !== undefined) {
 2650                await review?.settle(
 2651                  { tenantId: row.tenant_id, userId: row.user_id },
 2652                  sentDraft,
 2653                  "SENT",
 2654                );
 2655              }
 2656              await record({
 2657                status: "DONE",
 2658                mode: "AUTO",
 2659                words: step.words,
 2660                reasonCode: null,
 2661                qActionId: null,
 2662              });
 2663            } catch (error: unknown) {
 2664              logger?.warn(
 2665                { err: error, instructionId: row.id, action: step.action },
 2666                "instruction step not applied",
 2667              );
 2668              await record({
 2669                status: "FAILED",
 2670                mode: "AUTO",
 2671                words: `Couldn't: ${step.words}`,
 2672                reasonCode: "NOT_APPLIED",
 2673                qActionId: null,
 2674              });
 2675            }
 2676            return;
 2677          }
 2678          // ASK: the card the person's own request would prepare -- unless
 2679          // the same card already waits on them.
 2680          if (isWaiting(step.action, verdict.relationshipId, step.words)) {
 2681            logger?.info(
 2682              { instructionId: row.id, action: step.action },
 2683              "instruction card not drafted again: one already waits",
 2684            );
 2685            return;
 2686          }
 2687          const card = await dependencies
 2688            .ask(actor, {
 2689              instructionId: row.id,
 2690              actionType: `app.${verdict.action.name}`,
 2691              payload: verdict.input,
 2692              words: step.words,
 2693              key,
 2694            })
 2695            .catch((error: unknown) => {
 2696              logger?.warn(
 2697                { err: error, instructionId: row.id, action: step.action },
 2698                "instruction card not prepared",
 2699              );
 2700              return null;
 2701            });
 2702          if (card === null) {
 2703            await record({
 2704              status: "FAILED",
 2705              mode: "ASK",
 2706              words: `Couldn't prepare for your approval: ${step.words}`,
 2707              reasonCode: "CARD_NOT_PREPARED",
 2708              qActionId: null,
 2709            });
 2710            return;
 2711          }
 2712          asked += 1;
 2713          askedWords.push(step.words);
 2714          const offeredDraft = graded.get(index);
 2715          if (offeredDraft !== undefined) {
 2716            await review?.settle(
 2717              { tenantId: row.tenant_id, userId: row.user_id },
 2718              offeredDraft,
 2719              "OFFERED",
 2720              card.qActionId,
 2721            );
 2722          }
 2723          const code =
 2724            verdict.verdict === "AUTO"
 2725              ? unreviewed
 2726                ? "NOT_REVIEWED"
 2727                : "AUTONOMY_OFF"
 2728              : verdict.code;
 2729          const why = code === null ? null : (ASK_WORDS[code] ?? null);
 2730          await record({
 2731            status: "ASKED",
 2732            mode: "ASK",
 2733            words: `Waiting for your yes${why === null ? "" : ` (${why})`}: ${step.words}`,
 2734            reasonCode: code,
 2735            qActionId: card.qActionId,
 2736          });
 2737        };
 2738        await Promise.all(
 2739          [...groups.entries()]
 2740            .filter(([who]) => who === "" || allowed.has(who))
 2741            .map(async ([, indexes]) => {
 2742              for (const index of indexes) await runStep(index);
 2743            }),
 2744        );
 2745  
 2746        // Tensorgate, 8 Oct: Zino's reply sat unanswered while the firing
 2747        // said "nothing to do" (every drafted reply was refused, and the last
 2748        // plan was empty). A message from them that this firing neither
 2749        // answered, nor carded, nor held, nor already put to the person goes
 2750        // to the person now -- with code's reason -- once per message of theirs.
 2751        const handled = new Set(
 2752          verdicts
 2753            .filter((verdict) => verdict.verdict !== "REFUSED")
 2754            .map((verdict) => verdict.relationshipId)
 2755            .filter((id): id is string => id !== null),
 2756        );
 2757        const waitingReplies = replyWaiting.filter(
 2758          (person) =>
 2759            person.relationshipId !== null && !handled.has(person.relationshipId),
 2760        );
 2761        for (const [offset, person] of waitingReplies.entries()) {
 2762          const id = person.relationshipId ?? "";
 2763          const since = paces.get(id)?.lastFromThemAt?.toISOString() ?? "unknown";
 2764          const name = person.name.slice(0, 80);
 2765          const codes = refusalCodes.get(id) ?? [];
 2766          const code = codes[codes.length - 1];
 2767          const why =
 2768            code === undefined
 2769              ? "my plan had no reply to them"
 2770              : REFUSAL_WORDS[code].reason;
 2771          // The codes themselves, so the person (and we) can see why.
 2772          const detail =
 2773            codes.length === 0 ? "NO_REPLY_PLANNED" : codes.join(", ");
 2774          const words = `${name}'s message is waiting for a reply. I couldn't answer it on my own: ${why} (${detail}). Reply in the chat, or tell me what to say and I'll send it.`;
 2775          logger?.info(
 2776            { instructionId: row.id, relationshipId: id, codes: detail },
 2777            "standing instruction reply waiting on the person",
 2778          );
 2779          await store
 2780            .recordStep({
 2781              instruction: row,
 2782              runKey,
 2783              stepIndex: 160 + offset,
 2784              action: "q.note",
 2785              mode: "ASK",
 2786              status: "NOTED",
 2787              relationshipId: id,
 2788              words,
 2789              reasonCode: "REPLY_WAITING",
 2790              qActionId: null,
 2791              idempotencyKey: `instr:${row.id}:reply-waiting:${id}:${since}`,
 2792            })
 2793            .catch(() => false);
 2794          await store
 2795            .notify({
 2796              instruction: row,
 2797              key: `reply-waiting:${id}:${since}`,
 2798              priority: "NEEDS_YOU",
 2799              title: `${name} is waiting for a reply`,
 2800              body: words,
 2801            })
 2802            .catch(() => false);
 2803        }
 2804        if (
 2805          plan.steps.length === 0 &&
 2806          plan.cannot.length === 0 &&
 2807          waitingReplies.length === 0
 2808        ) {
 2809          const covered = inScope(grant.data, people).length;
 2810          // Item 3 (Tensorgate): the line says why nothing was done.
 2811          const allRead = reachable.every(
 2812            (person) =>
 2813              person.relationshipId !== null && paces.has(person.relationshipId),
 2814          );
 2815          await note(
 2816            row,
 2817            "quiet",
 2818            covered === 0
 2819              ? "Nothing to work on yet: no one is in reach of this instruction. I'll look again later."
 2820              : reachable.length === 0
 2821                ? `Looked at ${String(covered)} ${covered === 1 ? "person" : "people"}: no one has accepted yet, so there's no conversation to answer. I'll look again when someone writes.`
 2822                : allRead
 2823                  ? `Looked at ${String(covered)} ${covered === 1 ? "person" : "people"}: no unanswered messages, so nothing to send right now. I'll look again when someone writes.`
 2824                  : `Looked at ${String(covered)} ${covered === 1 ? "person" : "people"}: nothing needs a reply right now. I'll look again when someone writes.`,
 2825            "NOTHING_TO_DO",
 2826          );
 2827        }
 2828  
 2829        // S7: what waits on them is a NEEDS_YOU notice at once.
 2830        const waiting = needsYouNotice({
 2831          goal: row.goal_text,
 2832          asked: askedWords,
 2833          overBudget: false,
 2834        });
 2835        if (waiting !== null) {
 2836          await store
 2837            .notify({
 2838              instruction: row,
 2839              key: `${runKey}:needs`,
 2840              priority: "NEEDS_YOU",
 2841              ...waiting,
 2842            })
 2843            .catch(() => false);
 2844        }
 2845  
 2846        // What no declared action can do: said now, with an alternative.
 2847        for (const [offset, entry] of plan.cannot.entries()) {
 2848          const index = 100 + offset;
 2849          await store.recordStep({
 2850            instruction: row,
 2851            runKey,
 2852            stepIndex: index,
 2853            action: "q.cannot",
 2854            mode: "ASK",
 2855            status: "REFUSED",
 2856            relationshipId: null,
 2857            words: `Can't ${entry.what}: ${entry.reason}. Instead: ${entry.instead}`,
 2858            reasonCode: "CANNOT",
 2859            qActionId: null,
 2860            idempotencyKey: keyOf(index),
```
