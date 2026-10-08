# Evidence: apps/web/src/features/q/q-session.tsx (lines 230-372)

- Original path: `apps/web/src/features/q/q-session.tsx`
- Line range: 230-372 (HEAD 520bd123)
- Why included: Spoken lines (onLine) enter 'spoken'; room feed absorbs answers while a line is open; talk() firstMessage = greeting ?? voiceBriefing ?? plainHello.

```
  230    const [spoken, setSpoken] = useState<readonly SpokenLine[]>([]);
  231    // The real voice; a development harness may hold a scripted one.
  232    const useVoice = useContext(VoiceInterviewSource);
  233    const voice = useVoice({
  234      onLine: (line) => {
  235        setSpoken((current) =>
  236          upsertLine(current, { id: line.id, role: line.role, text: line.text }),
  237        );
  238      },
  239    });
  240    // Spoken turns live in a conversation the server names; once it does,
  241    // the store is in that conversation too. Adjusted during render, as
  242    // React asks, so the conversation hook sees it on the same pass.
  243    const voiceConversationId = voice.turn?.conversationId;
  244    if (
  245      voiceConversationId !== undefined &&
  246      voiceConversationId !== conversationId
  247    ) {
  248      setConversationId(voiceConversationId);
  249    }
  250    // ...and on the Q page its URL says so, for a refresh or a link.
  251    useEffect(() => {
  252      if (voiceConversationId !== undefined) {
  253        writeToQPageUrl(voiceConversationId);
  254      }
  255    }, [voiceConversationId, pathname]);
  256
  257    /*
  258     * A spoken answer is recorded as a Q message with its result blocks --
  259     * "here's your mandate, download the PDF from the card" -- but it
  260     * arrives here only as speech and transcript text. Without reading the
  261     * record back, the card it names never reached the stage or the Board
  262     * (founder bug on 164fc5c). So each voice turn the board reports, and
  263     * each time Q stops speaking, reads the conversation until the record
  264     * holds the run as finished (P10: a fixed second read came too early for
  265     * a ranked list, whose cards then never appeared). One reading at a
  266     * time: a newer trigger replaces the one under way.
  267     */
  268    const voiceSequence = voice.turn?.sequence ?? 0;
  269    const qRefresh = q.refresh;
  270    const stopReread = useRef<(() => void) | null>(null);
  271    const reread = useCallback(() => {
  272      stopReread.current?.();
  273      stopReread.current = rereadUntilSettled({ read: qRefresh });
  274    }, [qRefresh]);
  275    useEffect(() => () => stopReread.current?.(), []);
  276    useEffect(() => {
  277      if (voiceSequence === 0) return;
  278      reread();
  279    }, [voiceSequence, reread]);
  280    /*
  281     * voice-cards (Zino live 2026-10-08): the read-back above is a guess
  282     * about when and where a spoken answer landed, and on the duplex line it
  283     * missed every time. The Q API now publishes each run's answer to the
  284     * person's room as it completes, whichever path ran it; while a line is
  285     * open this session reads that feed and puts each answer in the thread
  286     * at once, keyed by its message, so its cards reach the stage (and the
  287     * dock's chip on every other page) from the server itself.
  288     */
  289    const qAbsorb = q.absorb;
  290    const shownConversation = useRef(conversationId);
  291    useEffect(() => {
  292      shownConversation.current = conversationId;
  293    }, [conversationId]);
  294    const onRoom = useCallback(
  295      (entries: readonly QRoomEntry[]) => {
  296        for (const entry of entries) {
  297          const named = entry.conversationId;
  298          if (named !== null && named !== shownConversation.current) {
  299            // Another conversation (a spoken one the page had not opened):
  300            // opened, and its record already holds this answer.
  301            shownConversation.current = named;
  302            setConversationId(named);
  303            writeToQPageUrl(named);
  304            continue;
  305          }
  306          qAbsorb(entry.message);
  307        }
  308        // The record then fills in the question each answer was for.
  309        reread();
  310      },
  311      [qAbsorb, reread],
  312    );
  313    useQRoomFeed(voice.active, onRoom);
  314
  315    const voiceSpeaking = voice.client.state === "Q_SPEAKING";
  316    const wasSpeaking = useRef(false);
  317    useEffect(() => {
  318      if (wasSpeaking.current && !voiceSpeaking) reread();
  319      wasSpeaking.current = voiceSpeaking;
  320    }, [voiceSpeaking, reread]);
  321
  322    const open = useCallback((next: string | null) => {
  323      setConversationId((current) => {
  324        if (current === next) return current;
  325        // A different conversation: what was said aloud belonged to the
  326        // other one.
  327        setSpoken([]);
  328        return next;
  329      });
  330    }, []);
  331
  332    const talk = useCallback(
  333      async (options?: { readonly greeting?: string }) => {
  334        const named = conversationIdOf(q.conversationId);
  335        const greeting = options?.greeting;
  336        await voice.talk({
  337          ...(greeting === undefined ? {} : { resume: true }),
  338          thread: {
  339            ...(companyId !== undefined
  340              ? { subjects: [{ kind: "COMPANY" as const, companyId }] }
  341              : investorOrganisationId !== undefined
  342                ? {
  343                    subjects: [
  344                      {
  345                        kind: "INVESTOR_ORGANISATION" as const,
  346                        investorOrganisationId,
  347                      },
  348                    ],
  349                  }
  350                : relationshipId !== undefined
  351                  ? {
  352                      subjects: [
  353                        { kind: "RELATIONSHIP" as const, relationshipId },
  354                      ],
  355                    }
  356                  : {}),
  357            ...(named === undefined ? {} : { conversationId: named }),
  358          },
  359          // Never "I'm listening" (Zino, 2026-10-08): the arrival briefing
  360          // when this page load gives one, else a hello by their clock.
  361          firstMessage:
  362            greeting ?? (await voiceBriefing().catch(() => null)) ?? plainHello(),
  363        });
  364      },
  365      [
  366        companyId,
  367        investorOrganisationId,
  368        relationshipId,
  369        q.conversationId,
  370        voice,
  371      ],
  372    );
```

