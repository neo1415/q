# Evidence: apps/web/src/features/q/q-conversation.tsx (lines 156-193)

- Original path: `apps/web/src/features/q/q-conversation.tsx`
- Line range: 156-193 (HEAD 520bd123)
- Why included: spokenWelcome: waits up to 1.5s for arrival, then voiceBriefing (2.5s), then R35 briefing (1.5s).

```
  156  /** How long voice waits for a briefing still on its way before greeting. */
  157  const BRIEFING_WAIT_MS = 1_500;
  158  
  159  /**
  160   * The welcome as spoken, with the briefing said after the greeting when
  161   * this page gives one: "Welcome back, Ada. One thing needs you. …
  162   * Where would you like to start?" Plain and brief; no briefing, no change.
  163   */
  164  async function spokenWelcome(
  165    welcomeLine: string,
  166    welcomeLead: string | undefined,
  167    briefing: Promise<Briefing | null> | undefined,
  168  ): Promise<string> {
  169    // The arrival briefing (2026-10-08), when this page gives one: greeting
  170    // by their clock, the lowdown, and the first card put to them.
  171    for (let waited = 0; arrivalPending() && waited < BRIEFING_WAIT_MS;) {
  172      await new Promise((resolve) => setTimeout(resolve, 100));
  173      waited += 100;
  174    }
  175    // A call always opens with the briefing, read now if this page load did
  176    // not give it (live 2026-10-08: a call opened with the generic welcome).
  177    const arrival = await voiceBriefing().catch(() => null);
  178    if (arrival !== null) return arrival;
  179    if (briefing === undefined) return welcomeLine;
  180    let timer: ReturnType<typeof setTimeout> | undefined;
  181    const late = new Promise<null>((resolve) => {
  182      timer = setTimeout(() => resolve(null), BRIEFING_WAIT_MS);
  183    });
  184    const given = decideBriefing(
  185      await Promise.race([briefing.catch(() => null), late]),
  186    );
  187    clearTimeout(timer);
  188    if (given === null) return welcomeLine;
  189    if (welcomeLead !== undefined && welcomeLine.startsWith(welcomeLead)) {
  190      return `${welcomeLead} ${given.spoken}${welcomeLine.slice(welcomeLead.length)}`;
  191    }
  192    return `${welcomeLine} ${given.spoken}`;
  193  }
```

# Evidence: apps/web/src/features/q/q-conversation.tsx (lines 371-432)

- Original path: `apps/web/src/features/q/q-conversation.tsx`
- Line range: 371-432 (HEAD 520bd123)
- Why included: talk() and auto-start of the line when mic already granted.

```
  371    // --- Talking --------------------------------------------------------------
  372  
  373    const sessionTalk = session.talk;
  374    const talk = useCallback(async () => {
  375      rememberEnded(false);
  376      // Over a welcome still on screen, Q says that welcome and nothing
  377      // before it: one greeting, not the page's and then the call's.
  378      // The greeting is a nicety: if it cannot be put together, Q still
  379      // answers the press with the plain welcome (founder report 2026-09-30:
  380      // "I keep clicking Talk with Q and nothing happens").
  381      const greeting =
  382        welcomeLine !== undefined && turns.length === 0 && spoken.length === 0
  383          ? await spokenWelcome(welcomeLine, welcomeLead, briefing).catch(
  384              () => welcomeLine,
  385            )
  386          : undefined;
  387      await sessionTalk(greeting === undefined ? undefined : { greeting });
  388    }, [
  389      sessionTalk,
  390      welcomeLine,
  391      welcomeLead,
  392      briefing,
  393      turns.length,
  394      spoken.length,
  395    ]);
  396  
  397    const endVoice = voice.end;
  398    const end = useCallback(() => {
  399      rememberEnded(true);
  400      void endVoice();
  401    }, [endVoice]);
  402  
  403    // Q speaks first: on arrival the line opens by itself where the
  404    // microphone is already this site's, and the person has not ended it in
  405    // this tab. Anywhere else the stage offers Talk, one press away.
  406    // Once per visit to the page: a ref, not state, so trying does not
  407    // re-run (and cancel) the attempt it is part of.
  408    const autoTried = useRef(false);
  409    const talkRef = useRef(talk);
  410    useEffect(() => {
  411      talkRef.current = talk;
  412    }, [talk]);
  413    const voiceActive = voice.active;
  414    useEffect(() => {
  415      if (autoTried.current || !connected || voiceActive) return;
  416      let left = false;
  417      // A task later, so an effect React runs twice in development (and
  418      // cleans up in between) tries once, not never.
  419      const timer = window.setTimeout(() => {
  420        autoTried.current = true;
  421        void (async () => {
  422          if (endedThisTab()) return;
  423          if (!(await microphoneGranted()) || left) return;
  424          await talkRef.current();
  425        })();
  426      }, 0);
  427      return () => {
  428        // Left the page before the permission answer: no line opens.
  429        left = true;
  430        window.clearTimeout(timer);
  431      };
  432    }, [connected, voiceActive]);
```

