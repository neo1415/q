# Evidence: apps/web/src/features/voice/provider/duplex-session.ts (lines 111-248)

- Original path: `apps/web/src/features/voice/provider/duplex-session.ts`
- Line range: 111-248 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: React hook wrapping DuplexLine: relays as server actions, cardInFocus, fallback rules, levels hard-coded to 0.

```ts
  111    const start = useCallback(
  112      async ({
  113        credential,
  114        firstMessage,
  115      }: VoiceSessionStart): Promise<boolean> => {
  116        const duplex = credential.duplex;
  117        if (duplex === undefined) return false;
  118        const previous = lineRef.current;
  119        lineRef.current = null;
  120        previous?.close();
  121        // W7: the line's code loads when a call starts, not with the page.
  122        const startedAt = (startsRef.current += 1);
  123        let lineModule: typeof import("./duplex-line");
  124        try {
  125          lineModule = await import("./duplex-line");
  126        } catch {
  127          return false;
  128        }
  129        // Ended, or started again, while it loaded: this start is over.
  130        if (startsRef.current !== startedAt) return false;
  131        const { DuplexLine: Line, browserDuplexEnvironment } = lineModule;
  132        setTranscript([]);
  133        lastLineRef.current = null;
  134        const id = credential.voiceSessionId;
  135        const relays: DuplexRelays = optionsRef.current.relays?.(id) ?? {
  136          tool: (call) => relayDuplexToolAction(id, call),
  137          usage: (report) => reportDuplexUsageAction(id, report),
  138          end: (reason, detail) => endDuplexAction(id, reason, detail),
  139          rejoin: (cause) => rejoinDuplexAction(id, cause),
  140          narration: (after) => pollNarration(id, after),
  141          heard: (heard) => sendDuplexHeardAction(id, heard),
  142          said: (said) => sendDuplexSaidAction(id, said),
  143        };
  144        const line = new Line({
  145          credential: duplex,
  146          // BACKCHANNEL: this device's toggle or the person's remembered
  147          // level, whichever they set last.
  148          listening:
  149            duplex.listening === undefined
  150              ? undefined
  151              : resolveListeningLevel(
  152                  duplex.listening,
  153                  readListeningPreference(),
  154                ),
  155          relays,
  156          environment:
  157            optionsRef.current.environment ?? browserDuplexEnvironment(),
  158          events: {
  159            onState: setState,
  160            onLine: addLine,
  161            // Changed by voice: this device's toggle shows it too.
  162            onListening: (level) => {
  163              storeListeningPreference(level);
  164            },
  165            onInterrupted: () => eventsRef.current.onInterrupted?.(),
  166            // The arrival briefing's card in focus is decided on the page,
  167            // by the same code its buttons use (line-cards.ts).
  168            cardInFocus,
  169            onClientTool: ({ name, arguments: args, heard }) =>
  170              name === "decide_card"
  171                ? decideCardByVoice(args, heard)
  172                : Promise.resolve(null),
  173            onLinkStatus: (status) => {
  174              if (lineRef.current === line) {
  175                eventsRef.current.onLinkStatus?.(status);
  176              }
  177            },
  178            onFallback: ({ cause, notice, connected: wasUp }) => {
  179              // A line already replaced or ended reports nothing: only the
  180              // current line may bring up its standard successor (live
  181              // 2026-10-05: a stale report opened a second standard line).
  182              const current = lineRef.current === line;
  183              if (!current) return;
  184              lineRef.current = null;
  185              setConnected(false);
  186              // Before it came up, `start` answers false and the caller
  187              // opens the standard line itself; nobody else needs to know.
  188              if (!wasUp) return;
  189              const fallback = eventsRef.current.onFallback;
  190              if (fallback !== undefined) fallback(notice, cause);
  191              else eventsRef.current.onEnded?.("dropped");
  192            },
  193            onEnded: () => {
  194              // Idle: the line ended itself. One the person ended through
  195              // `end` is already let go and says nothing more.
  196              if (lineRef.current !== line) return;
  197              lineRef.current = null;
  198              setConnected(false);
  199              eventsRef.current.onEnded?.("ended");
  200            },
  201          },
  202        });
  203        lineRef.current = line;
  204        const up = await line.open();
  205        if (up && lineRef.current === line) {
  206          setConnected(true);
  207          // Notes from the page's cards reach this line while it is up.
  208          const stopNotes = onLineNote((note, respond) => {
  209            if (lineRef.current === line) line.note(note, respond);
  210            else stopNotes();
  211          });
  212          // Q speaks first: the opening the interview has, at once.
  213          if (firstMessage !== undefined) line.speakFirst(firstMessage);
  214        }
  215        return up;
  216      },
  217      [addLine],
  218    );
  219
  220    const end = useCallback(async () => {
  221      startsRef.current += 1;
  222      const line = lineRef.current;
  223      lineRef.current = null;
  224      setConnected(false);
  225      setState("IDLE");
  226      // Closed quietly: the person ended it, there is nothing to report.
  227      line?.close();
  228      await Promise.resolve();
  229    }, []);
  230
  231    const sendText = useCallback((text: string) => {
  232      const line = lineRef.current;
  233      if (line === null) return;
  234      line.sendText(text);
  235    }, []);
  236
  237    const setMuted = useCallback((next: boolean) => {
  238      setMutedState(next);
  239      lineRef.current?.setMuted(next);
  240    }, []);
  241
  242    const setVolume = useCallback((volume: number) => {
  243      lineRef.current?.setVolume(volume);
  244    }, []);
  245
  246    // Levels are not sampled on this transport; the presence stays calm.
  247    const inputLevel = useCallback(() => 0, []);
  248    const outputLevel = useCallback(() => 0, []);
```
