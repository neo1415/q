# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 1568-1686)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 1568-1686 (HEAD 520bd123)
- Why included: Heard turn routing: SILENT result returns to LISTENING with no visible feedback.

```
 1568    #flushTurn(timedOut: boolean): void {
 1569      const pending = this.#pendingTurn;
 1570      if (pending === null) return;
 1571      this.#pendingTurn = null;
 1572      this.#env.clearTimeout(pending.timer);
 1573      const words = pending.items
 1574        .map((id) => this.#transcripts.get(id) ?? "")
 1575        .filter((said) => said.trim().length > 0)
 1576        .join(" ")
 1577        .trim();
 1578      if (words.length > 0) {
 1579        void this.#routeHeard(words, pending.last, false);
 1580        return;
 1581      }
 1582      if (!timedOut) {
 1583        // Transcribed as nothing: noise, not a turn. Q stays quiet.
 1584        if (!this.#speaking && !this.#responseActive) {
 1585          this.#events.onState("LISTENING");
 1586        }
 1587        return;
 1588      }
 1589      // Their words never came: the voice must hand the turn to Q.
 1590      this.#forceAskQ();
 1591    }
 1592  
 1593    /** The voice may answer only by passing the turn to Q (ask_q). */
 1594    #forceAskQ(): void {
 1595      if (this.#over) return;
 1596      this.#forcedAskQ = true;
 1597      this.#send({
 1598        type: "response.create",
 1599        response: { tool_choice: { type: "function", name: "ask_q" } },
 1600      });
 1601      this.#touch();
 1602    }
 1603  
 1604    async #routeHeard(
 1605      words: string,
 1606      itemId: string | null,
 1607      typed: boolean,
 1608    ): Promise<void> {
 1609      const heard = this.#relays.heard;
 1610      if (heard === undefined || this.#over) return;
 1611      this.#turnSeq += 1;
 1612      const seq = this.#turnSeq;
 1613      const generation = this.#generation;
 1614      const transport = this.#transport;
 1615      if (!typed) this.#events.onLine("user", words);
 1616      this.#events.onState("THINKING");
 1617      this.#touch();
 1618      this.#toolsInFlight += 1;
 1619      this.#updateBusy();
 1620      // ADR 0062: a slow answer is filled by the silence ladder.
 1621      if (this.#relays.narration !== undefined) this.#narrate(generation);
 1622      let result: QVoiceDuplexHeardResult | null;
 1623      try {
 1624        result = await heard({
 1625          itemId: itemId === null ? null : itemId.slice(0, 128),
 1626          transcript: words.slice(0, 2_000),
 1627          ...(typed ? { typed: true } : {}),
 1628          ...(this.#events.cardInFocus?.() === true ? { cardInFocus: true } : {}),
 1629        });
 1630      } catch {
 1631        result = null;
 1632      } finally {
 1633        this.#toolsInFlight -= 1;
 1634        this.#updateBusy();
 1635      }
 1636      if (this.#over) return;
 1637      // A newer turn, or their voice over this one: that one is answered.
 1638      if (seq !== this.#turnSeq || generation !== this.#generation) return;
 1639      if (result === null) {
 1640        this.#forceAskQ();
 1641        return;
 1642      }
 1643      if (result.route !== "ASK_Q") {
 1644        this.#send({ type: "response.create" });
 1645        return;
 1646      }
 1647      if (result.silent === true) {
 1648        // Q chose silence (only the room was heard): the voice is not asked
 1649        // to speak, so it never makes up a reply of its own.
 1650        this.#events.onState("LISTENING");
 1651        this.#touch();
 1652        return;
 1653      }
 1654      if (this.#rejoining || transport !== this.#transport) {
 1655        // Said once the new call is up (see #replayConversation).
 1656        if (this.#rejoining) this.#pendingResults.push(result.output);
 1657        return;
 1658      }
 1659      // Q's answer goes on the line as the reply to their turn: the call
 1660      // and its output, then the voice says it (and only says it).
 1661      this.#send({
 1662        type: "conversation.item.create",
 1663        item: {
 1664          type: "function_call",
 1665          call_id: result.callId,
 1666          name: "ask_q",
 1667          arguments: result.arguments,
 1668        },
 1669      });
 1670      this.#send({
 1671        type: "conversation.item.create",
 1672        item: {
 1673          type: "function_call_output",
 1674          call_id: result.callId,
 1675          output: result.output,
 1676        },
 1677      });
 1678      this.#afterBridge(() => {
 1679        if (this.#over || seq !== this.#turnSeq) return;
 1680        this.#send({
 1681          type: "response.create",
 1682          response: { tool_choice: "none" },
 1683        });
 1684        this.#touch();
 1685      });
 1686    }
```