# Evidence: apps/web/src/features/q/q-conversation.tsx (lines 479-548)

- Original path: `apps/web/src/features/q/q-conversation.tsx`
- Line range: 479-548 (HEAD 520bd123)
- Why included: lines = stored turns + spokenOnly; conversing = lines.length>0; showingCards.

```
  479    // --- The thread -------------------------------------------------------------
  480  
  481    // The live line: what is being said right now, one line that grows in
  482    // place under its id, until the next one starts.
  483    const live = client.transcript.at(-1);
  484    const liveIsPerson =
  485      voice.active &&
  486      live !== undefined &&
  487      live.role === "user" &&
  488      (live.partial ||
  489        client.state === "USER_SPEAKING" ||
  490        client.state === "LISTENING" ||
  491        client.state === "THINKING");
  492  
  493    const stored: Line[] = turns.map((turn) =>
  494      turn.kind === "PERSON"
  495        ? { id: turn.id, role: "person", text: turn.text }
  496        : { id: turn.id, role: "q", text: turn.text, turn },
  497    );
  498    const lines: readonly Line[] = threadInOrder(
  499      stored,
  500      spokenOnly.map((line) => ({
  501        id: line.id,
  502        role: line.role === "user" ? ("person" as const) : ("q" as const),
  503        text: line.text,
  504        after: line.after,
  505      })),
  506    ).map((line): Line =>
  507      "after" in line ? { id: line.id, role: line.role, text: line.text } : line,
  508    );
  509    // While the person is speaking their words are the thread's newest
  510    // bubble, growing in place; the same words once stored are not shown
  511    // twice.
  512    const liveWords = liveIsPerson ? words(live.text) : null;
  513    const thread =
  514      liveWords === null
  515        ? lines
  516        : lines.filter(
  517            (line) => !(line.role === "person" && words(line.text) === liveWords),
  518          );
  519  
  520    // The newest words are where the eye is: the thread keeps its end in view.
  521    const bodyRef = useRef<HTMLDivElement>(null);
  522    const newest = `${String(lines.length)}:${live?.text ?? ""}:${String(lines.at(-1)?.text.length ?? 0)}`;
  523    const conversing = lines.length > 0 || liveIsPerson;
  524    // Presence or chat (founder direction 2026-09-29). Presence keeps Q on
  525    // the stage, large, above the latest exchange; chat is the whole thread
  526    // top to bottom. Either way Q stays visible: when an answer is laid out
  527    // (cards, a table, a list of key points) or in chat view, it steps up
  528    // into the top line, small and still live, and comes back after.
  529    // Read through the store hook: the server has no storage, and the first
  530    // paint must match what it rendered.
  531    const view = useSyncExternalStore(
  532      subscribeStageView,
  533      readStageView,
  534      () => "presence" as const,
  535    );
  536    const chooseView = writeStageView;
  537    const latestAnswer = turns.findLast((turn) => turn.kind === "Q");
  538    // Cards stay wide while Q talks over them or works on a follow-up.
  539    const showingCards =
  540      latestAnswer?.kind === "Q" &&
  541      !latestAnswer.streaming &&
  542      latestAnswer.blocks.some(
  543        (block) =>
  544          block.kind === "COMPARISON_CARDS" || block.kind === "ANSWER_CARDS",
  545      );
  546    // Presence view is Q's presence only (founder request 2026-10-03): a
  547    // laid-out answer is shown over it (QPresenceStage), not as a thread.
  548    const bigPresence = !conversing || view === "presence";
```

