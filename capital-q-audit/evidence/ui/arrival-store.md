# Evidence: apps/web/src/features/briefing/arrival-store.ts (lines 1-219)

- Original path: `apps/web/src/features/briefing/arrival-store.ts`
- Line range: 1-219 (HEAD 520bd123)
- Why included: Complete: arrival data store shared by the Q page and dock; arrivalForVoice reads the briefing on call start and pushes it on screen.

```
    1  "use client";
    2
    3  import { useEffect, useSyncExternalStore } from "react";
    4
    5  import type { ArrivalData } from "./arrival";
    6  import { decideArrival, onReturn } from "./arrival-gate";
    7
    8  /**
    9   * The arrival briefing's data for this page load, shared by the Q page
   10   * and the dock (whichever is on screen gives it), and what Q says first on
   11   * voice. Browser-only; nothing here persists.
   12   */
   13
   14  export type ArrivalLoader = (
   15    since: string | null,
   16  ) => Promise<ArrivalData | null>;
   17
   18  export type ArrivalStatus =
   19    | { readonly kind: "PENDING" }
   20    /** No briefing on this page load (not an arrival, or nothing read). */
   21    | { readonly kind: "NONE" }
   22    | {
   23        readonly kind: "READY";
   24        readonly data: ArrivalData;
   25        readonly round: number;
   26        /** Cards that came in later (no greeting, a gentle nudge). */
   27        readonly nudge: boolean;
   28      };
   29
   30  let status: ArrivalStatus = { kind: "PENDING" };
   31  let started = false;
   32  let round = 0;
   33  const subscribers = new Set<() => void>();
   34  /** Q's first words on voice when the briefing is given (greeting, lowdown, first card). */
   35  let spoken: string | null = null;
   36  /**
   37   * What this page load already went through: cards decided or put off, the
   38   * person leaving the sequence, the round already greeted. Moving between
   39   * pages never greets twice or brings a decided card back.
   40   */
   41  const handled = new Set<string>();
   42  let leftRound = -1;
   43  let greetedRound = -1;
   44
   45  function set(next: ArrivalStatus): void {
   46    status = next;
   47    for (const notify of subscribers) notify();
   48  }
   49
   50  function subscribe(notify: () => void): () => void {
   51    subscribers.add(notify);
   52    return () => {
   53      subscribers.delete(notify);
   54    };
   55  }
   56
   57  const PENDING: ArrivalStatus = { kind: "PENDING" };
   58
   59  async function load(
   60    loader: ArrivalLoader,
   61    since: string | null,
   62    nudge: boolean,
   63  ): Promise<void> {
   64    const data = await loader(since).catch(() => null);
   65    round += 1;
   66    if (data === null) {
   67      if (!nudge) set({ kind: "NONE" });
   68      return;
   69    }
   70    set({ kind: "READY", data, round, nudge });
   71  }
   72
   73  /** Starts this page load's briefing once; later calls share it. */
   74  export function startArrival(loader: ArrivalLoader): void {
   75    if (started) return;
   76    started = true;
   77    const gate = decideArrival();
   78    if (!gate.give) {
   79      set({ kind: "NONE" });
   80    } else {
   81      void load(loader, gate.since, false);
   82    }
   83    // Back on this page after two hours away: a new arrival.
   84    onReturn((again) => {
   85      void load(loader, again.since, false);
   86    });
   87  }
   88
   89  function currentStatus(): ArrivalStatus {
   90    return status;
   91  }
   92
   93  /**
   94   * A call is starting: the briefing's data, read now if this page load has
   95   * none (the gate gives the cards once per browser session, but a call is
   96   * the person asking to be briefed; live 2026-10-08 11:13 a call opened
   97   * "What would you like to work on today?" because the gate had said no).
   98   * What it reads is put on screen too, so the cards Q names are there to
   99   * decide. Null when nothing could be read in time.
  100   */
  101  export async function arrivalForVoice(
  102    loader: ArrivalLoader,
  103    timeoutMs: number,
  104  ): Promise<ArrivalData | null> {
  105    let data: ArrivalData | null;
  106    if (status.kind === "READY") {
  107      data = status.data;
  108    } else {
  109      let timer: ReturnType<typeof setTimeout> | undefined;
  110      const late = new Promise<null>((resolve) => {
  111        timer = setTimeout(() => resolve(null), timeoutMs);
  112      });
  113      data = await Promise.race([
  114        loader(decideArrival().since).catch(() => null),
  115        late,
  116      ]);
  117      clearTimeout(timer);
  118      // Read again: the page's own load may have landed while this waited.
  119      if (data !== null && currentStatus().kind !== "READY") {
  120        started = true;
  121        round += 1;
  122        set({ kind: "READY", data, round, nudge: false });
  123      }
  124    }
  125    if (data === null) return null;
  126    return {
  127      ...data,
  128      cards: data.cards.filter((card) => !handled.has(card.key)),
  129    };
  130  }
  131
  132  /** New decisions arrived later (an agent needs them): the cards again. */
  133  export function refreshArrival(loader: ArrivalLoader): void {
  134    void load(loader, null, true);
  135  }
  136
  137  export function useArrival(loader: ArrivalLoader): ArrivalStatus {
  138    useEffect(() => {
  139      startArrival(loader);
  140    }, [loader]);
  141    return useSyncExternalStore(
  142      subscribe,
  143      () => status,
  144      () => PENDING,
  145    );
  146  }
  147
  148  /** The briefing's state, without starting it (for surfaces around it). */
  149  export function useArrivalStatus(): ArrivalStatus {
  150    return useSyncExternalStore(
  151      subscribe,
  152      () => status,
  153      () => PENDING,
  154    );
  155  }
  156
  157  export function setArrivalSpoken(words: string | null): void {
  158    spoken = words;
  159  }
  160
  161  /** What Q says first on voice when the briefing was given; null otherwise. */
  162  export function arrivalSpoken(): string | null {
  163    return spoken;
  164  }
  165
  166  /** Whether this page load gives a briefing (decided, or about to be). */
  167  export function arrivalPending(): boolean {
  168    return status.kind === "PENDING" && started;
  169  }
  170
  171  /** A card decided or put off on this page load. */
  172  export function markHandled(key: string): void {
  173    handled.add(key);
  174  }
  175
  176  export function isHandled(key: string): boolean {
  177    return handled.has(key);
  178  }
  179
  180  /** The person left the sequence for this round. */
  181  export function markLeft(round: number): void {
  182    leftRound = round;
  183  }
  184
  185  export function leftIn(round: number): boolean {
  186    return leftRound === round;
  187  }
  188
  189  /** Greets once per round; true the first time it is asked for a round. */
  190  export function claimGreeting(round: number): boolean {
  191    if (greetedRound === round) return false;
  192    greetedRound = round;
  193    return true;
  194  }
  195
  196  /**
  197   * A line said just before the cards are read again (a retry's outcome),
  198   * kept for the next sequence to show: re-reading never swallows it.
  199   */
  200  let carried: string | null = null;
  201  export function carryStatus(text: string | null): void {
  202    carried = text;
  203  }
  204  export function takeCarriedStatus(): string | null {
  205    const text = carried;
  206    carried = null;
  207    return text;
  208  }
  209
  210  /** For the dev harness and tests: start over. */
  211  export function resetArrival(): void {
  212    status = { kind: "PENDING" };
  213    started = false;
  214    spoken = null;
  215    handled.clear();
  216    leftRound = -1;
  217    greetedRound = -1;
  218    carried = null;
  219  }
```