# Evidence: apps/web/src/features/q/q-session.tsx (lines 422-457)

- Original path: `apps/web/src/features/q/q-session.tsx`
- Line range: 422-457 (HEAD 520bd123)
- Why included: Typed answer NAVIGATE/client actions followed once wire contracts are loaded and no line is live.

```
  422    /**
  423     * "Take me to Discover", typed (CQ-QACT-001): the answer's NAVIGATE
  424     * intent is followed through the same route map. What was already there
  425     * when the conversation opened is never followed.
  426     */
  427    const followedTurns = useRef<Set<string> | null>(null);
  428    // W7: the answer's actions are checked against the wire's contracts;
  429    // this effect looks again once they are in.
  430    const wire = useWire();
  431    // A dropped line makes no moves; the typed answer's are made here.
  432    const voiceActive = voice.active && isLineLive(voice.client);
  433    useEffect(() => {
  434      if (q.loading) {
  435        followedTurns.current = null;
  436        return;
  437      }
  438      if (followedTurns.current === null) {
  439        followedTurns.current = new Set(
  440          turns.filter((turn) => turn.kind === "Q").map((turn) => turn.id),
  441        );
  442        return;
  443      }
  444      if (wire === null) return;
  445      const followed = followOfTurns(turns, followedTurns.current);
  446      // While the line is open, a spoken answer's moves are the voice
  447      // board's to make, after Q has said them; making them here too would
  448      // cut the sentence short and open a website twice.
  449      if (voiceActive) return;
  450      // R20/R33: the app's own actions the answer carries, done once.
  451      for (const action of followed.actions) performClientAction(action);
  452      const path = destinationPath(followed.navigate);
  453      if (path !== null) {
  454        act();
  455        router.push(path);
  456      }
  457    }, [turns, q.loading, act, router, voiceActive, wire]);
```