# Evidence: apps/web/src/features/q/q-conversation.tsx (lines 596-686)

- Original path: `apps/web/src/features/q/q-conversation.tsx`
- Line range: 596-686 (HEAD 520bd123)
- Why included: showWelcome requires lines.length===0; qAsk awaits spokenWelcome before the first typed question.

```
  596  
  597    const stage = workingLabel(q.state);
  598    const documentStage =
  599      q.state.stage === "PREPARING_DOCUMENT" ||
  600      q.state.stage === "REVISING_DOCUMENT" ||
  601      q.state.stage === "DESIGNING_DOCUMENT" ||
  602      q.state.stage === "FINDING_DOCUMENT_IMAGES" ||
  603      q.state.stage === "CHECKING_DOCUMENT";
  604    // DOCS: the document-ready card watches closely while Q writes one.
  605    useEffect(() => {
  606      if (documentStage) expectDocument();
  607    }, [documentStage]);
  608    const showWelcome = welcome !== undefined && lines.length === 0 && !q.loading;
  609    const showSuggestions =
  610      welcome === undefined &&
  611      connected &&
  612      lines.length === 0 &&
  613      !q.working &&
  614      !q.loading &&
  615      q.state.failure === null;
  616  
  617    const room = useRoomSlots();
  618    const stateLabel = voice.active
  619      ? client.muted
  620        ? "Muted"
  621        : (presence.label ?? "Listening")
  622      : // An invitation before the first question; once Q has answered it
  623        // would read as stale, so the idle label is just Q's name.
  624        (presence.label ??
  625        (connected && lines.length === 0 ? "Ready when you are" : "Q"));
  626  
  627    const [historyOpen, setHistoryOpen] = useState(false);
  628    // W7: the sheet's code loads the first time it is opened, then stays.
  629    const [historyUsed, setHistoryUsed] = useState(false);
  630    if (historyOpen && !historyUsed) setHistoryUsed(true);
  631    const download =
  632      turns.length === 0 && spoken.length === 0
  633        ? undefined
  634        : () => {
  635            const blob = new Blob([transcriptText(turns, spoken)], {
  636              type: "text/plain;charset=utf-8",
  637            });
  638            const url = URL.createObjectURL(blob);
  639            const anchor = document.createElement("a");
  640            anchor.href = url;
  641            anchor.download = "capital-q-conversation.txt";
  642            anchor.click();
  643            URL.revokeObjectURL(url);
  644          };
  645  
  646    // One way to say something to Q from the page: down the open line when
  647    // there is one (answered aloud), otherwise as a question.
  648    // A line that never connected (no microphone) carries nothing: typed
  649    // words then go to Q as a question (live 2026-09-30).
  650    const sendText = client.sendText;
  651    const lineOpen = voiceActive && client.connected;
  652    /**
  653     * A typed question over the welcome starts the conversation with the
  654     * welcome itself as Q's first line (founder live 2026-10-01: "there are
  655     * companies in your feed", then "what are these companies?" was met with
  656     * "not sure what companies you mean": the welcome was only ever drawn
  657     * here, never part of what Q reads). The same words voice opens with.
  658     */
  659    const rawAsk = q.ask;
  660    const welcomeShown =
  661      welcomeLine !== undefined && turns.length === 0 && spoken.length === 0;
  662    const qAsk = useCallback(
  663      async (text: string) => {
  664        const opening = welcomeShown
  665          ? await spokenWelcome(welcomeLine, welcomeLead, briefing).catch(
  666              () => welcomeLine,
  667            )
  668          : undefined;
  669        await rawAsk(text, opening === undefined ? undefined : { opening });
  670      },
  671      [rawAsk, welcomeShown, welcomeLine, welcomeLead, briefing],
  672    );
  673    // Q room W5 (R8): a founder said yes to the onboarding deck offer;
  674    // once they are here and Q is connected, ask for it, once.
  675    useEffect(() => {
  676      if (!connected) return;
  677      if (takeAcceptedDeckOffer()) void qAsk(DECK_OFFER_QUESTION);
  678    }, [connected, qAsk]);
  679  
  680    const sayOrAsk = useCallback(
  681      (text: string) => {
  682        if (lineOpen) sendText(text);
  683        else void qAsk(text);
  684      },
  685      [lineOpen, sendText, qAsk],
  686    );
```

