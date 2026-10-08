# Evidence: apps/q-api/src/voice/duplex/broker.ts (lines 349-389)

- Original path: `apps/q-api/src/voice/duplex/broker.ts`
- Line range: 349-389 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: collectingSpeaker: has facts/narrate/deferred.

```ts
  349  /** A speaker that keeps what Q would have said, for the model to say. */
  350  function collectingSpeaker(
  351    id: string,
  352    narrate?: (beat: QSilenceBeat) => void,
  353  ): VoiceSpeaker & {
  354    readonly said: () => string;
  355    /** The facts of a code-built answer, for the voice to say itself. */
  356    readonly heldFacts: () => SpokenFacts | null;
  357  } {
  358    let text = "";
  359    let held: SpokenFacts | null = null;
  360    const add = (part: string) => {
  361      if (text.length >= SPOKEN_MAX) return;
  362      const trimmed = part.trim();
  363      if (trimmed.length === 0) return;
  364      text = text.length === 0 ? trimmed : `${text} ${trimmed}`;
  365    };
  366    return {
  367      providerConversationId: id,
  368      isOpen: true,
  369      speak: async (response) => {
  370        if (typeof response === "string") {
  371          add(response);
  372          return;
  373        }
  374        for await (const part of response) add(part);
  375      },
  376      close: () => undefined,
  377      // ADR 0062: the ladder's beats go to the browser, never into `said`.
  378      narrate,
  379      // Nothing collected here is heard until ask_q returns.
  380      deferred: true,
  381      // Founder live 2026-10-08: the realtime model read code templates
  382      // aloud. It is a conversational voice; it gets the facts and speaks.
  383      facts: (facts) => {
  384        held = facts;
  385      },
  386      said: () => text.slice(0, SPOKEN_MAX),
  387      heldFacts: () => held,
  388    };
  389  }
```

# Evidence: apps/q-api/src/voice/duplex/broker.ts (lines 493-581)

- Original path: `apps/q-api/src/voice/duplex/broker.ts`
- Line range: 493-581 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: askQ: standard voice turn, silent result when nothing to say, no deadline.

```ts
  493    /**
  494     * One spoken turn on the standard handler: the same seam, the same Q
  495     * run, the same tools, approvals and conduct.
  496     */
  497    const askQ = async (
  498      line: DuplexLine,
  499      request: string,
  500      abort: AbortSignal,
  501    ): Promise<{
  502      readonly output: string;
  503      readonly approvalPending: boolean;
  504      readonly silent?: boolean;
  505    }> => {
  506      const voiceSessionId = line.voiceSessionId;
  507      const wake = () => {
  508        for (const listener of line.listeners) listener();
  509      };
  510      const speaker = collectingSpeaker(`rt_${voiceSessionId}`, (beat) => {
  511        if (beat.kind === "TONE") return;
  512        line.narrationSequence += 1;
  513        line.narration.push({ sequence: line.narrationSequence, beat });
  514        line.narration.splice(
  515          0,
  516          Math.max(0, line.narration.length - NARRATION_KEPT),
  517        );
  518        wake();
  519      });
  520      // Each ask_q's beats start fresh; the numbering carries on.
  521      line.narration.length = 0;
  522      line.asking += 1;
  523      try {
  524        const asked: VoiceTranscriptTurn = {
  525          role: "user",
  526          content: request.slice(0, ASK_Q_MAX_CHARS),
  527        };
  528        const outcome = await turn(
  529          line.binding,
  530          // The realtime turn detector already ended their turn: never
  531          // held for sounding unfinished.
  532          settledTurn([...line.history, asked]),
  533          abort,
  534          speaker,
  535        );
  536        const said = speaker.said();
  537        // What was asked stays on the line's record either way; what Q
  538        // said, only when it was said.
  539        line.history.push(asked);
  540        if (outcome.kind !== "INTERRUPTED" && !abort.aborted && said !== "") {
  541          line.history.push({ role: "agent", content: said });
  542        }
  543        line.history.splice(
  544          0,
  545          Math.max(0, line.history.length - LINE_HISTORY_MAX),
  546        );
  547        if (outcome.kind === "INTERRUPTED" || abort.aborted) {
  548          return output({ ok: false, interrupted: true });
  549        }
  550        const facts = speaker.heldFacts();
  551        if (facts !== null) {
  552          line.awaitingApproval = false;
  553          return output(askQFactsOutput(facts));
  554        }
  555        const { say, amused } = forRealtime(said);
  556        if (say.length === 0) {
  557          line.awaitingApproval = false;
  558          return { ...output({ ok: true, say: "" }, false), silent: true };
  559        }
  560        const approvalPending = said.endsWith(APPROVAL_QUESTION);
  561        line.awaitingApproval = approvalPending;
  562        return output(
  563          amused
  564            ? { ok: true, say, delivery: AMUSED_DELIVERY }
  565            : { ok: true, say },
  566          approvalPending,
  567        );
  568      } catch (error: unknown) {
  569        logger.warn(
  570          { err: error, qVoiceSessionId: voiceSessionId },
  571          "duplex ask_q turn failed",
  572        );
  573        return output({
  574          ok: false,
  575          error: "That didn't go through on my side.",
  576        });
  577      } finally {
  578        line.asking -= 1;
  579        wake();
  580      }
  581    };
```
