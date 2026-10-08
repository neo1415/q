# Evidence: apps/web/src/features/voice/provider/duplex-line.ts (lines 1536-1690)

- Original path: `apps/web/src/features/voice/provider/duplex-line.ts`
- Line range: 1536-1690 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: VOICE-BRAIN routing in the browser: turnFinished/flushTurn/forceAskQ/routeHeard (MODEL/SMALLTALK -> model answers alone; silent -> LISTENING; transport-change drop).

```ts
 1536    // -------------------------------------------------------------------
 1537    // VOICE-BRAIN: who answers a turn is the server's decision
 1538    // -------------------------------------------------------------------
 1539
 1540    /** The turn detector ended their turn: route it once its words are in. */
 1541    #turnFinished(itemId: string): void {
 1542      const earlier = this.#pendingTurn;
 1543      if (earlier !== null) this.#env.clearTimeout(earlier.timer);
 1544      const items = [
 1545        ...(earlier?.items ?? []),
 1546        ...this.#turnItems.filter(
 1547          (id) =>
 1548            !this.#routedItems.has(id) && !(earlier?.items ?? []).includes(id),
 1549        ),
 1550      ];
 1551      if (!items.includes(itemId)) items.push(itemId);
 1552      for (const id of items) this.#routedItems.add(id);
 1553      const timer = this.#env.setTimeout(() => {
 1554        this.#flushTurn(true);
 1555      }, TRANSCRIPT_WAIT_MS);
 1556      this.#pendingTurn = { items, last: itemId, timer };
 1557      this.#tryFlushTurn();
 1558    }
 1559
 1560    #tryFlushTurn(): void {
 1561      const pending = this.#pendingTurn;
 1562      if (pending === null) return;
 1563      if (pending.items.every((id) => this.#transcripts.has(id))) {
 1564        this.#flushTurn(false);
 1565      }
 1566    }
 1567
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
 1687
 1688    // -------------------------------------------------------------------
 1689    // BACKCHANNEL
 1690    // -------------------------------------------------------------------
```
