# Evidence: apps/web/src/features/briefing/arrival-dock.tsx (lines 1-56)

- Original path: `apps/web/src/features/briefing/arrival-dock.tsx`
- Line range: 1-56 (HEAD 520bd123)
- Why included: Complete: compact arrival beside the dock on every page but /home.

```
    1  "use client";
    2
    3  import { usePathname } from "next/navigation";
    4  import { useEffect, useState } from "react";
    5
    6  import { useQSessionOptional } from "@/features/q/q-session";
    7
    8  import { ArrivalBriefing } from "./arrival-briefing";
    9  import { useArrivalStatus } from "./arrival-store";
   10
   11  /** The Q page gives the briefing itself; everywhere else, the dock does. */
   12  const Q_PAGE = "/home";
   13  /** After the last card, the dock's line stays this long, then goes. */
   14  const SETTLE_MS = 4_000;
   15
   16  /**
   17   * The compact arrival briefing beside Q's dock on every page but the Q
   18   * page (Zino, 2026-10-08): the greeting and lowdown in a line, the card in
   19   * focus with the same four verbs, the count of the rest. Floats above the
   20   * page, never over it: it can be closed, and "Not now" leaves the cards in
   21   * Needs you on Work.
   22   */
   23  export function ArrivalDock() {
   24    const pathname = usePathname();
   25    const session = useQSessionOptional();
   26    const [closed, setClosed] = useState(false);
   27    const [settled, setSettled] = useState(false);
   28    // New cards later (an agent needs them): the dock opens again.
   29    const status = useArrivalStatus();
   30    const round = status.kind === "READY" ? status.round : 0;
   31    const [shownRound, setShownRound] = useState(round);
   32    if (round !== shownRound) {
   33      setShownRound(round);
   34      setClosed(false);
   35      setSettled(false);
   36    }
   37    useEffect(() => {
   38      if (!settled) return;
   39      const timer = window.setTimeout(() => setClosed(true), SETTLE_MS);
   40      return () => window.clearTimeout(timer);
   41    }, [settled]);
   42    if (session === null || pathname === Q_PAGE || closed) return null;
   43    return (
   44      <aside
   45        aria-label="Q's briefing"
   46        className="fixed right-4 bottom-24 z-(--cq-z-presence) flex w-[min(380px,calc(100vw-32px))] flex-col rounded-(--cq-radius-xl) border border-(--cq-border) bg-(--cq-surface-raised) p-3.5 shadow-(--cq-shadow-overlay) empty:hidden sm:bottom-6"
   47        data-arrival-dock
   48      >
   49        <ArrivalBriefing
   50          variant="dock"
   51          onSettled={() => setSettled(true)}
   52          onClose={() => setClosed(true)}
   53        />
   54      </aside>
   55    );
   56  }
```

# Evidence: apps/web/src/components/app-shell/global-q.tsx (lines 270-290)

- Original path: `apps/web/src/components/app-shell/global-q.tsx`
- Line range: 270-290 (HEAD 520bd123)
- Why included: Global Q mounts: sheet, runner, answer chip, ArrivalDock, sounds, edge flow, wake word, dock.

```
  270    return (
  271      <QSubjectProvider own={subject}>
  272        <QSessionProvider connected={connected}>
  273          <GlobalQContext.Provider value={value}>
  274            {children}
  275            <GlobalQSheet />
  276            <GlobalQRunner />
  277            <AnswerChip />
  278            {/* The arrival briefing beside the dock on every other page. */}
  279            <ArrivalDock />
  280            <QSounds />
  281            {/* ADR 0062: particles around the page edge while Q works. */}
  282            <QEdgeFlow />
  283            {/* D1: "Hey Q"; off by default, and nothing loads while off. */}
  284            <WakeWord openQ={openQ} />
  285            {dock}
  286          </GlobalQContext.Provider>
  287        </QSessionProvider>
  288      </QSubjectProvider>
  289    );
  290  }
```

# Evidence: apps/web/src/features/q-dock/q-dock.tsx (lines 48-70)

- Original path: `apps/web/src/features/q-dock/q-dock.tsx`
- Line range: 48-70 (HEAD 520bd123)
- Why included: Dock presentations (minimal/compact/stashed).

```
   48  /**
   49   * The Q Dock (ADR 0017 F1; spec §6): Q, floating, on every page but the
   50   * Q page, which is Q itself.
   51   *
   52   * Three presentations of the one conversation store:
   53   * - **minimal**, the aperture in a 44 px button, its word on hover/focus;
   54   * - **compact**, a pill while Q works, an approval waits, or a voice line
   55   *   is open: the task, its stage, the mic-live mark and Stop;
   56   * - **stashed**, a 12 px tab after a throw past an edge; a tap restores it.
   57   * Pressing it opens Q beside the page (the expanded panel); "Open Q" there
   58   * carries the same conversation to the Q page, the aperture morphing into
   59   * the stage (`q-aperture`), with nothing read again and the line unbroken.
   60   *
   61   * It moves only for a reason: the person drags or throws it (it lands on
   62   * the nearest of six anchors on a desktop, four on a phone), a registered
   63   * control would be covered (it glides to the nearest free anchor), or the
   64   * menu moves it -- right click, long press, or Shift+F10 -- which is the
   65   * non-drag way to do everything a drag does (WCAG 2.5.7).
   66   *
   67   * It never covers a control or a heading (`placeDock`): every interactive
   68   * element and heading on screen is an obstacle, on every page. Where the
   69   * pill fits nowhere it shows as the minimal button instead.
   70   */
```
