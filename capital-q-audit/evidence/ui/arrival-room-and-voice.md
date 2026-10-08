# Evidence: apps/web/src/features/briefing/arrival-room.tsx (lines 1-94)

- Original path: `apps/web/src/features/briefing/arrival-room.tsx`
- Line range: 1-94 (HEAD 520bd123)
- Why included: Complete module: the side columns ('room') beside Q's presence; slots are a module-level store filled only by the arrival briefing.

```
    1  "use client";
    2
    3  import { useCallback, useSyncExternalStore, type ReactNode } from "react";
    4
    5  import { cx } from "@capital-q/ui";
    6
    7  /**
    8   * The arrival room (Zino, 2026-10-08: "what if they appeared by the sides
    9   * of the Q -- right and left of Q if there are many; if there's no space,
   10   * bring them down"). The Q stage places two empty columns either side of
   11   * Q's presence; the briefing, wherever it is rendered, puts its cards into
   12   * them on a wide screen and below Q otherwise. Browser-only, per page.
   13   */
   14
   15  type Slots = {
   16    readonly left: HTMLElement | null;
   17    readonly right: HTMLElement | null;
   18    /** The briefing has cards in the columns (the stage widens for them). */
   19    readonly filled: boolean;
   20  };
   21
   22  let slots: Slots = { left: null, right: null, filled: false };
   23  const listeners = new Set<() => void>();
   24  const EMPTY: Slots = { left: null, right: null, filled: false };
   25
   26  function set(next: Partial<Slots>): void {
   27    slots = { ...slots, ...next };
   28    for (const notify of listeners) notify();
   29  }
   30
   31  function subscribe(notify: () => void): () => void {
   32    listeners.add(notify);
   33    return () => {
   34      listeners.delete(notify);
   35    };
   36  }
   37
   38  export function useRoomSlots(): Slots {
   39    return useSyncExternalStore(
   40      subscribe,
   41      () => slots,
   42      () => EMPTY,
   43    );
   44  }
   45
   46  /** The briefing says whether its cards are in the columns. */
   47  export function setRoomFilled(filled: boolean): void {
   48    if (slots.filled !== filled) set({ filled });
   49  }
   50
   51  /** One column beside Q's presence; empty until the briefing fills it. */
   52  export function RoomSlot({
   53    side,
   54    className,
   55  }: {
   56    readonly side: "left" | "right";
   57    readonly className?: string | undefined;
   58  }) {
   59    const ref = useCallback(
   60      (node: HTMLDivElement | null) => {
   61        set(side === "left" ? { left: node } : { right: node });
   62      },
   63      [side],
   64    );
   65    return (
   66      <div
   67        ref={ref}
   68        className={cx("flex min-w-0 flex-col gap-3", className)}
   69        data-q-room-slot={side}
   70      />
   71    );
   72  }
   73
   74  /**
   75   * Q's presence with a column either side. The columns take space only
   76   * while the briefing fills them, and only on a wide screen.
   77   */
   78  export function ArrivalRoom({ children }: { readonly children: ReactNode }) {
   79    const { filled } = useRoomSlots();
   80    return (
   81      <div
   82        className={cx(
   83          "flex w-full flex-col items-center",
   84          filled &&
   85            "lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-8",
   86        )}
   87        data-q-room={filled ? "filled" : "empty"}
   88      >
   89        <RoomSlot side="left" className="hidden lg:flex" />
   90        <div className="flex flex-col items-center gap-6">{children}</div>
   91        <RoomSlot side="right" className="hidden lg:flex" />
   92      </div>
   93    );
   94  }
```

# Evidence: apps/web/src/features/briefing/arrival-voice.ts (lines 1-29)

- Original path: `apps/web/src/features/briefing/arrival-voice.ts`
- Line range: 1-29 (HEAD 520bd123)
- Why included: Complete: what Q says first on a call (arrival briefing words, 2.5s wait).

```
    1  import { arrivalWords } from "./arrival";
    2  import { arrivalBriefingAction } from "./arrival-actions";
    3  import { arrivalForVoice } from "./arrival-store";
    4
    5  /** How long a call waits for the briefing's reads before a plain hello. */
    6  const VOICE_BRIEFING_WAIT_MS = 2_500;
    7
    8  function browserZone(): string | null {
    9    try {
   10      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
   11    } catch {
   12      return null;
   13    }
   14  }
   15
   16  /**
   17   * What Q says first on a new call (Zino, 2026-10-08): the arrival
   18   * briefing (greeting by their clock, what was done, the decisions
   19   * waiting), never a generic "what would you like to work on?". Null only
   20   * when the briefing could not be read in time.
   21   */
   22  export async function voiceBriefing(): Promise<string | null> {
   23    const data = await arrivalForVoice(
   24      (since) => arrivalBriefingAction(since),
   25      VOICE_BRIEFING_WAIT_MS,
   26    );
   27    if (data === null) return null;
   28    return arrivalWords(data, new Date(), browserZone()).spoken;
   29  }
```

# Evidence: apps/web/src/features/voice/line-cards.ts (lines 1-91)

- Original path: `apps/web/src/features/voice/line-cards.ts`
- Line range: 1-91 (HEAD 520bd123)
- Why included: Complete: the seam between decision cards and the open voice line (decide_card decider, focus notes).

```
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
