# Evidence: packages/model-gateway/src/q/index.ts (lines 1960-2350)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 1960-2350 (HEAD 9177629d)
- Why included: Own day (schedule, approvals, Q work), relationship, own index, pitch moment, onboarding; answer() start, personality/asker/etiquette reads.

```ts
 1960      const ownDayCalls: QToolCallObservation[] = [];
 1961      const dayRead = (async (): Promise<void> => {
 1962        if (!prefetchTools.has("list_schedule")) return;
 1963        const read = async (name: string): Promise<unknown> => {
 1964          if (!prefetchTools.has(name)) return null;
 1965          const outcome = await tools
 1966            .execute(
 1967              { callId: `q-own-day-${name}`, name, arguments: {} },
 1968              toolContext,
 1969            )
 1970            .catch(() => null);
 1971          if (outcome === null) return null;
 1972          ownDayCalls.push({
 1973            toolName: outcome.toolName,
 1974            providerName: name,
 1975            status: outcome.status,
 1976            failureCode: outcome.failureCode,
 1977            latencyMs: outcome.latencyMs,
 1978          });
 1979          return outcome.result.ok ? outcome.result.data : null;
 1980        };
 1981        const [schedule, approvals, work, own] = await Promise.all([
 1982          read("list_schedule"),
 1983          read("list_pending_approvals"),
 1984          read("list_q_work"),
 1985          dependencies.ownDay?.(request.actor).catch(() => null) ?? null,
 1986        ]);
 1987        const device = plan.screen?.timeZone;
 1988        const zone =
 1989          own?.timeZone ??
 1990          (device !== undefined &&
 1991          isKnownZone(device) &&
 1992          !/^(Etc\/)?(UTC|UCT|GMT|Universal|Zulu|Greenwich)$/i.test(device)
 1993            ? device
 1994            : null);
 1995        ownDay = ownDayFact({
 1996          now: new Date(),
 1997          timeZone: zone,
 1998          schedule,
 1999          approvals,
 2000          work,
 2001          rehearsals: own?.rehearsals ?? [],
 2002        });
 2003      })();
 2004      const relationshipRead = (async (): Promise<void> => {
 2005        if (counterparty !== undefined && prefetchTools.has("get_relationship")) {
 2006          const call = {
 2007            callId: "q-relationship",
 2008            name: "get_relationship",
 2009            arguments:
 2010              counterparty.kind === "RELATIONSHIP"
 2011                ? { relationshipId: counterparty.relationshipId }
 2012                : counterparty.kind === "COMPANY"
 2013                  ? { companyId: counterparty.companyId }
 2014                  : counterparty.kind === "INVESTOR_ORGANISATION"
 2015                    ? {
 2016                        investorOrganisationId:
 2017                          counterparty.investorOrganisationId,
 2018                      }
 2019                    : {},
 2020          };
 2021          const outcome = await tools.execute(call, toolContext);
 2022          relationshipCall = {
 2023            toolName: outcome.toolName,
 2024            providerName: call.name,
 2025            status: outcome.status,
 2026            failureCode: outcome.failureCode,
 2027            latencyMs: outcome.latencyMs,
 2028          };
 2029          if (outcome.result.ok) {
 2030            relationship = relationshipFact(outcome.result.data);
 2031          }
 2032        }
 2033      })();
 2034      let ownStanding: AuthorisedFact | null = null;
 2035      let ownStandingCall: QToolCallObservation | null = null;
 2036      let ownIndex: AuthorisedFact | null = null;
 2037      const indexDone = (async (): Promise<void> => {
 2038        if (dependencies.ownIndex === undefined) return;
 2039        const index = await dependencies
 2040          .ownIndex({ actor: request.actor, runId: request.runId, plan })
 2041          .catch(() => null);
 2042        ownIndex = ownIndexFact(index);
 2043      })();
 2044      const standingDone = (async (): Promise<void> => {
 2045        if (standingRead !== null) {
 2046          const outcome = await standingRead.catch(() => null);
 2047          if (outcome !== null) {
 2048            ownStandingCall = {
 2049              toolName: outcome.toolName,
 2050              providerName: "list_my_relationships",
 2051              status: outcome.status,
 2052              failureCode: outcome.failureCode,
 2053              latencyMs: outcome.latencyMs,
 2054            };
 2055            if (outcome.result.ok) {
 2056              const onScreen =
 2057                counterparty?.kind === "COMPANY"
 2058                  ? counterparty.companyId
 2059                  : counterparty?.kind === "INVESTOR_ORGANISATION"
 2060                    ? counterparty.investorOrganisationId
 2061                    : null;
 2062              // Their companies this message names, as typed or as heard
 2063              // ("TALUM" for Tallyloom; live 2026-10-02), are the turn's
 2064              // focus too: each gets its direction line.
 2065              const named = companiesNamedIn(
 2066                latest.content,
 2067                knownCompaniesOf(outcome.result.data),
 2068              ).map((company) => company.companyId);
 2069              ownStanding = ownStandingFact(outcome.result.data, [
 2070                ...(onScreen === null ? [] : [onScreen]),
 2071                ...named.filter((id) => id !== onScreen),
 2072              ]);
 2073            }
 2074          }
 2075        }
 2076      })();
 2077      /**
 2078       * Where the person is in the pitch they are watching, and what is
 2079       * said there (R18). Only when the plan carries the viewing moment --
 2080       * the Q API authorised that pitch for this person and the firewall
 2081       * bound its company -- and read through get_pitch_moment itself, so
 2082       * the media context applies the playback rule once more. A refusal
 2083       * adds nothing; no transcript adds a fact that says so.
 2084       */
 2085      let pitchMoment: AuthorisedFact | null = null;
 2086      const pitchRead = (async (): Promise<void> => {
 2087        if (plan.viewing !== undefined && prefetchTools.has("get_pitch_moment")) {
 2088          const outcome = await tools.execute(
 2089            {
 2090              callId: "q-pitch-moment",
 2091              name: "get_pitch_moment",
 2092              arguments: {
 2093                pitchId: plan.viewing.mediaAssetId,
 2094                atSeconds: plan.viewing.positionSeconds,
 2095                windowSeconds: 20,
 2096              },
 2097            },
 2098            toolContext,
 2099          );
 2100          if (outcome.result.ok) {
 2101            pitchMoment = pitchMomentFact(outcome.result.data, null);
 2102          }
 2103        }
 2104      })();
 2105      /**
 2106       * Who they are, from their own setup (CQ-QX-007): their name, the
 2107       * role they gave, and how far along they are. Only when the firewall
 2108       * granted OWN_ONBOARDING, which it grants to nobody but the person;
 2109       * a read that fails costs this answer the facts, never the answer.
 2110       */
 2111      let onboardingFacts: readonly AuthorisedFact[] = [];
 2112      const onboardingRead = (async (): Promise<void> => {
 2113        if (
 2114          dependencies.ownOnboarding !== undefined &&
 2115          plan.scopes.some(
 2116            (scope) =>
 2117              scope.kind === "OWN_ONBOARDING" && scope.subject === undefined,
 2118          )
 2119        ) {
 2120          try {
 2121            onboardingFacts = ownOnboardingFacts(
 2122              await dependencies.ownOnboarding.read(request.actor),
 2123            );
 2124          } catch (error: unknown) {
 2125            logger?.warn(
 2126              { err: error, qRunId: request.runId },
 2127              "the person's own onboarding was not read for this answer",
 2128            );
 2129          }
 2130        }
 2131      })();
 2132      await Promise.all([
 2133        mandateRead,
 2134        relationshipRead,
 2135        standingDone,
 2136        indexDone,
 2137        pitchRead,
 2138        onboardingRead,
 2139        companyRead,
 2140        namedRead,
 2141        dailyRead,
 2142        documentRead,
 2143        pageRead,
 2144        dayRead,
 2145      ]);
 2146      return {
 2147        history,
 2148        conversationId,
 2149        openDocumentTitle,
 2150        latest,
 2151        earlier,
 2152        toolContext,
 2153        assembled,
 2154        profile,
 2155        offeredForRun,
 2156        availableForRun,
 2157        memory,
 2158        ownProfile,
 2159        ownProfileCall,
 2160        ownInvestor,
 2161        relationship,
 2162        relationshipCall,
 2163        onScreenCompany,
 2164        onScreenCompanyCall,
 2165        namedCompanies,
 2166        namedCompanyCalls,
 2167        onScreenDaily,
 2168        onScreenDailyCall,
 2169        onScreenDocument,
 2170        onScreenDocumentCall,
 2171        onScreenPage,
 2172        onScreenPageCalls,
 2173        ownDay,
 2174        ownDayCalls,
 2175        asked,
 2176        counterparty,
 2177        ownStanding,
 2178        ownStandingCall,
 2179        ownIndex,
 2180        pitchMoment,
 2181        onboardingFacts,
 2182        fitSweep,
 2183      };
 2184    }
 2185    type PreparedTurn = Awaited<ReturnType<typeof prepareTurn>>;
 2186    /**
 2187     * Turns being prepared while they are read (speed sweep 2026-10-01: the
 2188     * turn reader's ~1 s and these reads' ~0.5 s ran one after the other).
 2189     * Bounded; one the answer never takes is dropped, and its reads only
 2190     * ever read.
 2191     */
 2192    const warming = new Map<string, Promise<PreparedTurn>>();
 2193    const WARMING_MAX = 64;
 2194
 2195    return {
 2196      lastObservation: () => last,
 2197      warm: (request: QAnswerRequest): void => {
 2198        if (warming.has(request.runId)) return;
 2199        const started = prepareTurn(request);
 2200        // Never an unhandled rejection: the answer that takes it re-awaits
 2201        // the same promise and sees the failure there.
 2202        started.catch(() => undefined);
 2203        warming.set(request.runId, started);
 2204        while (warming.size > WARMING_MAX) {
 2205          const oldest = warming.keys().next().value;
 2206          if (oldest === undefined) break;
 2207          warming.delete(oldest);
 2208        }
 2209      },
 2210      answer: async (request: QAnswerRequest): Promise<QAnswerOutcome> => {
 2211        last = undefined;
 2212        /**
 2213         * Where a turn's seconds go.
 2214         *
 2215         * Model latency is already in the usage ledger; everything around it
 2216         * was invisible, and a turn measured at thirteen seconds turned out
 2217         * to hold three and a half seconds of model and the rest here. A
 2218         * breakdown on every answer costs one log line and ends that class
 2219         * of guesswork.
 2220         */
 2221        const startedAt = Date.now();
 2222        let mark = startedAt;
 2223        const phases: Record<string, number> = {};
 2224        const took = (phase: string): void => {
 2225          const now = Date.now();
 2226          phases[phase] = now - mark;
 2227          mark = now;
 2228        };
 2229        const plan: PermittedContextPlan = request.plan;
 2230        const taskClass = taskClassForCapability(request.capability);
 2231        const sensitivity: ModelSensitivity =
 2232          sensitivityPolicy.kind === "FROM_PLAN"
 2233            ? plan.maxSensitivity
 2234            : sensitivityPolicy.sensitivity;
 2235        // Prepared while the turn was being read, when the caller warmed it
 2236        // (speed sweep 2026-10-01); otherwise now.
 2237        const warmed = warming.get(request.runId);
 2238        // A speculative answer leaves the warmed reads where they are: if it
 2239        // is cancelled, the turn's own answer takes them up (they only read).
 2240        const gate = speculationGate(request.speculation);
 2241        if (gate === null) warming.delete(request.runId);
 2242        else
 2243          void request.speculation?.decided.then(
 2244            (adopted) => {
 2245              if (adopted && warming.get(request.runId) === warmed) {
 2246                warming.delete(request.runId);
 2247              }
 2248            },
 2249            () => undefined,
 2250          );
 2251        const prepared = await (warmed ?? prepareTurn(request));
 2252        if (prepared === null) {
 2253          return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
 2254        }
 2255        const {
 2256          history,
 2257          conversationId,
 2258          openDocumentTitle,
 2259          latest,
 2260          earlier,
 2261          toolContext: preparedToolContext,
 2262          assembled,
 2263          profile,
 2264          offeredForRun,
 2265          availableForRun,
 2266          memory,
 2267          ownProfile,
 2268          ownProfileCall,
 2269          relationship,
 2270          relationshipCall,
 2271          onScreenCompany,
 2272          onScreenCompanyCall,
 2273          namedCompanies,
 2274          namedCompanyCalls,
 2275          onScreenDaily,
 2276          onScreenDailyCall,
 2277          onScreenDocument,
 2278          onScreenDocumentCall,
 2279          onScreenPage,
 2280          onScreenPageCalls,
 2281          ownDay,
 2282          ownDayCalls,
 2283          ownStanding,
 2284          ownStandingCall,
 2285          ownIndex,
 2286          pitchMoment,
 2287          onboardingFacts,
 2288          fitSweep,
 2289          counterparty,
 2290        } = prepared;
 2291        // Grows only by what use_capability loads (lead 2026-10-04).
 2292        let toolContext = preparedToolContext;
 2293        took(warmed === undefined ? "prepare-reads" : "prepare-reads-warmed");
 2294        // The person's settings for this answer, read side by side with the
 2295        // reading wait, the setup reminder and the readiness read below (L1
 2296        // latency sweep: these three were read one after another, ~40-180 ms
 2297        // of the "prepare" phase hosted). Never a rejection: a failed read
 2298        // is simply no setting.
 2299        const personalityRead =
 2300          dependencies.personalityOf === undefined
 2301            ? Promise.resolve(null)
 2302            : dependencies
 2303                .personalityOf({
 2304                  tenantId: request.tenantId,
 2305                  userId: request.actorUserId,
 2306                })
 2307                .catch(() => null);
 2308        const askerRead =
 2309          dependencies.askerOf === undefined
 2310            ? Promise.resolve(null)
 2311            : dependencies
 2312                .askerOf({
 2313                  tenantId: request.tenantId,
 2314                  userId: request.actorUserId,
 2315                  firstAnswer: !earlier.some((message) => message.role === "Q"),
 2316                })
 2317                .catch(() => null);
 2318        const receiptsRead =
 2319          dependencies.receipts === undefined
 2320            ? Promise.resolve([])
 2321            : collectReceipts(history, dependencies.receipts, request.actor);
 2322        // Awaited where it is used; a failure still fails the answer there.
 2323        receiptsRead.catch(() => undefined);
 2324        const etiquetteRead =
 2325          dependencies.etiquetteOf === undefined
 2326            ? Promise.resolve(null)
 2327            : dependencies
 2328                .etiquetteOf({
 2329                  tenantId: request.tenantId,
 2330                  userId: request.actorUserId,
 2331                })
 2332                .catch(() => null);
 2333        /**
 2334         * Whether this turn may reach the public web (CQ-QX-005), decided by
 2335         * the conversation core from its reading of the turn, which has been
 2336         * running alongside everything above. NEVER takes the research tool
 2337         * out of the model's hands for this turn altogether: "what else
 2338         * should I look for?" is not a search, and a company's name being
 2339         * in the sentence is not one either. Absent (no reader composed):
 2340         * the model keeps the tool and nothing is forced.
 2341         */
 2342        const research =
 2343          request.research === undefined ? undefined : await request.research;
 2344        took("reading");
 2345        // A question to Q (fallback) keeps the web in the model's hands even
 2346        // when nothing forces a search (web search 2026-10-06: "three
 2347        // YC-backed companies that fit my mandate" was read as a question
 2348        // about options, the tool was taken away, and Q answered from what
 2349        // little it held). Only a turn that asks nothing loses it.
 2350        let offered =
```