# Evidence: apps/web/src/features/q/q-conversation.tsx (lines 1160-1264)

- Original path: `apps/web/src/features/q/q-conversation.tsx`
- Line range: 1160-1264 (HEAD 520bd123)
- Why included: Pre-conversation branch: the only place ArrivalRoom (side columns) and the welcome (with the arrival cards) are rendered.

```
 1160  
 1161                  {boardDocked || bigPresence ? null : (
 1162                    <QNow session={session} onAct={sayOrAsk} quietWhenIdle />
 1163                  )}
 1164                  {notices}
 1165                </div>
 1166              ) : (
 1167                <div
 1168                  className={cx(
 1169                    "mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-6 py-6",
 1170                    // The arrival room: decision cards either side of Q.
 1171                    room.filled && "lg:max-w-6xl",
 1172                  )}
 1173                >
 1174                  <ArrivalRoom>
 1175                    <ViewTransition
 1176                      name="q-aperture"
 1177                      share="cq-q-morph"
 1178                      default="none"
 1179                    >
 1180                      <QAperture
 1181                        state={presence.state}
 1182                        size="stage"
 1183                        inputLevel={client.inputLevel}
 1184                        outputLevel={client.outputLevel}
 1185                        stage
 1186                      />
 1187                    </ViewTransition>
 1188                    <div
 1189                      className="flex flex-col items-center gap-1"
 1190                      role="status"
 1191                    >
 1192                      <span className="cq-label text-(--cq-text-primary)">
 1193                        {stateLabel}
 1194                      </span>
 1195                      {!voice.active && q.working && stage !== undefined ? (
 1196                        <span className="cq-caption text-(--cq-text-secondary)">
 1197                          {stage}
 1198                        </span>
 1199                      ) : null}
 1200                    </div>
 1201                  </ArrivalRoom>
 1202  
 1203                  {voice.active ? null : (
 1204                    <button
 1205                      type="button"
 1206                      className="cq-q-talk"
 1207                      disabled={!connected}
 1208                      onClick={() => void talk()}
 1209                      data-q-control="talk"
 1210                    >
 1211                      <Mic
 1212                        size={ICON_SIZE.prominent}
 1213                        strokeWidth={2}
 1214                        aria-hidden="true"
 1215                      />
 1216                      {connected ? "Talk with Q" : "Q isn't available right now"}
 1217                    </button>
 1218                  )}
 1219  
 1220                  {showWelcome ? (
 1221                    <div
 1222                      className="flex w-full flex-col items-center"
 1223                      data-q-welcome-line
 1224                    >
 1225                      {welcome}
 1226                    </div>
 1227                  ) : null}
 1228  
 1229                  {showSuggestions ? (
 1230                    <ul
 1231                      aria-label="Suggested questions"
 1232                      className="flex flex-wrap justify-center gap-2"
 1233                      data-q-suggestions
 1234                    >
 1235                      {context.suggestions.map((suggestion) => (
 1236                        <li key={suggestion}>
 1237                          <button
 1238                            type="button"
 1239                            className="cq-stage-option"
 1240                            onClick={() => {
 1241                              sayOrAsk(suggestion);
 1242                            }}
 1243                          >
 1244                            {suggestion}
 1245                          </button>
 1246                        </li>
 1247                      ))}
 1248                    </ul>
 1249                  ) : null}
 1250  
 1251                  {q.loading ? (
 1252                    <p className="cq-body-sm text-(--cq-text-secondary)">
 1253                      Opening your conversation…
 1254                    </p>
 1255                  ) : null}
 1256  
 1257                  {boardDocked ? null : (
 1258                    <div className="w-full max-w-(--cq-layout-narrow)">
 1259                      <QNow session={session} onAct={sayOrAsk} quietWhenIdle />
 1260                    </div>
 1261                  )}
 1262                  {notices}
 1263                </div>
 1264              )}
```

