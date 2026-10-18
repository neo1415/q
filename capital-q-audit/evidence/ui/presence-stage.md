# Evidence: apps/web/src/features/q/q-presence-stage.tsx (lines 90-483)

- Original path: `apps/web/src/features/q/q-presence-stage.tsx`
- Line range: 90-483 (HEAD 520bd123)
- Why included: QPresenceStage: answer cards / shown object / room card over the presence (centre column), one at a time.

```
   90  /**
   91   * The Q page in its presence view (founder request 2026-10-03): Q's
   92   * presence and nothing written, unless Q has something to show.
   93   *
   94   * - No transcript. Q's words are said, and are in Chat; here they are
   95   *   announced to a screen reader only, unless the person turned captions
   96   *   on (an accessibility setting, off by default), which shows the latest
   97   *   exchange the presence view used to show.
   98   * - An object Q shows (a document, a comparison, cards, a question back)
   99   *   appears over the presence and steps back after a few answers, or when
  100   *   dismissed. "Shown recently" brings any of this session's back.
  101   * - A change waiting for approval is passed in as `waiting` and is never
  102   *   stepped back: it stays until it is decided.
  103   */
  104  export function QPresenceStage({
  105    presence,
  106    turns,
  107    captions,
  108    caption,
  109    waiting,
  110    onAsk,
  111    onOpenArtifact,
  112    onShowingChange,
  113    live = false,
  114    onBoardLanded,
  115    onPin,
  116    loadRoomCard,
  117    deckLoaders,
  118    exportAnswer,
  119  }: {
  120    /** A live voice line is open: Q's own lines drive which card is open. */
  121    readonly live?: boolean | undefined;
  122    /** An answer flew into the Board (C4): the Board button counts it. */
  123    readonly onBoardLanded?: (() => void) | undefined;
  124    /** Pin an answer to the Board. */
  125    readonly onPin?: ((answerId: string) => void) | undefined;
  126    /** Q room R4: how a card reads its content (the dev harness serves it). */
  127    readonly loadRoomCard?: RoomCardLoader | undefined;
  128    /** Q room W5: the deck surface's reads (a harness serves fixtures). */
  129    readonly deckLoaders?: DeckLoaders | undefined;
  130    /** Q room W3: how an answer is filed as a PDF (the dev harness serves it). */
  131    readonly exportAnswer?: PdfExport | undefined;
  132    /**
  133     * Q's presence: full size, or small and pinned at the top while an
  134     * object is shown (lead 2026-10-03: the presence never leaves the screen).
  135     */
  136    readonly presence: (compact: boolean, mini?: boolean) => ReactNode;
  137    /** Told when an object starts or stops being shown (the stage stops following newest). */
  138    readonly onShowingChange?: ((showing: boolean) => void) | undefined;
  139    readonly turns: readonly QTurn[];
  140    /** The person's captions setting. */
  141    readonly captions: boolean;
  142    /** The latest exchange as captions, rendered only when captions are on. */
  143    readonly caption: ReactNode;
  144    /** A pending approval (QNow): always reachable while it waits. */
  145    readonly waiting?: ReactNode;
  146    readonly onAsk?: ((question: string) => void) | undefined;
  147    readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
  148  }) {
  149    const listId = useId();
  150    const items = useMemo(() => shownItems(turns), [turns]);
  151    const answers = answersIn(turns);
  152    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
  153      () => new Set(),
  154    );
  155    const [reopened, setReopened] = useState<{
  156      readonly id: string;
  157      readonly atAnswer: number;
  158    } | null>(null);
  159    const [listOpen, setListOpen] = useState(false);
  160    const staged = onStage(items, answers, dismissed, reopened);
  161    // C4: cards whose topic the conversation has left are not on the stage.
  162    const movedOn =
  163      staged !== null &&
  164      reopened?.id !== staged.id &&
  165      topicMovedOn(turns, staged.id);
  166    const shown = movedOn ? null : staged;
  167    const recent = shownRecently(items);
  168    // Q room R4: the card Q brought into the room, open while the
  169    // conversation stays on its subject (room-stage), or until closed here.
  170    // W7: the room's cards are checked against the wire's contracts, and
  171    // read again once they are in.
  172    const wire = useWire();
  173    const room = useMemo(
  174      () => (wire === null ? roomStage([]) : roomStage(turns)),
  175      [turns, wire],
  176    );
  177    const [closedByHand, setClosedByHand] = useState<{
  178      readonly key: string;
  179      readonly at: number;
  180    } | null>(null);
  181    const roomOpen =
  182      room.open !== null &&
  183      !(
  184        closedByHand !== null &&
  185        closedByHand.key === room.open.key &&
  186        closedByHand.at >= room.open.openedAt
  187      )
  188        ? room.open
  189        : null;
  190    const latestQ = turns.findLast(
  191      (turn): turn is Extract<QTurn, { kind: "Q" }> => turn.kind === "Q",
  192    );
  193
  194    const dismiss = (item: ShownItem) => {
  195      const key =
  196        reopened !== null && reopened.id === item.id
  197          ? `${item.id}@${String(reopened.atAnswer)}`
  198          : item.id;
  199      setDismissed((current) => new Set([...current, key]));
  200      if (reopened?.id === item.id) setReopened(null);
  201    };
  202
  203    // The answer on the stage as cards, and one leaving for the Board.
  204    const canvas =
  205      shown === null
  206        ? null
  207        : (() => {
  208            const turn = turns.find((one) => one.id === shown.id);
  209            const block = answerCardsOf(turn);
  210            return block === null ? null : { item: shown, block, turn };
  211          })();
  212    const [leaving, setLeaving] = useState<{
  213      readonly id: string;
  214      readonly block: QAnswerCardsBlock;
  215    } | null>(null);
  216    const leavingRef = useRef<HTMLDivElement>(null);
  217    // Which answer's cards are on the stage; when that changes, the one
  218    // that was there flies to the Board (state adjusted during render).
  219    const [onStageCanvas, setOnStageCanvas] = useState<{
  220      readonly id: string;
  221      readonly block: QAnswerCardsBlock;
  222    } | null>(null);
  223    const canvasId = canvas?.item.id ?? null;
  224    if ((onStageCanvas?.id ?? null) !== canvasId) {
  225      if (onStageCanvas !== null) setLeaving(onStageCanvas);
  226      setOnStageCanvas(
  227        canvas === null ? null : { id: canvas.item.id, block: canvas.block },
  228      );
  229    }
  230    useEffect(() => {
  231      if (leaving === null) return;
  232      let done = false;
  233      void import("./answer-canvas")
  234        .then((module) => module.flyToBoard(leavingRef.current))
  235        .then(() => {
  236          if (done) return;
  237          setLeaving(null);
  238          onBoardLanded?.();
  239        });
  240      return () => {
  241        done = true;
  242      };
  243    }, [leaving, onBoardLanded]);
  244
  245    useEffect(() => {
  246      const onShow = (event: Event) => {
  247        if (!(event instanceof CustomEvent)) return;
  248        const detail: unknown = event.detail;
  249        if (
  250          typeof detail === "object" &&
  251          detail !== null &&
  252          "id" in detail &&
  253          typeof detail.id === "string"
  254        ) {
  255          setReopened({ id: detail.id, atAnswer: answers });
  256        }
  257      };
  258      window.addEventListener(SHOW_ON_STAGE, onShow);
  259      return () => window.removeEventListener(SHOW_ON_STAGE, onShow);
  260    }, [answers]);
  261
  262    // Q room W3: a data-room document open in the room's centre panel.
  263    const documentOpen = useRoomDocumentOpen();
  264    const showing = shown !== null || roomOpen !== null || documentOpen;
  265    useEffect(() => {
  266      onShowingChange?.(showing);
  267    }, [showing, onShowingChange]);
  268    // W7: the room card stays mounted once shown, so its exit still plays.
  269    const [roomShown, setRoomShown] = useState(false);
  270    if (!roomShown && (roomOpen !== null || room.note !== null)) {
  271      setRoomShown(true);
  272    }
  273    const answered = latestQ !== undefined;
  274    // What was in the conversation when the room opened (the PDF offer
  275    // offers only answers that arrive after; its code loads later).
  276    const [openedWith] = useState<ReadonlySet<string>>(
  277      () => new Set(turns.map((turn) => turn.id)),
  278    );
  279
  280    // W7: once the page has settled, what Q is likely to show first (a room
  281    // card, an answer's cards) is fetched quietly, so the first one shown
  282    // does not wait for its code. Never during the first paint.
  283    useEffect(() => {
  284      let cancel: (() => void) | null = null;
  285      const timer = window.setTimeout(() => {
  286        cancel = whenIdle(() => {
  287          // Mounted once in, so the first card enters as it always has.
  288          void import("./room/q-room-card").then(
  289            () => setRoomShown(true),
  290            () => undefined,
  291          );
  292          void import("./stage-canvas");
  293        }, 5_000);
  294      }, PREFETCH_AFTER_MS);
  295      return () => {
  296        window.clearTimeout(timer);
  297        cancel?.();
  298      };
  299    }, []);
  300
  301    return (
  302      <div
  303        className="flex w-full flex-col items-center gap-4"
  304        data-q-presence-stage={showing ? "object" : "presence"}
  305      >
  306        {/* The presence stays on screen: small while an object is shown,
  307            full again once it is dismissed (reduced motion: no scale). */}
  308        {canvas !== null || leaving !== null ? null : (
  309          <div
  310            key={showing ? "compact" : "full"}
  311            className="cq-presence-in flex w-full flex-col items-center"
  312            data-q-presence-size={showing ? "compact" : "full"}
  313          >
  314            {presence(showing)}
  315          </div>
  316        )}
  317
  318        {/* Q's words for a screen reader, never as text on the page. */}
  319        <p className="sr-only" aria-live="polite" data-q-said>
  320          {latestQ === undefined || latestQ.streaming
  321            ? ""
  322            : plainFromMarkdown(latestQ.text)}
  323        </p>
  324
  325        {captions ? <div data-q-captions>{caption}</div> : null}
  326
  327        {leaving === null ? null : (
  328          <div ref={leavingRef} className="w-full" data-q-canvas-leaving>
  329            <Suspense fallback={null}>
  330              <AnswerCanvas
  331                block={leaving.block}
  332                focus={-1}
  333                said=""
  334                presence={presence(true, true)}
  335                showFollowUps={false}
  336              />
  337            </Suspense>
  338          </div>
  339        )}
  340
  341        {canvas === null || leaving !== null ? null : (
  342          <Suspense fallback={presence(true)}>
  343            <StageCanvas
  344              key={canvas.item.id}
  345              answerId={canvas.item.id}
  346              block={canvas.block}
  347              asked={askedBefore(turns, canvas.item.id)}
  348              closing={closingLine(canvas.turn)}
  349              live={live}
  350              presence={presence(true, true)}
  351              onCloseAll={() => dismiss(canvas.item)}
  352              onAsk={onAsk}
  353              onPin={
  354                onPin === undefined ? undefined : () => onPin(canvas.item.id)
  355              }
  356            />
  357          </Suspense>
  358        )}
  359
  360        {shown === null || canvas !== null ? null : (
  361          <section
  362            aria-labelledby={`${listId}-shown-title`}
  363            className="flex max-h-[60dvh] w-full flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface)"
  364            data-q-shown={shown.id}
  365          >
  366            {/* Its title and Dismiss stay in view while the object scrolls. */}
  367            <div
  368              className="flex min-h-11 flex-none items-center justify-between gap-2 border-b border-(--cq-border-subtle) py-1 pr-1 pl-4"
  369              data-q-shown-header
  370            >
  371              <h2
  372                id={`${listId}-shown-title`}
  373                className="cq-body min-w-0 truncate font-medium text-(--cq-text-primary)"
  374              >
  375                {shown.title}
  376              </h2>
  377              <button
  378                type="button"
  379                className="cq-stage-quiet min-h-11 min-w-11 justify-center"
  380                aria-label={`Dismiss ${shown.title}`}
  381                onClick={() => dismiss(shown)}
  382                data-q-shown-dismiss
  383              >
  384                <X
  385                  aria-hidden="true"
  386                  size={ICON_SIZE.compact}
  387                  strokeWidth={ICON_STROKE}
  388                />
  389              </button>
  390            </div>
  391            <div className="min-h-0 overflow-y-auto p-4" data-q-shown-body>
  392              <Suspense fallback={null}>
  393                <QResultBlocks
  394                  blocks={shown.blocks}
  395                  onAsk={onAsk}
  396                  onOpenArtifact={onOpenArtifact}
  397                />
  398              </Suspense>
  399            </div>
  400          </section>
  401        )}
  402
  403        {roomShown ? (
  404          <Suspense fallback={null}>
  405            <QRoomStage
  406              open={roomOpen}
  407              note={room.note}
  408              onClose={(card) =>
  409                setClosedByHand({ key: card.key, at: card.openedAt })
  410              }
  411              load={loadRoomCard}
  412              turns={turns}
  413              deckLoaders={deckLoaders}
  414            />
  415          </Suspense>
  416        ) : null}
  417
  418        {/* Q room W3: the document Q opened shows here (material-viewer). */}
  419        <div
  420          ref={registerRoomDocumentHost}
  421          className="w-full empty:hidden"
  422          data-q-room-document-host
  423        />
  424
  425        {answered ? (
  426          <Suspense fallback={null}>
  427            <QRoomPdfOffer
  428              turns={turns}
  429              file={exportAnswer}
  430              opened={openedWith}
  431            />
  432          </Suspense>
  433        ) : null}
  434
  435        {waiting}
  436
  437        {recent.length === 0 ? null : (
  438          <div
  439            className="flex w-full flex-col items-center gap-2"
  440            data-q-shown-recently
  441          >
  442            <button
  443              type="button"
  444              className="cq-stage-quiet"
  445              aria-expanded={listOpen}
  446              aria-controls={listId}
  447              onClick={() => setListOpen((open) => !open)}
  448            >
  449              <History
  450                aria-hidden="true"
  451                size={ICON_SIZE.compact}
  452                strokeWidth={ICON_STROKE}
  453              />
  454              Shown recently
  455            </button>
  456            {listOpen ? (
  457              <ul
  458                id={listId}
  459                className="flex w-full flex-col gap-1"
  460                aria-label="Shown recently"
  461              >
  462                {recent.map((item) => (
  463                  <li key={item.id}>
  464                    <button
  465                      type="button"
  466                      className="cq-stage-quiet w-full justify-start"
  467                      onClick={() => {
  468                        setReopened({ id: item.id, atAnswer: answers });
  469                        setListOpen(false);
  470                      }}
  471                      data-q-shown-reopen={item.id}
  472                    >
  473                      {item.title}
  474                    </button>
  475                  </li>
  476                ))}
  477              </ul>
  478            ) : null}
  479          </div>
  480        )}
  481      </div>
  482    );
  483  }
```

