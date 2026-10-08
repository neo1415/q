# Evidence: packages/q-specialists/src/answer.ts (lines 1447-1960)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 1447-1960 (HEAD 9177629d)
- Why included: actOnTool (navigate/visibility/documents), capabilitiesOf, pageAnswer (ordinal card), in-memory maps, aboutCounterparty, preread (ADR 0035), markNotForQ, openReferenced, repeatLastAction.

```ts
 1447    async function actOnTool(
 1448      request: QAnswerRequest,
 1449      conversationId: QConversationMessage["conversationId"],
 1450      tool: TurnToolV14,
 1451      history: readonly QConversationMessage[],
 1452      /** The screens this run can open, from the capability registry. */
 1453      navigable: readonly QNavigateDestination[],
 1454      moreDocuments: readonly TurnToolV14[] = [],
 1455      /** The answer can open one record's page itself (open_page). */
 1456      opensRecords = false,
 1457    ): Promise<QAnswerOutcome | null> {
 1458      const company = request.subjects.find(
 1459        (subject) => subject.kind === "COMPANY",
 1460      );
 1461      if (tool.kind === "PREPARE_DOCUMENT") {
 1462        return actOnDocuments(
 1463          request,
 1464          conversationId,
 1465          [tool, ...moreDocuments],
 1466          history,
 1467        );
 1468      }
 1469      if (tool.kind === "NAVIGATE" && tool.unknownScreen !== null) {
 1470        // Founder report 2026-09-30: "open my chat with young field agro"
 1471        // was read as an unknown screen and answered here, before the tools
 1472        // that find the record could run. When the answer can open a record
 1473        // itself, it answers: it finds the name among their own records and
 1474        // opens it, or says the screen does not exist.
 1475        if (opensRecords) return null;
 1476        logger?.info(
 1477          { qRunId: request.runId, nearest: tool.unknownScreen.nearest },
 1478          "q was asked for a screen Capital Q does not have",
 1479        );
 1480        return recordAnswer(
 1481          request,
 1482          conversationId,
 1483          unknownScreenLine(
 1484            tool.unknownScreen.named,
 1485            tool.unknownScreen.nearest,
 1486            navigable,
 1487          ),
 1488        );
 1489      }
 1490      if (tool.kind === "NAVIGATE" && tool.destination !== null) {
 1491        const destination = tool.destination;
 1492        if (destination === "COMPANY_VISIBILITY" && company === undefined) {
 1493          return null;
 1494        }
 1495        logger?.info(
 1496          { qRunId: request.runId, destination },
 1497          "q is taking the person to a screen",
 1498        );
 1499        return recordAnswer(
 1500          request,
 1501          conversationId,
 1502          naturalPlaceLine(DESTINATION_LINES[destination], askedIn(history)),
 1503          [{ kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination } }],
 1504        );
 1505      }
 1506      if (
 1507        tool.kind === "SET_VISIBILITY" &&
 1508        tool.visibility !== null &&
 1509        dependencies.visibility !== undefined
 1510      ) {
 1511        if (company === undefined || company.kind !== "COMPANY") {
 1512          return recordAnswer(
 1513            request,
 1514            conversationId,
 1515            "I can change who sees a company once it's set up on Capital Q, and there isn't one in this conversation yet.",
 1516          );
 1517        }
 1518        dependencies.visibility.noteVisibility({
 1519          runId: request.runId,
 1520          tenantId: request.tenantId,
 1521          companyId: company.companyId,
 1522          visibility: tool.visibility,
 1523        });
 1524        logger?.info(
 1525          { qRunId: request.runId, visibility: tool.visibility },
 1526          "visibility change read from the person's words; handed to the proposer",
 1527        );
 1528        return recordAnswer(
 1529          request,
 1530          conversationId,
 1531          VISIBILITY_EXPLANATIONS[tool.visibility],
 1532        );
 1533      }
 1534      return null;
 1535    }
 1536  
 1537    /**
 1538     * One turn, read and then answered (CQ-QX-005).
 1539     *
 1540     * The reading starts now and runs alongside the answer's own context
 1541     * assembly; the answer path awaits it only where research is decided.
 1542     * What the turn turned out to be decides whether the public web may be
 1543     * read; how the answer ended is noted against the conversation, so a
 1544     * failing subsystem is named once and never in the same words twice.
 1545     */
 1546    /**
 1547     * What this run can do beyond the model's tools, from what is composed
 1548     * here and what the plan holds (CQ-QX-008). Built by code, so Q can
 1549     * neither deny a capability it has nor claim one it has not.
 1550     */
 1551    const capabilitiesOf = async (
 1552      request: QAnswerRequest,
 1553    ): Promise<readonly QCapability[]> => {
 1554      const offeredTools =
 1555        dependencies.offeredTools === undefined
 1556          ? []
 1557          : await dependencies.offeredTools(request).catch(() => []);
 1558      return eligibleCapabilities({
 1559        surface: "HOME_Q",
 1560        offeredTools: new Set(offeredTools),
 1561        company: request.subjects.some((subject) => subject.kind === "COMPANY"),
 1562        ownInvestorOrganisation: ownInvestorOrganisationIn(request.plan) !== null,
 1563        artifacts: artifacts !== undefined,
 1564        ownMandate: dependencies.ownMandate !== undefined,
 1565        visibility: dependencies.visibility !== undefined,
 1566      });
 1567    };
 1568    /** The manifest the answer's note renders, from the registry's hands. */
 1569    const manifestOf = (
 1570      capabilities: readonly QCapability[],
 1571    ): QCapabilityManifest => {
 1572      const hands = capabilities.flatMap((capability) =>
 1573        capability.performedBy.kind === "HAND"
 1574          ? [capability.performedBy.hand]
 1575          : [],
 1576      );
 1577      return {
 1578        navigate: hands.flatMap((hand) =>
 1579          hand.kind === "NAVIGATE" ? [hand.destination] : [],
 1580        ),
 1581        documents: hands.flatMap((hand) =>
 1582          hand.kind === "PREPARE_DOCUMENT" ? [hand.documentType] : [],
 1583        ),
 1584        visibilityChange: hands.some((hand) => hand.kind === "SET_VISIBILITY"),
 1585        // R33: what only the person can do, with the screen that has it.
 1586        offers: capabilities.flatMap((capability) =>
 1587          capability.performedBy.kind === "OFFER"
 1588            ? [
 1589                {
 1590                  does: capability.does,
 1591                  destination: capability.performedBy.offer.destination,
 1592                },
 1593              ]
 1594            : [],
 1595        ),
 1596      };
 1597    };
 1598  
 1599    /**
 1600     * voice-cards: a page, a Settings section or a card on screen, opened by
 1601     * code from the person's own words (page-request.ts). Null when the
 1602     * words are not such a request, or name a screen this run cannot open.
 1603     */
 1604    const pageAnswer = (
 1605      text: string,
 1606      history: readonly QConversationMessage[],
 1607      capabilities: readonly QCapability[],
 1608    ): {
 1609      readonly said: string;
 1610      readonly blocks: readonly QResultBlock[];
 1611      readonly log: string;
 1612    } | null => {
 1613      const navigable = manifestOf(capabilities).navigate;
 1614      if (navigable.length === 0) return null;
 1615      const position = ordinalOf(text);
 1616      if (position !== null) {
 1617        const block = cardsOnScreen(history);
 1618        const card = block === null ? null : cardAt(block, position);
 1619        if (card?.subject?.kind !== "COMPANY") return null;
 1620        const blocks: QResultBlock[] = [
 1621          {
 1622            kind: "UI_INTENT",
 1623            intent: {
 1624              kind: "OPEN_RECORD_PAGE",
 1625              page: "COMPANY",
 1626              id: card.subject.companyId,
 1627            },
 1628          },
 1629        ];
 1630        // "Tell me about the third company": talked about from its card
 1631        // (what they do, stage, raise, fit and why, one unknown), and opened
 1632        // -- never only `Opening "Tensorgate".` (founder live 2026-10-08).
 1633        const opening = openingLine("COMPANY", card.name);
 1634        const facts = spokenFactsOf({
 1635          asked: text,
 1636          text: opening,
 1637          blocks,
 1638          shown: [card],
 1639        });
 1640        return {
 1641          said: facts?.fallback ?? opening,
 1642          blocks,
 1643          log: `CARD_${String(position)}`,
 1644        };
 1645      }
 1646      const asked = pageRequestOf(text);
 1647      if (asked === null) return null;
 1648      if (asked.kind === "UNKNOWN") {
 1649        return { said: cannotOpenLine(asked.named), blocks: [], log: "UNKNOWN" };
 1650      }
 1651      const target = asked.target;
 1652      if (target.kind === "SETTINGS") {
 1653        if (!navigable.includes("SETTINGS")) return null;
 1654        return {
 1655          said: "Opening Settings.",
 1656          blocks: [
 1657            {
 1658              kind: "UI_INTENT",
 1659              intent: { kind: "OPEN_SETTINGS", section: target.section },
 1660            },
 1661          ],
 1662          log: `SETTINGS_${target.section}`,
 1663        };
 1664      }
 1665      if (!navigable.includes(target.destination)) return null;
 1666      return {
 1667        said: naturalPlaceLine(DESTINATION_LINES[target.destination], text),
 1668        blocks: [
 1669          {
 1670            kind: "UI_INTENT",
 1671            intent: { kind: "NAVIGATE", destination: target.destination },
 1672          },
 1673        ],
 1674        log: target.destination,
 1675      };
 1676    };
 1677  
 1678    /** Unclear turns in a row, per conversation (bounded with the rest). */
 1679    const unclearInARow = new Map<string, number>();
 1680    /** Runs answering their likely words (TURN_READER v44): never twice. */
 1681    const reheard = new Set<string>();
 1682  
 1683    /**
 1684     * A series of questions the person asked Q to put to them, per
 1685     * conversation (R35). In memory and bounded like the rest of the core's
 1686     * state: a restart forgets where a series was, never a fact.
 1687     */
 1688    const sequences = new Map<string, QuestionSequence>();
 1689    /** The last turn's tool focus per conversation, bounded like the rest. */
 1690    const focuses = new Map<string, QToolFocus>();
 1691    const keepSequence = (
 1692      conversationId: string,
 1693      next: QuestionSequence | null,
 1694    ) => {
 1695      sequences.delete(conversationId);
 1696      if (next === null) return;
 1697      sequences.set(conversationId, next);
 1698      if (sequences.size > MAX_CONVERSATIONS) {
 1699        const oldest = sequences.keys().next().value;
 1700        if (oldest !== undefined) sequences.delete(oldest);
 1701      }
 1702    };
 1703  
 1704    /**
 1705     * The actions each conversation's reader was last given, so an early
 1706     * reading (ADR 0035) can be made before this turn's plan exists and
 1707     * checked against it afterwards. Tool names and what they do: Capital
 1708     * Q's own vocabulary, not anyone's data.
 1709     */
 1710    const lastActions = new Map<string, string>();
 1711    /** Early readings by run, bounded; dropped on refusal or when unused. */
 1712    type EarlyReading = {
 1713      readonly messageId: string;
 1714      readonly actionsKey: string;
 1715      readonly reading: Promise<Awaited<ReturnType<QTurnReader["read"]>> | null>;
 1716    };
 1717    const prereads = new Map<string, Promise<EarlyReading | null>>();
 1718    const PREREADS_MAX = 64;
 1719  
 1720    /**
 1721     * The turn is about someone across a relationship: a company subject on
 1722     * an investor's run (their own organisation bound in the plan), or a
 1723     * request to act that names one of their relationships' counterparts,
 1724     * matched by the same name matcher every reference uses. Read only for a
 1725     * request to act, and never a reason to show anything: it brings the
 1726     * Relationships area's actions into the offer, which authorize decides.
 1727     */
 1728    const aboutCounterparty = async (
 1729      request: QAnswerRequest,
 1730      utterance: string,
 1731      read: { readonly kind: string } | null,
 1732    ): Promise<boolean> => {
 1733      if (read?.kind !== "TOOL_REQUEST") return false;
 1734      if (
 1735        ownInvestorOrganisationIn(request.plan) !== null &&
 1736        request.subjects.some((subject) => subject.kind === "COMPANY")
 1737      ) {
 1738        return true;
 1739      }
 1740      const names = await (
 1741        dependencies.counterpartNames?.(request) ?? Promise.resolve([])
 1742      ).catch(() => []);
 1743      if (names.length === 0) return false;
 1744      return names.some((name) => namedInWords(utterance, name));
 1745    };
 1746  
 1747    /**
 1748     * The cards this turn handed to the engine, by run: the engine says
 1749     * their status after the turn, so nothing here says it again (lead
 1750     * 2026-10-03, runs 7468a83f, 7c39eed0: three lines for one card).
 1751     */
 1752    const preparedThisRun = new Map<string, string>();
 1753    const preparedForEngine = (
 1754      request: QAnswerRequest,
 1755      summary: string,
 1756    ): QAnswerOutcome => {
 1757      preparedThisRun.set(request.runId, summary);
 1758      while (preparedThisRun.size > PREREADS_MAX) {
 1759        const oldest = preparedThisRun.keys().next().value;
 1760        if (oldest === undefined) break;
 1761        preparedThisRun.delete(oldest);
 1762      }
 1763      logger?.info(
 1764        { qRunId: request.runId },
 1765        "a change was prepared for approval; the engine says its status",
 1766      );
 1767      return {
 1768        kind: "ANSWERED",
 1769        messageId: null,
 1770        modelPolicyVersion: "none",
 1771        promptBundleVersion: "none",
 1772      };
 1773    };
 1774  
 1775    const preread = (input: QPrereadInput): void => {
 1776      if (turns === undefined || prereads.has(input.runId)) return;
 1777      const started = (async (): Promise<EarlyReading | null> => {
 1778        // The run's own conversation, read as its owner: the same read the
 1779        // answer makes, under the actor preflight has just checked.
 1780        const history =
 1781          await repositories.messages.listRecentForConversationOfRun(
 1782            sql,
 1783            input.tenantId,
 1784            input.runId,
 1785            64,
 1786          );
 1787        const conversationId = history[0]?.conversationId;
 1788        const latest = [...history].reverse().find((m) => m.role === "USER");
 1789        if (conversationId === undefined || latest === undefined) return null;
 1790        const key = lastActions.get(conversationId);
 1791        // A conversation's first turn has no known actions: read later.
 1792        if (key === undefined) return null;
 1793        const actions = JSON.parse(key) as ReaderAction[];
 1794        const reading = turns
 1795          .read(
 1796            turnReaderInput(
 1797              history,
 1798              latest,
 1799              actions,
 1800              {
 1801                tenantId: input.tenantId,
 1802                userId: input.actor.userId,
 1803                correlationId: input.correlationId,
 1804                signal: input.signal,
 1805              },
 1806              referenceNote(
 1807                shownItems(history),
 1808                lastActed.get(conversationId) ?? null,
 1809              ),
 1810            ),
 1811          )
 1812          .catch(() => null);
 1813        return { messageId: latest.id, actionsKey: key, reading };
 1814      })().catch(() => null);
 1815      // Registered at once, so a refusal that arrives first still drops it.
 1816      prereads.set(input.runId, started);
 1817      while (prereads.size > PREREADS_MAX) {
 1818        const oldest = prereads.keys().next().value;
 1819        if (oldest === undefined) break;
 1820        prereads.delete(oldest);
 1821      }
 1822    };
 1823  
 1824    /** Lines of theirs that were not for Q, marked append-only (20261110030000). */
 1825    const markNotForQ = async (
 1826      request: QAnswerRequest,
 1827      conversationId: string,
 1828      messageIds: readonly string[],
 1829    ): Promise<void> => {
 1830      const mark = repositories.messages.mark;
 1831      if (mark === undefined || messageIds.length === 0) return;
 1832      try {
 1833        await transactions.run((tx) =>
 1834          mark(tx, {
 1835            tenantId: request.tenantId,
 1836            conversationId,
 1837            messageIds,
 1838            mark: "NOT_ADDRESSED_TO_Q",
 1839            markedBy: "Q_READING",
 1840            runId: request.runId,
 1841          }),
 1842        );
 1843        logger?.info(
 1844          { qRunId: request.runId, marked: messageIds.length },
 1845          "lines not meant for Q kept out of what Q reads back",
 1846        );
 1847      } catch (error: unknown) {
 1848        logger?.warn(
 1849          { err: error, qRunId: request.runId },
 1850          "lines not meant for Q were not marked",
 1851        );
 1852      }
 1853    };
 1854  
 1855    /**
 1856     * Open the one record the turn names or points at (follow-55), through
 1857     * open_page's authorize step: their own documents, relationships and
 1858     * what the network shows them, nothing else. Null: nothing of theirs
 1859     * matched, and the turn is answered as before.
 1860     */
 1861    const openReferenced = async (
 1862      request: QAnswerRequest,
 1863      conversationId: QConversationMessage["conversationId"],
 1864      reference: TurnReference,
 1865      shown: ReturnType<typeof shownItems>,
 1866      history: readonly QConversationMessage[],
 1867    ): Promise<QAnswerOutcome | null> => {
 1868      const port = dependencies.openRecord;
 1869      if (port === undefined) return null;
 1870      const side =
 1871        ownInvestorOrganisationIn(request.plan) !== null ? "INVESTOR" : "FOUNDER";
 1872      const target = openTarget(reference, shown, side);
 1873      if (target === null) return null;
 1874      for (const page of target.pages) {
 1875        const intent = await port
 1876          .open(request, { page, id: target.id, name: target.name })
 1877          .catch(() => null);
 1878        if (intent === null) continue;
 1879        logger?.info(
 1880          { qRunId: request.runId, page, byName: target.id === undefined },
 1881          "q opened the record the turn pointed at",
 1882        );
 1883        remember(
 1884          conversationId,
 1885          reduceConversation(
 1886            conversations.get(conversationId) ?? INITIAL_CONVERSATION_STATE,
 1887            { type: "SUCCEEDED", operation: "TOOL" },
 1888          ),
 1889        );
 1890        // Said from the card on screen when it is one (what they do, the
 1891        // fit and why), else plainly ("Here's Tensorgate.").
 1892        const opening = openingLine(page, target.name);
 1893        const facts =
 1894          page === "COMPANY"
 1895            ? spokenFactsOf({
 1896                asked: askedIn(history),
 1897                text: opening,
 1898                blocks: [{ kind: "UI_INTENT", intent }],
 1899                shown: cardsOnScreen(history)?.cards ?? [],
 1900              })
 1901            : null;
 1902        return recordAnswer(request, conversationId, facts?.fallback ?? opening, [
 1903          { kind: "UI_INTENT", intent },
 1904        ]);
 1905      }
 1906      logger?.info(
 1907        { qRunId: request.runId, open: reference.open },
 1908        "the record the turn pointed at is not one of theirs; answered instead",
 1909      );
 1910      return null;
 1911    };
 1912  
 1913    /**
 1914     * Q's last action again ("try again", "do it again", "same for X"):
 1915     * the same declared action with the same inputs -- read again from what
 1916     * they said then when they were never read -- through its own authorize
 1917     * step and approval card. Null: it still cannot be done; answered.
 1918     */
 1919    const repeatLastAction = async (
 1920      request: QAnswerRequest,
 1921      conversationId: QConversationMessage["conversationId"],
 1922      last: LastAction,
 1923      sameFor: string | null,
 1924    ): Promise<QAnswerOutcome | null> => {
 1925      const actions = dependencies.appActions;
 1926      if (actions === undefined) return null;
 1927      let action = repeatedAction(last, sameFor);
 1928      if (action === null && dependencies.appActionArguments !== undefined) {
 1929        const said =
 1930          sameFor === null
 1931            ? last.utterance
 1932            : `${last.utterance} (this time for ${sameFor})`;
 1933        const args = await dependencies
 1934          .appActionArguments(request, { tool: last.tool, utterance: said })
 1935          .catch(() => null);
 1936        action =
 1937          args === null || args === undefined
 1938            ? null
 1939            : { tool: last.tool, arguments: args };
 1940      }
 1941      logger?.info(
 1942        {
 1943          qRunId: request.runId,
 1944          tool: last.tool,
 1945          was: last.outcome,
 1946          sameFor: sameFor !== null,
 1947          filled: action !== null,
 1948        },
 1949        "q repeats its last action",
 1950      );
 1951      if (action === null) return null;
 1952      const said = await actions.run(request, action).catch(() => null);
 1953      if (said === null) {
 1954        noteAction(request, conversationId, action, "NOT_DONE", last.utterance);
 1955        return null;
 1956      }
 1957      return saidByAction(request, conversationId, action, said);
 1958    };
 1959  
 1960    const answerTurn = async (
```
