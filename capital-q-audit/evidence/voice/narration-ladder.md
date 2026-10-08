# Evidence: apps/q-api/src/voice/narration.ts (lines 77-156)

- Original path: `apps/q-api/src/voice/narration.ts`
- Line range: 77-156 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Silence ladder wrapper.

```ts
   77  export async function* withSilenceLadder(
   78    source: AsyncIterable<string>,
   79    options: SilenceLadderOptions,
   80  ): AsyncGenerator<string> {
   81    const now = options.now ?? (() => Date.now());
   82    const iterator = source[Symbol.asyncIterator]();
   83    const started = now();
   84    let state: QSilenceState = Q_SILENCE_START;
   85    let focus: Settled<QSilenceFocus | null> | null = null;
   86    let thread: Settled<QSilenceThread | null> | null = null;
   87    let ladder = options.enabled !== false;
   88    let pending = iterator.next();
   89    for (;;) {
   90      if (!ladder || options.signal?.aborted === true) {
   91        const step = await pending;
   92        if (step.done === true) return;
   93        yield step.value;
   94        pending = iterator.next();
   95        continue;
   96      }
   97      const elapsed = now() - started;
   98      // Reads begin only once the wait is real: a quick answer costs nothing.
   99      // The subject is asked again while unknown: the run's tools may name
  100      // it only after the first beat (W4b: read from the run's own calls).
  101      if (
  102        elapsed >= Q_SILENCE_LADDER.toneAtMs &&
  103        (focus === null || (focus.done() && (focus.value() ?? null) === null))
  104      ) {
  105        const asked = options.focus?.() ?? Promise.resolve(null);
  106        focus = settled(asked);
  107        // A ready answer is used for this beat; a slow one waits for the next.
  108        await Promise.race([
  109          asked.catch(() => null),
  110          new Promise<void>((resolve) => {
  111            setTimeout(resolve, FOCUS_WAIT_MS);
  112          }),
  113        ]);
  114      }
  115      if (thread === null && elapsed >= Q_SILENCE_LADDER.progressAtMs) {
  116        thread = settled(options.thread?.() ?? Promise.resolve(null));
  117      }
  118      const step = nextSilenceBeat(state, {
  119        elapsedMs: elapsed,
  120        stage: options.live.stage,
  121        focus: focus?.value() ?? null,
  122        hushed: false,
  123        approvalWaiting: options.live.approvalWaiting,
  124        thread: thread?.value() ?? null,
  125        seed: options.seed,
  126      });
  127      state = step.state;
  128      const beat = step.beat;
  129      if (beat !== null && beat.kind !== "TONE") {
  130        if (beat.kind === "THREAD") options.onThread?.(beat.memoryItemId);
  131        if (options.narrate !== undefined) options.narrate(beat);
  132        else yield beat.text;
  133      }
  134      let timer: ReturnType<typeof setTimeout> | undefined;
  135      const wait =
  136        step.nextAtMs === null
  137          ? null
  138          : Math.max(0, step.nextAtMs - (now() - started));
  139      const outcome = await Promise.race([
  140        pending,
  141        wait === null
  142          ? new Promise<never>(() => undefined)
  143          : new Promise<typeof TIMEOUT>((resolve) => {
  144              timer = setTimeout(() => resolve(TIMEOUT), wait);
  145            }),
  146      ]);
  147      if (timer !== undefined) clearTimeout(timer);
  148      if (outcome === TIMEOUT) continue;
  149      if (outcome.done === true) return;
  150      // The answer has started: the ladder is done for this turn -- unless
  151      // nothing is heard until the whole answer is in.
  152      if (options.untilDone !== true) ladder = false;
  153      yield outcome.value;
  154      pending = iterator.next();
  155    }
  156  }
```