# Evidence: apps/web/src/features/q/room/room-stage.ts (lines 1-247)

- Original path: `apps/web/src/features/q/room/room-stage.ts`
- Line range: 1-247 (HEAD 520bd123)
- Why included: room-stage: which SHOW_IN_Q_ROOM card is open, by word matching on later turns.

```
    1  import type { QShowInQRoomIntent } from "@capital-q/contracts";
    2
    3  import type { QTurn, QTurnPublicSource } from "../conversation";
    4  import { wireNow } from "../wire";
    5
    6  /**
    7   * Q room R4: which card is open in the room, decided by code from the
    8   * conversation itself (founder clarification, 6 October): a card stays
    9   * only while the conversation is on its subject. A new subject closes it
   10   * straight away, with a quiet "Closed … as we moved on"; the subject
   11   * coming back reopens it; "close it" closes it. Derived from the turns, so
   12   * the same conversation always shows the same room, after a reload too.
   13   *
   14   * The reading is words and structure, never a model: a card's subject is
   15   * its record's own name (the server's, never the model's) and its kind.
   16   */
   17
   18  export type RoomCard = {
   19    /** One card per kind and record. */
   20    readonly key: string;
   21    readonly intent: QShowInQRoomIntent;
   22    /** For SOURCES: the public sources of the answer that showed it. */
   23    readonly sources: readonly QTurnPublicSource[];
   24    /** The index of the turn that opened (or reopened) it. */
   25    readonly openedAt: number;
   26  };
   27
   28  export type RoomNote = { readonly id: string; readonly text: string };
   29
   30  export type RoomStage = {
   31    readonly open: RoomCard | null;
   32    /** Cards shown in this conversation and not open now, newest first. */
   33    readonly closed: readonly RoomCard[];
   34    /** The latest "Closed … as we moved on", keyed by the turn that moved on. */
   35    readonly note: RoomNote | null;
   36  };
   37
   38  const keyOf = (intent: QShowInQRoomIntent) =>
   39    `${intent.object}:${intent.id ?? "-"}`;
   40
   41  function folded(text: string): string {
   42    return text
   43      .toLowerCase()
   44      .normalize("NFKD")
   45      .replace(/[^\p{L}\p{N}]+/gu, " ")
   46      .trim();
   47  }
   48
   49  const GENERIC = new Set([
   50    "the",
   51    "and",
   52    "with",
   53    "round",
   54    "chat",
   55    "capital",
   56    "fund",
   57    "partners",
   58    "ventures",
   59    "limited",
   60    "ltd",
   61    "inc",
   62    "fictional",
   63    "sources",
   64    "plan",
   65  ]);
   66
   67  /** The words that name a card's subject: its record's name, then its kind. */
   68  function subjectWords(intent: QShowInQRoomIntent): {
   69    readonly names: readonly string[];
   70    readonly kinds: readonly string[];
   71  } {
   72    const names = folded(intent.title)
   73      .split(" ")
   74      .filter((word) => word.length >= 4 && !GENERIC.has(word));
   75    const kinds: Record<QShowInQRoomIntent["object"], readonly string[]> = {
   76      COMPANY_PROFILE: ["profile"],
   77      DATA_ROOM: ["data room", "dataroom"],
   78      PITCH_DECK: ["deck", "pitch deck", "slides"],
   79      CHAT_WITH_COMPANY: ["chat", "messages", "conversation with"],
   80      CHAT_WITH_INVESTOR: ["chat", "messages", "conversation with"],
   81      WORK_PLAN: ["plan", "work"],
   82      CAPITAL_ROUND: ["round", "raise"],
   83      GATEQ_APPLICATION: ["application", "applicant"],
   84      SOURCES: ["sources", "news", "articles", "links"],
   85      // The deck stays while they work on it: slides, pictures, edits.
   86      Q_DOCUMENT: [
   87        "deck",
   88        "slide",
   89        "slides",
   90        "document",
   91        "picture",
   92        "photo",
   93        "image",
   94        "upload",
   95        "title",
   96        "one pager",
   97        "memo",
   98      ],
   99      READINESS: ["readiness", "ready", "stop my raise", "pillar", "pillars"],
  100      ACTION_PLAN: ["action plan", "plan", "next step", "steps", "to do"],
  101      FOLLOW_UPS: ["question", "questions", "ask me", "still want"],
  102      ASSUMPTIONS: ["assumption", "assumptions", "test", "ask the founder"],
  103      EVIDENCE_BOARD: ["evidence", "evidenced", "claimed", "board"],
  104      THESIS: ["thesis", "mandate", "suggestion", "suggestions"],
  105      SAVED_COMPARISON: ["compare", "comparison", "saved", "side by side"],
  106      INVESTOR_FIT: ["investors", "investor", "gate", "gates", "criteria"],
  107      READINESS_BLUEPRINT: ["plan", "month", "months", "blueprint", "roadmap"],
  108      INVESTOR_REQUESTS: ["asked", "request", "requests", "questions", "answer"],
  109      DOCUMENT_ACCESS: ["who can see", "access", "shared", "share", "see my"],
  110      INVESTOR_LOOKS_FOR: [
  111        "looks for",
  112        "criteria",
  113        "application",
  114        "apply",
  115        "draft",
  116      ],
  117    };
  118    return { names, kinds: kinds[intent.object] };
  119  }
  120
  121  function has(text: string, phrase: string): boolean {
  122    return ` ${folded(text)} `.includes(` ${phrase} `);
  123  }
  124
  125  /** Whether these words are about the card: its name, or its kind by name. */
  126  export function mentions(text: string, intent: QShowInQRoomIntent): boolean {
  127    const { names, kinds } = subjectWords(intent);
  128    return (
  129      names.some((name) => has(text, name)) ||
  130      kinds.some((kind) => has(text, kind))
  131    );
  132  }
  133
  134  /** "Close it", "close that card", "hide it", "dismiss": the person's word. */
  135  export function asksToClose(text: string): boolean {
  136    return /^\s*(please\s+)?(close|hide|dismiss|put away)\b(\s+(it|that|this|the card|that card|this card|them|the window))?\s*(please)?[.!]?\s*$/i.test(
  137      text,
  138    );
  139  }
  140
  141  const POINTING = [
  142    "it",
  143    "its",
  144    "this",
  145    "that",
  146    "these",
  147    "those",
  148    "them",
  149    "their",
  150    "they",
  151    "here",
  152    "there",
  153    "next",
  154    "previous",
  155    "page",
  156    "more",
  157    "else",
  158  ];
  159
  160  /** A follow-up that points back at what is open rather than naming anew. */
  161  function pointsBack(text: string): boolean {
  162    return POINTING.some((word) => has(text, word));
  163  }
  164
  165  /** Q room W5: the documents Q makes that open in the room as a deck surface. */
  166  const ROOM_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  167    "PITCH_DECK",
  168    "ONE_PAGER",
  169    "MEMO",
  170  ]);
  171
  172  function showsOf(turn: Extract<QTurn, { kind: "Q" }>): QShowInQRoomIntent[] {
  173    const out: QShowInQRoomIntent[] = [];
  174    // W7: checked against the wire's contracts; none until they are in.
  175    const QShowInQRoomIntentSchema = wireNow()?.QShowInQRoomIntentSchema;
  176    if (QShowInQRoomIntentSchema === undefined) return out;
  177    for (const block of turn.blocks) {
  178      // Q room W5: a deck, one-pager or memo Q made or changed in this
  179      // answer opens in the room (its card on the answer is the record).
  180      if (
  181        block.kind === "ARTIFACT_REFERENCE" &&
  182        ROOM_DOCUMENT_TYPES.has(block.type)
  183      ) {
  184        const parsed = QShowInQRoomIntentSchema.safeParse({
  185          kind: "SHOW_IN_Q_ROOM",
  186          object: "Q_DOCUMENT",
  187          id: block.artifactId,
  188          title: block.title.slice(0, 120),
  189        });
  190        if (parsed.success) out.push(parsed.data);
  191        continue;
  192      }
  193      if (block.kind !== "UI_INTENT") continue;
  194      const parsed = QShowInQRoomIntentSchema.safeParse(block.intent);
  195      if (parsed.success) out.push(parsed.data);
  196    }
  197    return out;
  198  }
  199
  200  /** What a closing note calls the card. */
  201  export function describeCard(intent: QShowInQRoomIntent): string {
  202    switch (intent.object) {
  203      case "COMPANY_PROFILE":
  204        return `${intent.title}'s profile`;
  205      case "DATA_ROOM":
  206        return `${intent.title}'s data room`;
  207      case "PITCH_DECK":
  208        return `${intent.title}'s pitch deck`;
  209      case "CHAT_WITH_COMPANY":
  210      case "CHAT_WITH_INVESTOR":
  211        return `the chat with ${intent.title}`;
  212      case "WORK_PLAN":
  213        return `the plan for ${intent.title}`;
  214      case "CAPITAL_ROUND":
  215        return intent.title;
  216      case "GATEQ_APPLICATION":
  217        return `${intent.title}'s application`;
  218      case "SOURCES":
  219        return "the sources";
  220      case "Q_DOCUMENT":
  221        return intent.title;
  222      case "READINESS":
  223        return "your readiness";
  224      case "ACTION_PLAN":
  225        return "your action plan";
  226      case "FOLLOW_UPS":
  227        return "Q's questions";
  228      case "ASSUMPTIONS":
  229        return `the assumptions to test on ${intent.title}`;
  230      case "EVIDENCE_BOARD":
  231        return `the evidence board for ${intent.title}`;
  232      case "THESIS":
  233        return "how Q reads your thesis";
  234      case "SAVED_COMPARISON":
  235        return "your saved companies side by side";
  236      case "INVESTOR_FIT":
  237        return "investors by what they publish";
  238      case "READINESS_BLUEPRINT":
  239        return "your 3/6/12-month plan";
  240      case "INVESTOR_REQUESTS":
  241        return "what investors asked you for";
  242      case "DOCUMENT_ACCESS":
  243        return "who can see your documents";
  244      case "INVESTOR_LOOKS_FOR":
  245        return `what ${intent.title} looks for`;
  246    }
  247  }