# Evidence: apps/web/src/features/voice/provider/duplex-session.ts (lines 150-218)

- Original path: `apps/web/src/features/voice/provider/duplex-session.ts`
- Line range: 150-218 (HEAD 520bd123)
- Why included: decide_card and screen notes are wired only on the duplex line.

```
  150              ? undefined
  151              : resolveListeningLevel(
  152                  duplex.listening,
  153                  readListeningPreference(),
  154                ),
  155          relays,
  156          environment:
  157            optionsRef.current.environment ?? browserDuplexEnvironment(),
  158          events: {
  159            onState: setState,
  160            onLine: addLine,
  161            // Changed by voice: this device's toggle shows it too.
  162            onListening: (level) => {
  163              storeListeningPreference(level);
  164            },
  165            onInterrupted: () => eventsRef.current.onInterrupted?.(),
  166            // The arrival briefing's card in focus is decided on the page,
  167            // by the same code its buttons use (line-cards.ts).
  168            cardInFocus,
  169            onClientTool: ({ name, arguments: args, heard }) =>
  170              name === "decide_card"
  171                ? decideCardByVoice(args, heard)
  172                : Promise.resolve(null),
  173            onLinkStatus: (status) => {
  174              if (lineRef.current === line) {
  175                eventsRef.current.onLinkStatus?.(status);
  176              }
  177            },
  178            onFallback: ({ cause, notice, connected: wasUp }) => {
  179              // A line already replaced or ended reports nothing: only the
  180              // current line may bring up its standard successor (live
  181              // 2026-10-05: a stale report opened a second standard line).
  182              const current = lineRef.current === line;
  183              if (!current) return;
  184              lineRef.current = null;
  185              setConnected(false);
  186              // Before it came up, `start` answers false and the caller
  187              // opens the standard line itself; nobody else needs to know.
  188              if (!wasUp) return;
  189              const fallback = eventsRef.current.onFallback;
  190              if (fallback !== undefined) fallback(notice, cause);
  191              else eventsRef.current.onEnded?.("dropped");
  192            },
  193            onEnded: () => {
  194              // Idle: the line ended itself. One the person ended through
  195              // `end` is already let go and says nothing more.
  196              if (lineRef.current !== line) return;
  197              lineRef.current = null;
  198              setConnected(false);
  199              eventsRef.current.onEnded?.("ended");
  200            },
  201          },
  202        });
  203        lineRef.current = line;
  204        const up = await line.open();
  205        if (up && lineRef.current === line) {
  206          setConnected(true);
  207          // Notes from the page's cards reach this line while it is up.
  208          const stopNotes = onLineNote((note, respond) => {
  209            if (lineRef.current === line) line.note(note, respond);
  210            else stopNotes();
  211          });
  212          // Q speaks first: the opening the interview has, at once.
  213          if (firstMessage !== undefined) line.speakFirst(firstMessage);
  214        }
  215        return up;
  216      },
  217      [addLine],
  218    );
```

# Evidence: apps/web/src/features/voice/session.ts (lines 20-34)

- Original path: `apps/web/src/features/voice/session.ts`
- Line range: 20-34 (HEAD 520bd123)
- Why included: Voice state labels.

```
   20    | "Q_SPEAKING"
   21    | "INTERRUPTED"
   22    | "ERROR";
   23  
   24  export const VOICE_STATE_LABELS: Readonly<Record<VoiceState, string>> = {
   25    IDLE: "Ready",
   26    CONNECTING: "Connecting",
   27    LISTENING: "Listening",
   28    USER_SPEAKING: "Listening",
   29    THINKING: "Thinking",
   30    Q_SPEAKING: "Speaking",
   31    INTERRUPTED: "Listening",
   32    ERROR: "Voice paused",
   33  };
   34  
```

