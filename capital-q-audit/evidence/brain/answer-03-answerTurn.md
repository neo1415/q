# Evidence: packages/q-specialists/src/answer.ts (lines 1960-2240)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 1960-2240 (HEAD 9177629d)
- Why included: answerTurn entry: history 64, pending decisions, screenActOf, pageAnswer, speculation start.

```ts
 1960    const answerTurn = async (
 1961      request: QAnswerRequest,
 1962    ): Promise<QAnswerOutcome> => {
 1963      // The conversational path's reads (conversation, context, tools, the
 1964      // person's own facts) start now, beside the reading below; the answer
 1965      // takes them up if the turn goes there (speed sweep 2026-10-01: the
 1966      // reading's ~1 s and those reads' ~0.5-1 s ran one after the other).
 1967      delegate.warm?.(request);
 1968      // What this run can do, read beside the conversation rather than after
 1969      // it (latency2): the turn reader is told its actions, so the reading
 1970      // could not start until both were in.
 1971      const capabilitiesRead = capabilitiesOf(request);
 1972      capabilitiesRead.catch(() => undefined);
 1973      const history = await repositories.messages.listRecentForConversationOfRun(
 1974        sql,
 1975        request.tenantId,
 1976        request.runId,
 1977        64,
 1978      );
 1979      const conversationId = history[0]?.conversationId;
 1980      const latest = [...history].reverse().find((m) => m.role === "USER");
 1981      if (
 1982        turns === undefined ||
 1983        conversationId === undefined ||
 1984        latest === undefined
 1985      ) {
 1986        return answerOnce(request);
 1987      }
 1988      // A change waiting for their decision is decided by code, from two
 1989      // readings of their words, never by the answer's own tools: the turn's
 1990      // (is this a reply to the card at all?) and the decision's (yes or
 1991      // no?). Run 2026-10-03 ad0b0067: "We've decided not to proceed with
 1992      // Ledgefold for now." -- a request in its own right -- approved and
 1993      // executed the waiting pass. Only a reply decides.
 1994      let afterAnswer: string | null = null;
 1995      /** The card the after-answer line is about, when it is one. */
 1996      let afterAbout: string | null = null;
 1997      let afterAboutId: string | null = null;
 1998      const pendingDecisions = dependencies.pendingDecisions;
 1999      // Begun now, beside the turn reading (L1 latency sweep): the decision
 2000      // reader's call no longer waits for the turn reader's; both are judged
 2001      // together once the turn has been read, exactly as before.
 2002      const pending =
 2003        pendingDecisions === undefined
 2004          ? undefined
 2005          : startPendingDecision(
 2006              pendingDecisions,
 2007              {
 2008                context: {
 2009                  actor: request.actor,
 2010                  runId: request.runId,
 2011                  correlationId: request.correlationId,
 2012                  tenantId: request.tenantId,
 2013                  userId: request.actor.userId,
 2014                },
 2015                utterance: latest.content,
 2016                recentTurns: history
 2017                  .filter((m) => m.id !== latest.id)
 2018                  .slice(-6)
 2019                  .map((m) => ({
 2020                    role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
 2021                    text: m.content,
 2022                  })),
 2023                signal: request.signal,
 2024              },
 2025              { speculative: true },
 2026            );
 2027      let concluded = false;
 2028      const decide =
 2029        pending === undefined
 2030          ? undefined
 2031          : async (turn: PendingTurnReading | null): Promise<string | null> => {
 2032              concluded = true;
 2033              const decided = await pending
 2034                .conclude(turn)
 2035                .catch((error: unknown) => {
 2036                  logger?.warn(
 2037                    { err: error, qRunId: request.runId },
 2038                    "a decision on a waiting change was not read; answering normally",
 2039                  );
 2040                  return { kind: "NONE" } as const;
 2041                });
 2042              if (decided.kind === "REPLY") return decided.line;
 2043              if (decided.kind === "ANSWER_THEN") {
 2044                if (decided.before !== null) {
 2045                  await recordAnswer(request, conversationId, decided.before);
 2046                }
 2047                afterAnswer = decided.after;
 2048                afterAbout = decided.about ?? null;
 2049                afterAboutId = decided.aboutId ?? null;
 2050              }
 2051              return null;
 2052            };
 2053      // Decided after the turn is read (J7): whether the words are a reply
 2054      // at all is the decision reader's and the turn reader's reading, never
 2055      // a list of yes and no words. The two readings are made per turn.
 2056      const decideAfterReading = decide;
 2057      const speculative: { current: Speculation | null } = { current: null };
 2058      const outcome = await answerTurnRead(
 2059        request,
 2060        history,
 2061        conversationId,
 2062        latest,
 2063        capabilitiesRead,
 2064        speculative,
 2065        decideAfterReading,
 2066      ).finally(() => {
 2067        // A path that never asked: the reading in flight is not wanted.
 2068        if (!concluded) pending?.cancel();
 2069        // Any path that did not adopt the speculation drops it (a no-op once
 2070        // adopted): nothing of it is said, stored or done.
 2071        speculative.current?.cancel("ACTED");
 2072      });
 2073      // One status per card per answer: a card this turn handed to the
 2074      // engine is named by the engine's own line, never also "still waiting".
 2075      const prepared = preparedThisRun.get(request.runId);
 2076      preparedThisRun.delete(request.runId);
 2077      if (
 2078        afterAnswer !== null &&
 2079        afterAbout !== null &&
 2080        prepared !== undefined &&
 2081        sameCard(prepared, afterAbout)
 2082      ) {
 2083        afterAnswer = null;
 2084      }
 2085      if (afterAnswer !== null && outcome.kind === "ANSWERED") {
 2086        // What the change's real status is, after whatever the answer said
 2087        // about it: from the engine, never from the model's words. Deferred
 2088        // to after the engine's step when composed (runs a05becfe,
 2089        // a5121124): a card this turn superseded or was is not "still
 2090        // waiting".
 2091        if (dependencies.waitingLines !== undefined && afterAboutId !== null) {
 2092          dependencies.waitingLines.defer(request.runId, {
 2093            line: afterAnswer,
 2094            actionId: afterAboutId,
 2095          });
 2096        } else {
 2097          await recordAnswer(request, conversationId, afterAnswer);
 2098        }
 2099      }
 2100      return outcome;
 2101    };
 2102
 2103    const answerTurnRead = async (
 2104      request: QAnswerRequest,
 2105      history: readonly QConversationMessage[],
 2106      conversationId: QConversationMessage["conversationId"],
 2107      latest: QConversationMessage,
 2108      capabilitiesRead: Promise<readonly QCapability[]>,
 2109      /** The speculative answer started for a spoken turn, if one was. */
 2110      speculative: { current: Speculation | null },
 2111      /** A waiting change, decided from this turn's reading; a line ends the turn. */
 2112      decide?: (turn: PendingTurnReading | null) => Promise<string | null>,
 2113    ): Promise<QAnswerOutcome> => {
 2114      if (turns === undefined) return answerOnce(request);
 2115      const state =
 2116        conversations.get(conversationId) ?? INITIAL_CONVERSATION_STATE;
 2117      /*
 2118       * The reading is awaited before anything is answered (CQ-QACT-001).
 2119       * It used to run beside the answer and decide only research, which
 2120       * left "take me to Discover" and "make my company visible" to the
 2121       * answer's own reading — one that has no word for either, so the
 2122       * first was told to navigate itself and the second became a deck.
 2123       * A request for one of Q's own hands is now acted on from this
 2124       * reading, through the capability the screen uses; the specialist
 2125       * path already waited on it, so only the conversational path pays
 2126       * the one classification it was already making.
 2127       */
 2128      // What this run can do, from the capability registry (R20), once per
 2129      // turn and cached by composition. The reader is told the actions the
 2130      // answer's model takes, or "make a Q card" reads as a document.
 2131      const capabilities = await capabilitiesRead;
 2132      // R20/R33: every tool that changes something is an action to the
 2133      // reader (a Prepare → Approve change, the app's own action in their
 2134      // browser, a Save or Pass): "reload the page" is not a screen.
 2135      // The declared app actions lead (parity eval 2026-10-02: Save and Pass
 2136      // sat last in a long list, past the reader's cut, so "pass on Ajopot"
 2137      // was read as propose_interest_answer and nothing was done).
 2138      const appToolNames = dependencies.appActions?.tools ?? new Set<string>();
 2139      const offeredActions = capabilities
 2140        .flatMap((capability) =>
 2141          capability.performedBy.kind === "TOOL" && capability.acts
 2142            ? [
 2143                {
 2144                  name: capability.performedBy.providerName,
 2145                  does: capability.does,
 2146                  ...labelOf(capability),
 2147                },
 2148              ]
 2149            : [],
 2150        )
 2151        .sort(
 2152          (a, b) =>
 2153            Number(appToolNames.has(b.name)) - Number(appToolNames.has(a.name)),
 2154        );
 2155      // ADR 0040 parity: what the registry declares that this run does not
 2156      // offer, marked, so the reader can name what was asked (askedAction)
 2157      // and code can tell "not called" from "missing from the registry".
 2158      const offeredNames = new Set(offeredActions.map((action) => action.name));
 2159      const actions: readonly ReaderAction[] = [
 2160        ...offeredActions,
 2161        ...Q_CAPABILITIES.flatMap((capability) =>
 2162          capability.performedBy.kind === "TOOL" &&
 2163          capability.acts &&
 2164          !offeredNames.has(capability.performedBy.providerName)
 2165            ? [
 2166                {
 2167                  name: capability.performedBy.providerName,
 2168                  does: capability.does,
 2169                  available: false,
 2170                  ...labelOf(capability),
 2171                },
 2172              ]
 2173            : [],
 2174        ),
 2175      ];
 2176      // Spoken turns carry the recogniser's utterance; typed ones never do.
 2177      // The reader needs to know which: only speech can be overheard.
 2178      const spoken = latest.utteranceRef !== undefined;
 2179      // What Q showed and last did, for "that one" and "try again".
 2180      const shown = shownItems(history);
 2181      const lastAction = lastActed.get(conversationId) ?? null;
 2182      // A bare screen command ("scroll down", "go back") is done at once in
 2183      // code, like the wake words: it needs no reading, no model and no view
 2184      // of the screen (founder 2026-10-06: Q said it could not scroll
 2185      // because it could not see the page). Anything more than the command
 2186      // goes to the normal path.
 2187      const screenAct = screenActOf(latest.content);
 2188      if (screenAct !== null) {
 2189        logger?.info(
 2190          { qRunId: request.runId, act: screenAct.act },
 2191          "q is working the screen",
 2192        );
 2193        return recordAnswer(request, conversationId, screenAct.said, [
 2194          {
 2195            kind: "UI_INTENT",
 2196            intent: { kind: "SCREEN_ACT", act: screenAct.act },
 2197          },
 2198        ]);
 2199      }
 2200      // voice-cards: a page asked for by name is opened by code from one
 2201      // route table, before any model ("take me to the explore page" went to
 2202      // Discover twice when the reader chose); a page Capital Q lacks is said
 2203      // so, and "the third company on the list" is the card on screen.
 2204      const paged = pageAnswer(latest.content, history, capabilities);
 2205      if (paged !== null) {
 2206        logger?.info(
 2207          { qRunId: request.runId, page: paged.log },
 2208          "q opened a page by name",
 2209        );
 2210        return recordAnswer(request, conversationId, paged.said, paged.blocks);
 2211      }
 2212      saidInRun.set(request.runId, latest.content);
 2213      while (saidInRun.size > PREREADS_MAX) {
 2214        const oldest = saidInRun.keys().next().value;
 2215        if (oldest === undefined) break;
 2216        saidInRun.delete(oldest);
 2217      }
 2218      // Voice speculation (latency2): a spoken question's answer starts now,
 2219      // under the default reading, beside the reading below. Only where the
 2220      // conversational path answers it whatever the reading (no company in
 2221      // question, or a pitch being watched), and never for a turn the
 2222      // default cannot be: a web address is research, setup and a question
 2223      // series carry their own notes.
 2224      const speculativeResearch = researchDirectiveFor(
 2225        state,
 2226        readingFromTurnReader(SPECULATIVE_READING),
 2227        { available: dependencies.researchAvailable ?? true },
 2228      );
 2229      if (
 2230        dependencies.speculation?.spoken === true &&
 2231        spoken &&
 2232        request.speculation === undefined &&
 2233        request.signal?.aborted !== true &&
 2234        (request.plan.viewing !== undefined ||
 2235          !request.subjects.some((subject) => subject.kind === "COMPANY")) &&
 2236        !namesWebAddress(latest.content) &&
 2237        request.plan.screen?.route !== "ONBOARDING" &&
 2238        !sequences.has(conversationId)
 2239      ) {
 2240        speculative.current = startSpeculation({
```
