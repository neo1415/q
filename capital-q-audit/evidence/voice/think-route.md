# Evidence: apps/q-api/src/voice/think.ts (lines 42-60)

- Original path: `apps/q-api/src/voice/think.ts`
- Line range: 42-60 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: TURN_DEADLINE_MS and lines.

```ts
   42  /** A stream comment every few seconds while a turn is still working. */
   43  const KEEP_ALIVE_MS = 5_000;
   44  
   45  /**
   46   * The longest a turn may run before this route ends it in Q's own words.
   47   *
   48   * The speech provider has a patience of its own for a think that never
   49   * finishes, and when it runs out first the person gets the provider's
   50   * failure instead of ours: the line dies and a banner appears. Ending the
   51   * turn here first means the worst case is a sentence Q says, which the
   52   * person can answer. Longer than the slowest turn measured (research,
   53   * about eleven seconds), shorter than a provider is likely to wait.
   54   */
   55  const TURN_DEADLINE_MS = 20_000;
   56  const TURN_TOO_LONG =
   57    "That one is taking longer than I want to keep you waiting. Ask me again, or ask me something smaller and I'll build up.";
   58  const TURN_CUT_SHORT =
   59    "I'm going to stop there, that was taking too long. Ask me again if you want the rest.";
   60  
```

# Evidence: apps/q-api/src/voice/think.ts (lines 286-400)

- Original path: `apps/q-api/src/voice/think.ts`
- Line range: 286-400 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Standard-line think SSE: sentence streaming, keep-alive, deadline.

```ts
  286      const controller = new AbortController();
  287      current?.controller.abort();
  288      let resolveDone: () => void = () => undefined;
  289      const live: LiveThink = {
  290        key,
  291        controller,
  292        sink,
  293        done: new Promise<void>((resolve) => {
  294          resolveDone = resolve;
  295        }),
  296      };
  297      inFlight.set(line, live);
  298      // The response closing before it finished is the provider dropping
  299      // the request: the person spoke over Q. (The request stream's own
  300      // close fires as soon as its body is read, so it is not the signal.)
  301      // A stream the turn has moved on from closing is not that.
  302      raw.on("close", () => {
  303        if (!raw.writableFinished && live.sink === sink) controller.abort();
  304      });
  305      const isOpen = () => live.sink.open && !controller.signal.aborted;
  306      let wroteContent = false;
  307      let timedOut = false;
  308      /**
  309       * Write to the stream. `force` is for the deadline's own sentence.
  310       *
  311       * Once the deadline has spoken, the turn's late words are not wanted:
  312       * they would arrive after Q has moved on. But the flag that stops
  313       * them used to stop the deadline's own line too, because it was set
  314       * before that line was written — so a turn that ran long said "One
  315       * moment." and then nothing at all, and the person sat looking at a
  316       * dead line (hosted, 2026-09-22). The deadline now writes past its
  317       * own guard, and only the turn's late words are dropped.
  318       */
  319      const write = (text: string, force = false) => {
  320        if (!isOpen()) return;
  321        if (timedOut && !force) return;
  322        wroteContent = true;
  323        live.sink.raw.write(chunk(live.sink.id, { content: text }, null));
  324      };
  325      // A long turn (research, a document being read) must not look like a
  326      // dead line to the provider: an empty delta keeps the stream open.
  327      // Nothing is spoken while Q works. A spoken "One moment." before
  328      // most answers was a verbal tic the founder rejected (2026-09-27);
  329      // the stage shows that Q is thinking.
  330      const keepAlive = setInterval(() => {
  331        // An empty delta rather than an SSE comment: every OpenAI-shaped
  332        // parser accepts it, and the provider's is not ours to test.
  333        if (isOpen()) {
  334          live.sink.raw.write(chunk(live.sink.id, { content: "" }, null));
  335        }
  336      }, KEEP_ALIVE_MS);
  337      // Our own deadline, ahead of the provider's. The line is written
  338      // before the turn is cancelled, because cancelling closes writing.
  339      const deadline = setTimeout(() => {
  340        if (!isOpen()) {
  341          return;
  342        }
  343        const said = wroteContent ? TURN_CUT_SHORT : TURN_TOO_LONG;
  344        timedOut = true;
  345        write(said, true);
  346        controller.abort();
  347      }, TURN_DEADLINE_MS);
  348      const speaker: VoiceSpeaker = {
  349        providerConversationId: binding.providerConversationId,
  350        get isOpen() {
  351          return isOpen();
  352        },
  353        speak: async (response) => {
  354          if (typeof response === "string") {
  355            // Sentence by sentence even when handed whole (a look-up's
  356            // answer, an interview reply), as a streamed answer is: the agent
  357            // asks the voice for what it is given, and one long request is
  358            // slower to first sound and, past the relay's bound, silent.
  359            for (const part of sentences(response)) write(`${part} `);
  360            return;
  361          }
  362          for await (const part of response) {
  363            if (controller.signal.aborted) return;
  364            write(`${part} `);
  365          }
  366        },
  367        close: () => {
  368          finishSink(live.sink);
  369        },
  370      };
  371      try {
  372        // In a burst of re-asks, wait a moment to see whether another
  373        // follows before creating anything (think-gate.ts).
  374        const admitted = await gate.admit(line, controller.signal);
  375        if (admitted !== "DROPPED") {
  376          await turn(binding, transcript, controller.signal, speaker);
  377          turnSucceeded(binding);
  378        }
  379      } catch (error: unknown) {
  380        logger.error(
  381          { err: error, qVoiceSessionId: binding.voiceSessionId },
  382          "voice think turn failed",
  383        );
  384        // A turn we stopped has already said so; do not say it twice. A
  385        // turn that threw is Q's failure, named as such and never the
  386        // same way twice running (CQ-QX-005).
  387        if (!timedOut) {
  388          write(turnFailureLine(binding, error));
  389        }
  390      } finally {
  391        if (inFlight.get(line) === live) inFlight.delete(line);
  392        clearInterval(keepAlive);
  393        clearTimeout(deadline);
  394        finishSink(live.sink);
  395        resolveDone();
  396      }
  397      return reply;
  398    };
  399    app.post(dependencies.path, handler);
  400    app.post(`${dependencies.path}/chat/completions`, handler);
```