```

# Evidence: apps/web/src/features/q/answer-canvas-logic.ts (lines 80-169)

- Original path: `apps/web/src/features/q/answer-canvas-logic.ts`
- Line range: 80-169 (HEAD 520bd123)
- Why included: focusForSaid/topicMovedOn: cards follow names Q says; replaced when a later answer names none.

```
   80  /**
   81   * The card a spoken sentence is about: the card it names first. Names
   82   * are matched as whole words, case and punctuation aside ("Norrland's"
   83   * names Norrland Grid only when the full name is said, and a name that
   84   * appears inside a longer word is not a mention). Null: the sentence
   85   * names none of them, and focus stays where it is.
   86   */
   87  export function focusForSaid(
   88    cards: readonly Pick<QAnswerCard, "name">[],
   89    sentence: string,
   90  ): number | null {
   91    const said = ` ${folded(sentence)} `;
   92    let best: number | null = null;
   93    let bestAt = Number.POSITIVE_INFINITY;
   94    for (const [index, card] of cards.entries()) {
   95      const name = folded(card.name);
   96      if (name.length === 0) continue;
   97      const at = said.indexOf(` ${name} `);
   98      if (at >= 0 && at < bestAt) {
   99        best = index;
  100        bestAt = at;
  101      }
  102    }
  103    return best;
  104  }
  105
  106  export type PlaybackStep = {
  107    readonly focus: number;
  108    readonly said: string;
  109    readonly ms: number;
  110  };
  111
  112  /** Time to say a line aloud, near speaking pace, never rushed. */
  113  export function sayingMs(text: string): number {
  114    const words = text.trim().split(/\s+/u).filter(Boolean).length;
  115    return Math.max(2600, Math.round(words * 360));
  116  }
  117
  118  /**
  119   * The walk-through of an answer when no live voice is driving it: each
  120   * card in focus while its line is said, then the overview (focus -1) with
  121   * Q's closing line. A card with no line of its own is said by its first
  122   * reason.
  123   */
  124  export function playbackSteps(
  125    block: QAnswerCardsBlock,
  126    closing: string,
  127  ): readonly PlaybackStep[] {
  128    const steps: PlaybackStep[] = block.cards.map((card, focus) => {
  129      const said = card.said ?? `${card.name}: ${card.reasons[0] ?? ""}`.trim();
  130      return { focus, said, ms: sayingMs(said) };
  131    });
  132    if (block.cards.length > 1) {
  133      steps.push({ focus: -1, said: closing, ms: 0 });
  134    }
  135    return steps;
  136  }
  137
  138  /** An answer's ANSWER_CARDS block, if it carries one. */
  139  export function answerCardsOf(
  140    turn: QTurn | undefined,
  141  ): QAnswerCardsBlock | null {
  142    if (turn === undefined || turn.kind !== "Q") return null;
  143    for (const block of turn.blocks) {
  144      if (block.kind === "ANSWER_CARDS") return block;
  145    }
  146    return null;
  147  }
  148
  149  /**
  150   * Whether the conversation has moved on from the cards that answer
  151   * `answerId` showed (C4). It has when a later answer, now complete,
  152   * either brings cards of its own (they replace these) or names none of
  153   * these cards. A later answer that names one of them is a follow-up on
  154   * the same cards, and they stay. Decided by names, never by phrases.
  155   */
  156  export function topicMovedOn(
  157    turns: readonly QTurn[],
  158    answerId: string,
  159  ): boolean {
  160    const at = turns.findIndex((turn) => turn.id === answerId);
  161    const own = answerCardsOf(turns[at]);
  162    if (at < 0 || own === null) return false;
  163    for (const turn of turns.slice(at + 1)) {
  164      if (turn.kind !== "Q" || turn.streaming) continue;
  165      if (answerCardsOf(turn) !== null) return true;
  166      if (focusForSaid(own.cards, turn.text) === null) return true;
  167    }
  168    return false;
  169  }
```
