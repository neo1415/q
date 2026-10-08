# Evidence: apps/q-api/src/voice/turn.ts (lines 1857-2176)

- Original path: `apps/q-api/src/voice/turn.ts`
- Line range: 1857-2176 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: The voice turn dispatcher: NOTHING paths, approvals, end-voice reading, WELCOME/INTERVIEW/askQ.

```ts
 1857    const handle: VoiceTurnHandler = async (
 1858      binding,
 1859      transcript,
 1860      signal,
 1861      speaker,
 1862    ) => {
 1863      const text = latestUtterance(transcript);
 1864      if (text === null || signal.aborted) {
 1865        return { kind: "NOTHING" };
 1866      }
 1867      rememberTranscript(binding, transcript);
 1868      const utterance = utteranceRefOf(binding.voiceSessionId, transcript);
 1869      if (utterance === undefined) utteranceInHand.delete(binding);
 1870      else utteranceInHand.set(binding, utterance);
 1871      /**
 1872       * The same utterance, grown: the run on its earlier form answers a
 1873       * fragment the person went on to extend, and Q never answers that. It
 1874       * is cancelled whatever the new words are, by identity (`utterance.ts`).
 1875       */
 1876      const extending =
 1877        utterance !== undefined && liveRuns.get(binding)?.utterance === utterance;
 1878      // Anything but "carry on" makes the run this line was waiting on
 1879      // obsolete, whether it was cut off mid-answer or never heard at all.
 1880      const resuming =
 1881        !extending &&
 1882        (isNonLexical(text) || (held.has(binding) && isContinueCue(text)));
 1883      if (!resuming) supersede(binding);
 1884      /**
 1885       * An utterance the recogniser left open is not yet a turn.
 1886       *
 1887       * Live, a person thinking aloud ("This one. You know… So yes. See,
 1888       * you…") had each pause taken as the end of their turn: twelve
 1889       * growing fragments became twelve turns, and Q answered half-sentences
 1890       * with "I can't identify a clear question". When the recogniser did
 1891       * not close the sentence, Q keeps listening a moment longer before
 1892       * acting on it. If the person carries on, the provider drops this
 1893       * request and the whole utterance arrives as the next one; nothing was
 1894       * started, recorded or said for the fragment. If they do not, Q
 1895       * answers what it has, a moment later than it otherwise would.
 1896       */
 1897      if (
 1898        !resuming &&
 1899        !settledTranscripts.has(transcript) &&
 1900        endsUnfinished(text)
 1901      ) {
 1902        await new Promise<void>((resolve) => {
 1903          const timer = setTimeout(resolve, UNFINISHED_HOLD_MS);
 1904          signal.addEventListener(
 1905            "abort",
 1906            () => {
 1907              clearTimeout(timer);
 1908              resolve();
 1909            },
 1910            { once: true },
 1911          );
 1912        });
 1913        if (signal.aborted) return { kind: "NOTHING" };
 1914      }
 1915      /**
 1916       * "Yes, and change the website too": the decision is taken, and the
 1917       * rest is the person's next turn, handled as if said on its own.
 1918       */
 1919      const carryOn = async (
 1920        read: DecisionReading,
 1921        outcome: VoiceTurnOutcome,
 1922      ): Promise<VoiceTurnOutcome> => {
 1923        if (read.remainder === null || outcome.kind !== "SPOKEN") return outcome;
 1924        const last = transcript.at(-1);
 1925        if (last === undefined) return outcome;
 1926        // The rest of a reply already acted on: not a fresh utterance, so
 1927        // it is not held for being unfinished.
 1928        const rest = [
 1929          ...transcript.slice(0, -1),
 1930          { ...last, content: read.remainder },
 1931        ];
 1932        settledTranscripts.add(rest);
 1933        return handle(binding, rest, signal, speaker);
 1934      };
 1935      // A proposal Q made, waiting for yes or no (CQ-Q-008, ADR 0011).
 1936      // Only a spoken reply to it decides it (lead 2026-10-03): never a
 1937      // request or a statement, a fragment, or Q's own voice heard back.
 1938      const approvalWaiting = pendingApproval.get(binding);
 1939      if (approvalWaiting !== undefined && dependencies.approvals !== undefined) {
 1940        const qLines = transcript
 1941          .slice(-6)
 1942          .filter((turn) => turn.role !== "user")
 1943          .map((turn) => turn.content);
 1944        if (isEcho(text, qLines)) {
 1945          // Q heard itself: not a turn, and the card still waits.
 1946          logger.info(
 1947            { qVoiceSessionId: binding.voiceSessionId },
 1948            "q's own words heard back while a card waits; ignored",
 1949          );
 1950          return { kind: "NOTHING" };
 1951        }
 1952        // A fragment ("go ahead with the") decides nothing; the card keeps
 1953        // waiting for the whole reply, and the fragment is answered as any.
 1954        const fragment = isFragment(text);
 1955        const summary =
 1956          approvalWaiting.summary ??
 1957          "I've prepared something that needs your approval.";
 1958        // Both readings side by side (J7): the decision, with what kind of
 1959        // reply it is, and whether the turn is a reply at all. Neither waits
 1960        // on the other, and no list of yes or no words stands in for them.
 1961        const [heard, reading] = fragment
 1962          ? [null, null]
 1963          : await Promise.all([
 1964              decide(binding, `${summary} Shall I go ahead?`, text, signal),
 1965              dependencies.turns === undefined
 1966                ? Promise.resolve(null)
 1967                : readTurnForCard(binding, text, signal),
 1968            ]);
 1969        // "Yes, approve the meeting with Nixo for the next five minutes":
 1970        // the rest restates the card, so there is no rest to answer.
 1971        const read =
 1972          heard !== null && restatesCard(heard)
 1973            ? { ...heard, remainder: null }
 1974            : heard;
 1975        // Without a turn reader composed, the decision reading is all there
 1976        // is; with one, an unread turn is a reply only if the words are
 1977        // nothing but the decision.
 1978        const reply =
 1979          read !== null &&
 1980          (dependencies.turns === undefined
 1981            ? read.onlyDecision || restatesCard(read) || !read.asksSomethingElse
 1982            : isReplyToCard(read, reading, { unreadMayReply: false }));
 1983        const decision =
 1984          read === null || !reply
 1985            ? "UNRELATED"
 1986            : read.decision === "YES"
 1987              ? approvesByWords(read)
 1988                ? "APPROVE"
 1989                : "WAITING"
 1990              : read.decision === "NO"
 1991                ? declinesByWords(read, text, { summary })
 1992                  ? "REJECT"
 1993                  : "UNRELATED"
 1994                : "UNRELATED";
 1995        if (read !== null) {
 1996          logger.info(
 1997            {
 1998              qVoiceSessionId: binding.voiceSessionId,
 1999              read: read.decision,
 2000              reply,
 2001              decision,
 2002              turnKind: reading?.kind ?? null,
 2003            },
 2004            "a spoken reply to a waiting card was read",
 2005          );
 2006        }
 2007        if (decision === "APPROVE" || decision === "REJECT") {
 2008          pendingApproval.delete(binding);
 2009          return carryOn(
 2010            read ?? UNREAD,
 2011            await decideApproval(
 2012              binding,
 2013              approvalWaiting,
 2014              decision,
 2015              signal,
 2016              speaker,
 2017            ),
 2018          );
 2019        }
 2020        if (decision === "WAITING") {
 2021          // A yes in meaning without an approving word: it stays waiting.
 2022          return (await speakLine(
 2023            speaker,
 2024            `That's ready: ${named(summary)}. It's waiting for your yes.`,
 2025            signal,
 2026            binding,
 2027          ))
 2028            ? { kind: "SPOKEN", path: "MOVE" }
 2029            : { kind: "INTERRUPTED", path: "MOVE" };
 2030        }
 2031        // Anything else: the proposal stays on screen, where it can still
 2032        // be decided; the conversation moves on. A fragment keeps the
 2033        // question open for the whole reply.
 2034        if (!fragment) pendingApproval.delete(binding);
 2035      }
 2036      // "Is this you?", answered.
 2037      if (awaitingRecognition.has(binding)) {
 2038        awaitingRecognition.delete(binding);
 2039        const read = await decide(
 2040          binding,
 2041          "Is this you? I found someone by that name online.",
 2042          text,
 2043          signal,
 2044        );
 2045        if (read.decision === "NO") {
 2046          // Their word settles it. Nothing found under a name that is not
 2047          // theirs is theirs, and Q says so rather than quietly keeping it.
 2048          return carryOn(
 2049            read,
 2050            (await speakLine(
 2051              speaker,
 2052              read.remainder === null
 2053                ? await withNextQuestion(binding, WRONG_PERSON_LINE)
 2054                : WRONG_PERSON_LINE,
 2055              signal,
 2056              binding,
 2057            ))
 2058              ? { kind: "SPOKEN", path: "MOVE" }
 2059              : { kind: "INTERRUPTED", path: "MOVE" },
 2060          );
 2061        }
 2062        if (read.decision === "YES") {
 2063          return carryOn(
 2064            read,
 2065            (await speakLine(
 2066              speaker,
 2067              read.remainder === null
 2068                ? await withNextQuestion(binding, RIGHT_PERSON_LINE)
 2069                : RIGHT_PERSON_LINE,
 2070              signal,
 2071              binding,
 2072            ))
 2073              ? { kind: "SPOKEN", path: "MOVE" }
 2074              : { kind: "INTERRUPTED", path: "MOVE" },
 2075          );
 2076        }
 2077        // Anything else is them carrying on; the question is not asked again.
 2078      }
 2079  
 2080      // "Change my website to …", "make us visible to investors" are not
 2081      // matched here from the words (ADR 0011/0016, as navigation is not):
 2082      // they reach Q like any turn, Q's reading names the change
 2083      // (update_company_profile, SET_VISIBILITY) and the platform's approval
 2084      // asks for the yes, spoken or tapped, bound to the exact change.
 2085      const paused = held.get(binding);
 2086      // A cough, a laugh, a bare "uh", or the browser's cue after a false
 2087      // interruption: not a turn. If something was cut, it carries on;
 2088      // otherwise Q says nothing at all.
 2089      if (isNonLexical(text)) {
 2090        if (paused === undefined) return { kind: "NOTHING" };
 2091        held.delete(binding);
 2092        return resumeHeld(paused, binding, signal, speaker);
 2093      }
 2094      if (paused !== undefined && isContinueCue(text)) {
 2095        held.delete(binding);
 2096        return resumeHeld(paused, binding, signal, speaker);
 2097      }
 2098      // Whether they want to stop talking by voice is read by meaning,
 2099      // beside the turn (DECISION_READER answers in about a second, before
 2100      // Q's answer is ready to speak); a YES stops that answer and hands the
 2101      // screen to the typed thread.
 2102      const turn = new AbortController();
 2103      const turnSignal = AbortSignal.any([signal, turn.signal]);
 2104      // The turn's own reading, not a yes/no question an approval can
 2105      // satisfy: it ends the line only when the whole message is about the
 2106      // channel (endVoice) and the turn is a control word or a remark --
 2107      // never with a request, an approval, a question or an answer.
 2108      const ending: Promise<boolean> = (async () => {
 2109        const reader = dependencies.turns;
 2110        if (reader === undefined) return false;
 2111        const read = await reader
 2112          .read({
 2113            utterance: text,
 2114            recentTurns: transcriptOf(binding)
 2115              .slice(0, -1)
 2116              .slice(-6)
 2117              .map((turn) => ({
 2118                role: turn.role === "person" ? ("USER" as const) : ("Q" as const),
 2119                text: turn.text,
 2120              })),
 2121            modality: "VOICE",
 2122            attribution: {
 2123              tenantId: binding.actor.tenantId,
 2124              userId: binding.actor.userId,
 2125              correlationId: createCorrelationId(),
 2126            },
 2127            signal,
 2128          })
 2129          .catch(() => null);
 2130        return endsVoice(read);
 2131      })();
 2132      const endNow = async (): Promise<VoiceTurnOutcome> => {
 2133        dependencies.board?.record(binding.voiceSessionId, {
 2134          asking: null,
 2135          navigate: null,
 2136          handoff: "CHAT",
 2137          degraded: false,
 2138        });
 2139        return (await speakLine(speaker, END_LINE, signal))
 2140          ? { kind: "SPOKEN", path: "MOVE" }
 2141          : { kind: "INTERRUPTED", path: "MOVE" };
 2142      };
 2143  
 2144      // "Take me to Discover" is no longer matched here from the words (ADR
 2145      // 0011, R20): it reaches Q like any turn, and the screen follows the
 2146      // navigation block Q's answer carries (askQ), exactly as typed.
 2147      // The single dispatch (onboarding conductor): exactly one brain per
 2148      // turn. A line bound to an onboarding session is the interview's,
 2149      // whatever was said; the general pipeline never also runs for it.
 2150      const owner = dispatchTurn(binding.thread);
 2151      const answering =
 2152        owner === "WELCOME"
 2153          ? welcomeTurn(binding, text, turnSignal, speaker)
 2154          : owner === "INTERVIEW"
 2155            ? answerInterview(binding, text, turnSignal, speaker)
 2156            : askQ(binding, text, turnSignal, speaker);
 2157      // Never an unhandled rejection when the answer is stopped.
 2158      answering.catch(() => undefined);
 2159      if (await ending) {
 2160        turn.abort();
 2161        await answering.catch(() => undefined);
 2162        return endNow();
 2163      }
 2164      const outcome = await answering;
 2165      // An answer the person talked over is theirs to ask for ("go on"),
 2166      // not Q's to append. Live, a second question was answered and then
 2167      // followed by "and to finish what I was saying earlier", which read
 2168      // as Q answering two things at once. Once they have moved on, what
 2169      // was cut stays cut.
 2170      if (paused !== undefined && held.get(binding) === paused) {
 2171        held.delete(binding);
 2172      }
 2173      return outcome;
 2174    };
 2175    return handle;
 2176  }
```

