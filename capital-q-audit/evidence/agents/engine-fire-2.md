# Evidence: apps/q-api/src/composition/instructions/engine.ts lines 2000-2340

- Original path: `apps/q-api/src/composition/instructions/engine.ts`
- Line range: 2000-2340 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Firing: question routing, replyWaiting computation, plan/validate/replan loop with REPLY nudge, start of reviewer grading.

```ts
 2000                .material(actor, inScope(grant.data, people))
 2001                .catch(() => null);
 2002  
 2003        // QA run 8a1d57b9: their question Q may not answer goes to the
 2004        // person at once, quoted (their words reach the person, never the
 2005        // planner), and is noted on /work. Once per message.
 2006        for (const [relationshipId, read] of facts) {
 2007          const verdict = questionVerdict(read, material?.sender.facts ?? null);
 2008          const question = questions.get(relationshipId);
 2009          if (
 2010            verdict === null ||
 2011            verdict === "ANSWERABLE" ||
 2012            question === undefined
 2013          ) {
 2014            continue;
 2015          }
 2016          const name = (
 2017            people.find((person) => person.relationshipId === relationshipId)
 2018              ?.name ?? "They"
 2019          ).slice(0, 80);
 2020          await store
 2021            .notify({
 2022              instruction: row,
 2023              key: `question:${question.messageId}`,
 2024              priority: "NEEDS_YOU",
 2025              title: `${name} asked something only you can answer`,
 2026              body: `"${question.text}"\n${QUESTION_WORDS[verdict]}`,
 2027            })
 2028            .catch(() => false);
 2029          await store
 2030            .recordStep({
 2031              instruction: row,
 2032              runKey,
 2033              stepIndex: 150,
 2034              action: "q.note",
 2035              mode: "ASK",
 2036              status: "NOTED",
 2037              relationshipId,
 2038              words: `Passed ${name}'s question to you: ${QUESTION_WORDS[verdict]}`,
 2039              reasonCode: "QUESTION_FOR_YOU",
 2040              qActionId: null,
 2041              idempotencyKey: `instr:${row.id}:question:${question.messageId}`,
 2042            })
 2043            .catch(() => false);
 2044        }
 2045  
 2046        await dependencies
 2047          .track?.(
 2048            { tenantId: row.tenant_id, userId: row.user_id },
 2049            { id: row.id, goal: row.goal_text },
 2050          )
 2051          .catch(() => undefined);
 2052  
 2053        // Tensorgate, 8 Oct: conversations where they wrote last and no one
 2054        // has answered -- matched, not declined, no card of ours waiting, and
 2055        // not a question code already put to the person. Code's read only.
 2056        const reachable = inScope(grant.data, people).filter(
 2057          (person) =>
 2058            person.relationshipId !== null &&
 2059            connectedFor(people, person.relationshipId),
 2060        );
 2061        const replyWaiting = reachable.filter((person) => {
 2062          const id = person.relationshipId;
 2063          if (id === null || paces.get(id)?.lastFrom !== "THEM") return false;
 2064          const read = facts.get(id);
 2065          if (read?.declined === true || awaiting?.has(id) === true) {
 2066            return false;
 2067          }
 2068          if (cardsWaiting.some((card) => card.relationship_id === id)) {
 2069            return false;
 2070          }
 2071          const verdict =
 2072            read === undefined
 2073              ? null
 2074              : questionVerdict(read, material?.sender.facts ?? null);
 2075          return !(
 2076            questions.has(id) &&
 2077            verdict !== null &&
 2078            verdict !== "ANSWERABLE"
 2079          );
 2080        });
 2081        const waitingIds = new Set(
 2082          replyWaiting
 2083            .map((person) => person.relationshipId)
 2084            .filter((id): id is string => id !== null),
 2085        );
 2086        // The founder's own earlier words in each waiting conversation: the
 2087        // person's facts (their traction, their offer), for the planner.
 2088        const ourWords = new Map(
 2089          [...waitingIds].map((id) => [
 2090            id,
 2091            ownWords(transcripts.get(id)?.thread),
 2092          ]),
 2093        );
 2094  
 2095        // Plan; validate; re-plan with the reasons at most twice -- and once
 2096        // more when a plan leaves a waiting reply unanswered (Tensorgate: the
 2097        // second kick's plan came back empty with Zino's message waiting).
 2098        let refusals = "None.";
 2099        let plan: InstructionPlanResult | null = null;
 2100        let verdicts: StepVerdict[] = [];
 2101        // Every code a conversation's steps were refused with, across the
 2102        // re-plans: a reply that never passed is said, with why.
 2103        const refusalCodes = new Map<string, RefusalCode[]>();
 2104        const noteRefusal = (id: string | null, code: RefusalCode) => {
 2105          if (id === null) return;
 2106          const codes = refusalCodes.get(id) ?? [];
 2107          if (!codes.includes(code)) refusalCodes.set(id, [...codes, code]);
 2108        };
 2109        let nudged = false;
 2110        let extra = 0;
 2111        for (let attempt = 0; attempt <= MAX_REPLANS + extra; attempt += 1) {
 2112          if (!(left >= micros(PLAN_MAX_COST_USD))) {
 2113            await pauseForBudget(row, grant.data, actor);
 2114            return empty("OVER_BUDGET");
 2115          }
 2116          const planned = await dependencies.plan(
 2117            {
 2118              tenantId: row.tenant_id,
 2119              userId: row.user_id,
 2120              instructionId: row.id,
 2121            },
 2122            {
 2123              principalName:
 2124                (await dependencies.principalName?.(actor).catch(() => null)) ??
 2125                "the person",
 2126              goal: row.goal_text,
 2127              grant: grantLines(grant.data, delegation),
 2128              sender: senderLines(material?.sender ?? null),
 2129              actions: actionLines(grant.data, dependencies.actions),
 2130              now: `${at.toISOString()} (their zone ${grant.data.workingHours.timeZone})`,
 2131              people: peopleLines(
 2132                inScope(grant.data, people),
 2133                sentBefore,
 2134                facts,
 2135                grant.data.topics,
 2136                material,
 2137                introduced,
 2138                { paces, now: at, timeZone: grant.data.workingHours.timeZone },
 2139                { waiting: waitingIds, ourWords },
 2140              ),
 2141              history: (
 2142                (history.length === 0
 2143                  ? "Nothing yet."
 2144                  : history
 2145                      .map(
 2146                        (step) =>
 2147                          `${step.created_at.toISOString()} ${step.status} ${step.action}: ${step.words}`,
 2148                      )
 2149                      .join("\n")
 2150                      .slice(-6_000)) +
 2151                (cardsWaiting.length === 0
 2152                  ? ""
 2153                  : `\nStill waiting for their approval (plan none of these again):\n${cardsWaiting
 2154                      .map(
 2155                        (card) =>
 2156                          `${card.action}${card.relationship_id === null ? "" : ` relationshipId ${card.relationship_id}`}: ${card.words}`,
 2157                      )
 2158                      .join("\n")
 2159                      .slice(0, 2_000)}`)
 2160              ).slice(-6_000),
 2161              refusals,
 2162            },
 2163            { maxCostUsd: left / 1_000_000 },
 2164          );
 2165          if (planned.costUsd > 0) {
 2166            left -= micros(planned.costUsd);
 2167            await store.addSpend(row.id, planned.costUsd);
 2168          }
 2169          plan = planned.plan;
 2170          if (plan === null) return empty("PLANNER_UNAVAILABLE");
 2171          const sent = new Map(sentBefore);
 2172          const sitting = new Map<string, number>();
 2173          // Each plan's count starts from what was done before this firing.
 2174          const delegatedNow = { count: delegatedToday.count };
 2175          const current = plan;
 2176          verdicts = current.steps.map((step, index) =>
 2177            validateStep(step, {
 2178              grant: grant.data,
 2179              actions: dependencies.actions,
 2180              people,
 2181              sent,
 2182              now: at,
 2183              stepKey: keyOf(index),
 2184              facts,
 2185              request: current.request,
 2186              material,
 2187              introduced,
 2188              pace: paces,
 2189              sitting,
 2190              awaiting,
 2191              delegation,
 2192              delegatedToday: delegatedNow,
 2193              threads,
 2194            }),
 2195          );
 2196          const refused = verdicts
 2197            .map((verdict, index) => ({ verdict, step: current.steps[index] }))
 2198            .filter(
 2199              (entry) =>
 2200                entry.verdict.verdict === "REFUSED" &&
 2201                entry.verdict.code !== "OUTSIDE_HOURS",
 2202            );
 2203          for (const { verdict } of refused) {
 2204            if (verdict.verdict === "REFUSED") {
 2205              noteRefusal(verdict.relationshipId, verdict.code);
 2206            }
 2207          }
 2208          // Each plan's verdicts at info level: code, action and the first
 2209          // words of a draft (Tensorgate: a run said nothing of why).
 2210          logger?.info(
 2211            {
 2212              instructionId: row.id,
 2213              attempt,
 2214              steps: current.steps.map((step, index) => ({
 2215                action: step.action,
 2216                verdict: verdicts[index]?.verdict ?? null,
 2217                code: verdicts[index]?.code ?? null,
 2218                relationshipId: verdicts[index]?.relationshipId ?? null,
 2219                draft: (textBody(safeJson(step.argumentsJson)) ?? "").slice(
 2220                  0,
 2221                  80,
 2222                ),
 2223              })),
 2224              replyWaiting: waitingIds.size,
 2225            },
 2226            "standing instruction plan checked",
 2227          );
 2228          const answered = new Set(
 2229            verdicts
 2230              .filter((verdict) => verdict.verdict !== "REFUSED")
 2231              .map((verdict) => verdict.relationshipId),
 2232          );
 2233          const unanswered = replyWaiting.filter(
 2234            (person) => !answered.has(person.relationshipId),
 2235          );
 2236          const last = attempt === MAX_REPLANS + extra;
 2237          if (
 2238            !nudged &&
 2239            unanswered.length > 0 &&
 2240            (refused.length === 0 || last)
 2241          ) {
 2242            // Once: the plan left a waiting message unanswered.
 2243            nudged = true;
 2244            if (last) extra += 1;
 2245            refusals = [
 2246              ...refused.map(
 2247                ({ verdict, step }) =>
 2248                  `${step?.action ?? "?"}: ${verdict.verdict === "REFUSED" ? verdict.code : ""}`,
 2249              ),
 2250              `NO REPLY PLANNED: ${unanswered
 2251                .map(
 2252                  (person) =>
 2253                    `${person.name.slice(0, 80)} (relationshipId ${person.relationshipId ?? ""})`,
 2254                )
 2255                .join(
 2256                  ", ",
 2257                )} wrote last and no one has answered. Write one REPLY chat.message.send to each now, following the rules: thank them, take up what they wrote about, one point from WHO YOU WRITE AS or what your side already said, and one soft offer.`,
 2258            ]
 2259              .join("\n")
 2260              .slice(0, 3_000);
 2261            continue;
 2262          }
 2263          if (refused.length === 0 || last) break;
 2264          refusals = refused
 2265            .map(
 2266              ({ verdict, step }) =>
 2267                `${step?.action ?? "?"}: ${verdict.verdict === "REFUSED" ? verdict.code : ""}`,
 2268            )
 2269            .join("\n")
 2270            .slice(0, 3_000);
 2271        }
 2272        if (plan === null) return empty("PLANNER_UNAVAILABLE");
 2273        // The engine's own abilities are never a "can't" (QA run 40021ae5:
 2274        // "Can't find founders" beside five found, "can't run every weekend"
 2275        // for the instruction that is the schedule): such lines are dropped.
 2276        plan = { ...plan, cannot: realCannots(plan.cannot) };
 2277  
 2278        // Founder brief J2: the reviewer grades each message before it is
 2279        // sent or offered. A redraft is re-checked by code's own message
 2280        // rules; a draft that never passes becomes a refusal, recorded with
 2281        // the reason, and is neither sent nor offered.
 2282        const graded = new Map<number, OutwardVerdict>();
 2283        const review = dependencies.review;
 2284        if (review !== undefined) {
 2285          const principalName =
 2286            (await dependencies.principalName?.(actor).catch(() => null)) ??
 2287            "the person";
 2288          const recheckContext: ValidationContext = {
 2289            grant: grant.data,
 2290            actions: dependencies.actions,
 2291            people,
 2292            sent: new Map(sentBefore),
 2293            now: at,
 2294            stepKey: "review",
 2295            facts,
 2296            request: plan.request,
 2297            material,
 2298            introduced,
 2299            pace: paces,
 2300            awaiting,
 2301            delegation,
 2302            threads,
 2303          };
 2304          const reviewedPlan = plan;
 2305          verdicts = await Promise.all(
 2306            verdicts.map(async (verdict, index): Promise<StepVerdict> => {
 2307              const step = reviewedPlan.steps[index];
 2308              if (
 2309                step === undefined ||
 2310                (verdict.verdict !== "AUTO" && verdict.verdict !== "ASK") ||
 2311                verdict.action.name !== "chat.message.send"
 2312              ) {
 2313                return verdict;
 2314              }
 2315              const body = textBody(verdict.input);
 2316              if (body === null || (await store.stepDone(keyOf(index)))) {
 2317                return verdict;
 2318              }
 2319              const subject = verdict.relationshipId;
 2320              const thread = subject === null ? undefined : facts.get(subject);
 2321              const counterpartId =
 2322                subject === null
 2323                  ? undefined
 2324                  : people.find((person) => person.relationshipId === subject)
 2325                      ?.counterpartId;
 2326              const counterpartName =
 2327                (subject === null
 2328                  ? undefined
 2329                  : people.find((person) => person.relationshipId === subject)
 2330                      ?.name) ?? "them";
 2331              const factsText = [
 2332                // Where this message is written, as a fact the reviewer may
 2333                // ground on (autopilot P1, live 2026-10-06: drafts scoring
 2334                // 75-97 were held as ungrounded for saying the sender came
 2335                // across them on Capital Q, which is simply where they are).
 2336                `Platform: ${principalName} writes inside Capital Q, where ${counterpartName} has a Capital Q profile; "Their" facts come from that profile and "Sender" facts are ${principalName}'s own declared mandate and profile.`,
 2337                ...(material?.sender.facts ?? []).map(
 2338                  (fact) => `Sender ${fact.label}: ${fact.text}`,
 2339                ),
 2340                ...(counterpartId === undefined
```
