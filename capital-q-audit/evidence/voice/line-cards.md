# Evidence: apps/web/src/features/voice/line-cards.ts (lines 1-91)

- Original path: `apps/web/src/features/voice/line-cards.ts`
- Line range: 1-91 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: cardInFocus() = decider registered && standing note; routes short turns to MODEL.

```ts
    1  /**
    2   * The seam between a page's decision cards and an open voice line (arrival
    3   * briefing, Zino 2026-10-08: "ask me about them in cards and also speaking
    4   * to me"). Browser-only and per page load:
    5   *
    6   * - the card surface registers one decider; the duplex line hands it the
    7   *   person's reply to the card in focus (`decide_card`), with the
    8   *   provider's transcript of their own words;
    9   * - the card surface sends notes to the line ("this card is in focus",
   10   *   "that one went"), which the voice says in its own words.
   11   *
   12   * Nothing here decides anything: the decider is the card sequence's own
   13   * code, the same one the buttons use.
   14   */
   15
   16  export type CardDecider = (input: {
   17    /** What the voice model passed as their words. */
   18    readonly words: string;
   19    /** The provider's transcript of their own last turn, when it came. */
   20    readonly heard: string | null;
   21  }) => Promise<Readonly<Record<string, unknown>>>;
   22
   23  let decider: CardDecider | null = null;
   24
   25  /** The one decider for this page; returns its unregister. */
   26  export function registerCardDecider(next: CardDecider): () => void {
   27    decider = next;
   28    return () => {
   29      if (decider === next) decider = null;
   30    };
   31  }
   32
   33  /** The tool's output for a `decide_card` call, or null with no cards. */
   34  export async function decideCardByVoice(
   35    rawArguments: string,
   36    heard: string | null,
   37  ): Promise<string | null> {
   38    const current = decider;
   39    if (current === null) return null;
   40    let words = "";
   41    try {
   42      const parsed: unknown = JSON.parse(rawArguments);
   43      if (
   44        typeof parsed === "object" &&
   45        parsed !== null &&
   46        "words" in parsed &&
   47        typeof parsed.words === "string"
   48      ) {
   49        words = parsed.words.slice(0, 700);
   50      }
   51    } catch {
   52      // Not their words: decided from what was heard alone, or not at all.
   53    }
   54    return JSON.stringify(await current({ words, heard }));
   55  }
   56
   57  type NoteListener = (note: string, respond: boolean) => void;
   58  const listeners = new Set<NoteListener>();
   59  /** What a line opened now should know about the screen (the card in focus). */
   60  let standing: string | null = null;
   61
   62  /** An open line listens for notes while it is up. */
   63  export function onLineNote(listener: NoteListener): () => void {
   64    listeners.add(listener);
   65    // A line opened while a card is in focus is told about it at once.
   66    if (standing !== null) listener(standing, false);
   67    return () => {
   68      listeners.delete(listener);
   69    };
   70  }
   71
   72  /** The note every newly opened line gets; null when nothing is in focus. */
   73  export function setStandingNote(note: string | null): void {
   74    standing = note;
   75  }
   76
   77  /** VOICE-BRAIN: a decision card is in focus now (its reply is the card's). */
   78  export function cardInFocus(): boolean {
   79    return decider !== null && standing !== null;
   80  }
   81
   82  /** Whether a line that can take notes is open now. */
   83  export function lineTakesNotes(): boolean {
   84    return listeners.size > 0;
   85  }
   86
   87  /** A note to the open line, if any; `respond`: Q says something now. */
   88  export function noteToLine(note: string, respond: boolean): boolean {
   89    for (const listener of listeners) listener(note, respond);
   90    return listeners.size > 0;
   91  }
```

# Evidence: apps/web/src/features/briefing/arrival-briefing.tsx (lines 750-791)

- Original path: `apps/web/src/features/briefing/arrival-briefing.tsx`
- Line range: 750-791 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Who sets the standing note and the decider.

```ts
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
```
