# Evidence: apps/web/src/features/briefing/arrival-briefing.tsx (lines 695-823)

- Original path: `apps/web/src/features/briefing/arrival-briefing.tsx`
- Line range: 695-823 (HEAD 520bd123)
- Why included: Sequence: flank (cards portalled into the room slots only when wide, slots mounted, and a card active); registers the voice card decider only while mounted.

```
  695  /** The cards, one in focus, the others a line each; around Q when wide. */
  696  function Sequence({
  697    data,
  698    decide,
  699    readWords,
  700    compact,
  701    nudge,
  702    round,
  703    onSettled,
  704    reload,
  705  }: {
  706    readonly data: ArrivalData;
  707    readonly decide: ArrivalDecide;
  708    readonly readWords: ArrivalReadWords;
  709    readonly compact: boolean;
  710    readonly nudge: boolean;
  711    readonly round: number;
  712    readonly onSettled?: (() => void) | undefined;
  713    /** New cards may be waiting (a retry): read the briefing again. */
  714    readonly reload: () => void;
  715  }) {
  716    const { state, status, reading, send, runWords } = useSequence(
  717      data.cards,
  718      decide,
  719      reload,
  720      readWords,
  721    );
  722    const reduced = useReducedMotion() === true;
  723    // What this sequence settled stays settled across pages (arrival-store).
  724    useEffect(() => {
  725      for (const key of Object.keys(state.outcomes)) markHandled(key);
  726      if (state.left) markLeft(round);
  727    }, [state.outcomes, state.left, round]);
  728    const card = focusedCard(state);
  729    const current =
  730      card === null ? undefined : data.cards.find((one) => one.key === card.key);
  731    const left = remainingAfterFocus(state);
  732    const active = current !== undefined;
  733    const settledRef = useRef(onSettled);
  734    useEffect(() => {
  735      settledRef.current = onSettled;
  736    }, [onSettled]);
  737    useEffect(() => {
  738      if (!active) settledRef.current?.();
  739    }, [active]);
  740
  741    // Around Q on a wide Q page; below Q (inline) everywhere else.
  742    const room = useRoomSlots();
  743    const wide = useWide();
  744    const flank =
  745      !compact && wide && room.left !== null && room.right !== null && active;
  746    useEffect(() => {
  747      setRoomFilled(flank);
  748      return () => setRoomFilled(false);
  749    }, [flank]);
  750
  751    // The open line knows which card is in focus; a line opened later too.
  752    useEffect(() => {
  753      setStandingNote(active ? focusNote(data.cards, state) : null);
  754      return () => setStandingNote(null);
  755    }, [active, data.cards, state]);
  756
  757    // Spoken replies: the person's own words, read by the same code as the
  758    // buttons (never the model's say-so); anything else they say about the
  759    // cards is read from their own transcript into the same verbs.
  760    const sendRef = useRef(send);
  761    const wordsRef = useRef(runWords);
  762    useEffect(() => {
  763      sendRef.current = send;
  764      wordsRef.current = runWords;
  765    }, [send, runWords]);
  766    useEffect(() => {
  767      if (!active) return;
  768      return registerCardDecider(async ({ words, heard }) => {
  769        const spoken = readSpokenReply({ words, heard });
  770        if (spoken.kind === "COMMAND") {
  771          return sendRef.current(
  772            { type: "COMMAND", command: spoken.command },
  773            "VOICE",
  774          );
  775        }
  776        // Any other words: only the provider's transcript of the person.
  777        const own = heard?.trim() ?? "";
  778        if (own.length > 0) {
  779          const outcome = await wordsRef.current(own, "VOICE");
  780          if (outcome !== null) return outcome;
  781        }
  782        return spoken.kind === "UNSURE"
  783          ? {
  784              ok: false,
  785              situation:
  786                "Their words didn't come through clearly as a decision. Nothing was done; ask them to say it again or tap the button.",
  787            }
  788          : {
  789              ok: false,
  790              situation:
  791                "That isn't about the cards. Pass their words to ask_q; the cards stay on screen.",
  792            };
  793      });
  794    }, [active]);
  795
  796    // A nudge: a new card while a line is open is mentioned once, gently.
  797    const nudged = useRef(false);
  798    useEffect(() => {
  799      if (!nudge || nudged.current || !active) return;
  800      nudged.current = true;
  801      const note = focusNote(data.cards, state);
  802      if (note !== null) {
  803        noteToLine(
  804          `${note} This just came in from Q's work. At a natural pause, mention it once, gently, in a sentence; don't interrupt them.`,
  805          true,
  806        );
  807      }
  808    }, [nudge, active, data.cards, state]);
  809
  810    if (!active) {
  811      if (state.left) {
  812        return (
  813          <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
  814            Fine. Anything left is in Needs you on Work.
  815          </p>
  816        );
  817      }
  818      return status === null ? null : (
  819        <p className="m-0 cq-body-sm text-(--cq-text-secondary)" role="status">
  820          {status} That&apos;s everything for now.
  821        </p>
  822      );
  823    }
```

# Evidence: apps/web/src/features/briefing/arrival-briefing.tsx (lines 999-1153)

- Original path: `apps/web/src/features/briefing/arrival-briefing.tsx`
- Line range: 999-1153 (HEAD 520bd123)
- Why included: ArrivalBriefing: falls back to the page's own welcome until READY; greets once per round.

```
  999  export function ArrivalBriefing({
 1000    variant,
 1001    fallback = null,
 1002    load = defaultLoad,
 1003    decide = defaultDecide,
 1004    readWords = defaultReadWords,
 1005    now,
 1006    onSettled,
 1007    onClose,
 1008  }: {
 1009    readonly variant: "page" | "dock";
 1010    /** The cards are all decided, or the person left them. */
 1011    readonly onSettled?: (() => void) | undefined;
 1012    /** Dock: the person closed it. */
 1013    readonly onClose?: (() => void) | undefined;
 1014    /** The page's own welcome, shown until (and unless) there is a briefing. */
 1015    readonly fallback?: ReactNode;
 1016    readonly load?: ArrivalLoader;
 1017    readonly decide?: ArrivalDecide;
 1018    /** Reads their own words into card verbs (the dev harness scripts it). */
 1019    readonly readWords?: ArrivalReadWords;
 1020    /** The clock (the dev harness fixes it). */
 1021    readonly now?: (() => Date) | undefined;
 1022  }) {
 1023    const status = useArrival(load);
 1024    useLaterCards(load, status.kind !== "PENDING");
 1025    const loaded = status.kind === "READY" ? status : null;
 1026    // Once per round: the first surface greets; a later one (another page,
 1027    // the Q page again) shows only what is still undecided.
 1028    const [greets, setGreets] = useState<{
 1029      round: number;
 1030      fresh: boolean;
 1031    } | null>(null);
 1032    const claimed = useRef<number | null>(null);
 1033    useEffect(() => {
 1034      if (loaded === null || greets?.round === loaded.round) return;
 1035      // This surface's own claim survives a re-run of the effect.
 1036      const fresh =
 1037        claimed.current === loaded.round || claimGreeting(loaded.round);
 1038      if (fresh) claimed.current = loaded.round;
 1039      setGreets({ round: loaded.round, fresh });
 1040    }, [loaded, greets]);
 1041    const ready = useMemo(() => {
 1042      if (loaded === null || greets?.round !== loaded.round) return null;
 1043      const cards = leftIn(loaded.round)
 1044        ? []
 1045        : loaded.data.cards.filter((card) => !isHandled(card.key));
 1046      return {
 1047        ...loaded,
 1048        // A round already greeted elsewhere: no greeting again, cards only.
 1049        quietHead: loaded.nudge || !greets.fresh,
 1050        data: { ...loaded.data, cards },
 1051      };
 1052    }, [loaded, greets]);
 1053    const words = useMemo(
 1054      () =>
 1055        ready === null
 1056          ? null
 1057          : arrivalWords(ready.data, now?.() ?? new Date(), browserZone()),
 1058      [ready, now],
 1059    );
 1060    useEffect(() => {
 1061      if (words !== null && ready !== null && !ready.quietHead) {
 1062        setArrivalSpoken(words.spoken);
 1063      }
 1064    }, [words, ready]);
 1065
 1066    if (ready === null || words === null) return <>{fallback}</>;
 1067    const compact = variant === "dock";
 1068    // On another page, a quiet day says nothing: the dock does not pop up.
 1069    if (compact && ready.data.cards.length === 0 && words.quiet) return null;
 1070    // Nothing left to put to them, and the greeting was given: the page's
 1071    // own welcome (or, in the dock, nothing).
 1072    if (ready.quietHead && ready.data.cards.length === 0) {
 1073      return compact ? null : <>{fallback}</>;
 1074    }
 1075    return (
 1076      <div
 1077        className={cx(
 1078          "flex w-full flex-col",
 1079          compact ? "gap-2.5" : "items-stretch gap-5",
 1080        )}
 1081        data-arrival={variant}
 1082        data-arrival-quiet={words.quiet ? "" : undefined}
 1083      >
 1084        {ready.quietHead ? (
 1085          variant === "page" ? (
 1086            fallback
 1087          ) : null
 1088        ) : compact ? (
 1089          <div className="flex items-start gap-2">
 1090            <p className="m-0 flex-1 cq-body-sm text-(--cq-text-secondary)">
 1091              <span className="font-semibold text-(--cq-text-primary)">
 1092                {words.greeting}
 1093              </span>{" "}
 1094              {words.lowdown}
 1095              {words.summary === null ? null : (
 1096                <>
 1097                  {" "}
 1098                  <span data-arrival-summary>{words.summary}</span>
 1099                </>
 1100              )}
 1101            </p>
 1102            {onClose === undefined ? null : (
 1103              <Button
 1104                variant="quiet"
 1105                onClick={onClose}
 1106                className="-mt-2 -mr-2 text-(--cq-text-secondary)"
 1107                aria-label="Close Q's briefing"
 1108              >
 1109                Close
 1110              </Button>
 1111            )}
 1112          </div>
 1113        ) : (
 1114          <div className="flex flex-col items-center gap-2 text-center">
 1115            <h1
 1116              id="returning-headline"
 1117              className="cq-title-lg text-balance text-(--cq-text-primary)"
 1118              data-arrival-greeting
 1119            >
 1120              {words.greeting}
 1121            </h1>
 1122            <p
 1123              className="cq-body-lg cq-prose text-balance text-(--cq-text-secondary)"
 1124              data-arrival-lowdown
 1125            >
 1126              {words.lowdown}
 1127            </p>
 1128            {words.summary === null ? null : (
 1129              <p
 1130                className="cq-body cq-prose text-balance text-(--cq-text-primary)"
 1131                data-arrival-summary
 1132              >
 1133                {words.summary}
 1134              </p>
 1135            )}
 1136          </div>
 1137        )}
 1138        {ready.data.cards.length === 0 ? null : (
 1139          <Sequence
 1140            key={ready.round}
 1141            data={ready.data}
 1142            decide={decide}
 1143            readWords={readWords}
 1144            compact={compact}
 1145            nudge={ready.nudge}
 1146            round={ready.round}
 1147            onSettled={onSettled}
 1148            reload={() => refreshArrival(load)}
 1149          />
 1150        )}
 1151      </div>
 1152    );
 1153  }
```
