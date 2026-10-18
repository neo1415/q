# Evidence: packages/model-gateway/src/q/index.ts (lines 1561-1960)

- Original path: `packages/model-gateway/src/q/index.ts`
- Line range: 1561-1960 (HEAD 9177629d)
- Why included: recallMemory (4000 chars), prepareTurn: history 64, prefetch of own standing, mandate, on-screen company, named companies, daily, document, manifest.

```ts
 1561    async function recallMemory(
 1562      request: QAnswerRequest,
 1563      conversationId: string,
 1564    ): Promise<string> {
 1565      const port = dependencies.memory;
 1566      if (port === undefined) return NOTHING_REMEMBERED;
 1567      try {
 1568        const text = (
 1569          await port.recall({
 1570            actor: request.actor,
 1571            runId: request.runId,
 1572            conversationId,
 1573            subjects: request.subjects,
 1574            signal: request.signal,
 1575          })
 1576        ).trim();
 1577        return text.length === 0 ? NOTHING_REMEMBERED : text.slice(0, 4_000);
 1578      } catch (error: unknown) {
 1579        logger?.warn(
 1580          { err: error, qRunId: request.runId },
 1581          "memory was not recalled for this answer",
 1582        );
 1583        return NOTHING_REMEMBERED;
 1584      }
 1585    }
 1586
 1587    /**
 1588     * The reads a turn needs before the model is asked anything: the
 1589     * conversation, the assembled context, the tools offered, memory, and
 1590     * the person's own facts (mandate, relationship, standing, pitch
 1591     * moment, setup). Read-only and bound to the run's plan, so it can
 1592     * start while the turn is still being read (warm) and be taken up by
 1593     * the answer; null when the run has no conversation to answer.
 1594     */
 1595    async function prepareTurn(request: QAnswerRequest) {
 1596      const plan: PermittedContextPlan = request.plan;
 1597      /**
 1598       * Everything recently said in this CONVERSATION, not in this run.
 1599       *
 1600       * A voice turn is a run of its own, so run-scoped history gave the
 1601       * model a single sentence and no past: Q named a company, was asked
 1602       * "tell me more about it", and answered that no company had been
 1603       * named. The person is having one conversation; which run a sentence
 1604       * belonged to is our bookkeeping, not theirs.
 1605       */
 1606      const history = await repositories.messages.listRecentForConversationOfRun(
 1607        sql,
 1608        request.tenantId,
 1609        request.runId,
 1610        64,
 1611      );
 1612      const conversationId = history[0]?.conversationId;
 1613      /**
 1614       * The most recent document Q put in front of this person, from
 1615       * their own turns. Used only to tell the model one exists; which
 1616       * artifact a revision touches is resolved server-side again.
 1617       */
 1618      const openDocumentTitle = (() => {
 1619        for (let index = history.length - 1; index >= 0; index -= 1) {
 1620          for (const block of history[index]?.blocks ?? []) {
 1621            if (block.kind === "ARTIFACT_REFERENCE") return block.title;
 1622          }
 1623        }
 1624        return undefined;
 1625      })();
 1626      const latest = [...history].reverse().find((m) => m.role === "USER");
 1627      if (conversationId === undefined || latest === undefined) {
 1628        return null;
 1629      }
 1630      const earlier = history.filter((m) => m.id !== latest.id);
 1631      const toolContext: QToolExecutionContext = {
 1632        actor: request.actor,
 1633        runId: request.runId,
 1634        correlationId: request.correlationId,
 1635        capability: request.capability,
 1636        plan,
 1637        signal: request.signal,
 1638        // The person's own words, for the one tool family that sends
 1639        // anything outside Capital Q: its query is composed from these and
 1640        // from authorised public identity, never from a model argument.
 1641        conversation: {
 1642          latestUserText: latest.content,
 1643          // Their own earlier words, for a look-up that refers back ("look
 1644          // her up" after naming her): never Q's words.
 1645          earlierUserText: earlier
 1646            .filter((message) => message.role === "USER")
 1647            .slice(-3)
 1648            .map((message) => message.content),
 1649        },
 1650        // What the turn is about, read by code (lead 2026-10-02): the offer
 1651        // narrows to it; absent, the purpose's list as before.
 1652        ...(request.toolFocus === undefined ? {} : { focus: request.toolFocus }),
 1653      };
 1654      // Independent reads, side by side (speed sweep 2026-10-01: they ran
 1655      // one after another, ~0.3 s of a turn's wait).
 1656      const [assembled, profile, offeredForRun, availableForRun, memory] =
 1657        await Promise.all([
 1658          context.assemble(request),
 1659          communication.profileFor(request),
 1660          tools.offer(toolContext),
 1661          // The facts read for every turn are read by code, so a turn's
 1662          // focus (which narrows only what the model is offered) never
 1663          // removes them.
 1664          tools.available === undefined
 1665            ? Promise.resolve(null)
 1666            : tools.available(toolContext),
 1667          recallMemory(request, conversationId),
 1668        ]);
 1669      // The prefetch below reads only tools the run may use; the research
 1670      // filter decided later never touches them.
 1671      const prefetchTools = new Set(
 1672        (availableForRun ?? offeredForRun).map((tool) => tool.definition.name),
 1673      );
 1674
 1675      /**
 1676       * Their own declared profile, read for them (CQ-QX-007; directive
 1677       * "Home Q doesn't know the person").
 1678       *
 1679       * An investor asking "according to my profile, who am I?" was told
 1680       * no profile facts existed, and one asking whether a company suits
 1681       * what they invest in was told their thesis was unknown: the
 1682       * firewall had admitted their own mandate and nothing read it. When
 1683       * the plan binds INVESTOR_MANDATE to their own organisation (which
 1684       * only an owner receives) it is read through the same tool the model
 1685       * could call, under the same plan, and placed among the AUTHORISED
 1686       * FACTS the model answers from.
 1687       */
 1688      /**
 1689       * Their own standing -- relationships by state, and an investor's
 1690       * Saves and Passes -- read on every turn, on every surface, through
 1691       * the same tool the model could call (founder report 2026-10-01: "am
 1692       * I interested in this company?" on Discover was answered "I don't
 1693       * know" a minute after they had saved and passed on it). Started now
 1694       * so it overlaps the reads below; its own record only, so nothing
 1695       * here can carry another organisation's data.
 1696       */
 1697      const standingRead = prefetchTools.has("list_my_relationships")
 1698        ? tools.execute(
 1699            {
 1700              callId: "q-own-standing",
 1701              name: "list_my_relationships",
 1702              arguments: {},
 1703            },
 1704            toolContext,
 1705          )
 1706        : null;
 1707      let ownProfile: AuthorisedFact | null = null;
 1708      let ownProfileCall: QToolCallObservation | null = null;
 1709      const ownInvestor = ownInvestorOrganisationIn(plan);
 1710      // A fit question over a set they own is computed by code, side by side
 1711      // with the reads below, through the same tools and plan (fit-sweep.ts).
 1712      // Investors only (fit is against their mandate); never for a document
 1713      // or an action.
 1714      const sweepAsk =
 1715        ownInvestor === null ||
 1716        request.writingDocument === true ||
 1717        (request.turnKind !== undefined && request.turnKind !== "QUESTION_TO_Q")
 1718          ? null
 1719          : fitSweepAsk(latest.content);
 1720      const fitSweep: Promise<FitSweepResult | null> =
 1721        sweepAsk === null
 1722          ? Promise.resolve(null)
 1723          : runFitSweep({
 1724              ask: sweepAsk,
 1725              tools,
 1726              context: toolContext,
 1727              available: prefetchTools,
 1728              own:
 1729                standingRead === null
 1730                  ? Promise.resolve(null)
 1731                  : standingRead.then((outcome) =>
 1732                      outcome.result.ok ? outcome.result.data : null,
 1733                    ),
 1734            }).catch(() => null);
 1735      // The reads below are independent of each other and run side by
 1736      // side; each fills its own facts (speed sweep 2026-10-01: in turn
 1737      // they took ~0.6 s before the model was asked anything).
 1738      const mandateRead = (async (): Promise<void> => {
 1739        if (ownInvestor !== null && prefetchTools.has("get_investor_mandate")) {
 1740          const call = {
 1741            callId: "q-own-mandate",
 1742            name: "get_investor_mandate",
 1743            arguments: { investorOrganisationId: ownInvestor },
 1744          };
 1745          const outcome = await tools.execute(call, toolContext);
 1746          ownProfileCall = {
 1747            toolName: outcome.toolName,
 1748            providerName: call.name,
 1749            status: outcome.status,
 1750            failureCode: outcome.failureCode,
 1751            latencyMs: outcome.latencyMs,
 1752          };
 1753          if (outcome.result.ok) {
 1754            ownProfile = ownProfileFact(outcome.result.data);
 1755          }
 1756        }
 1757      })();
 1758      /**
 1759       * Where their own side stands with the counterparty the question is
 1760       * about (CQ-Q-030), read through the same tool the model could call,
 1761       * under the same plan: a company is asked about as an investor, an
 1762       * investor organisation as a company. A side the person is not on
 1763       * (a founder asking about a company) is refused by the tool and
 1764       * simply adds nothing. A relationship itself as the subject is read
 1765       * by its id, for whichever side the person is on; it comes first,
 1766       * because it names exactly what the person is asking about.
 1767       */
 1768      let relationship: AuthorisedFact | null = null;
 1769      let relationshipCall: QToolCallObservation | null = null;
 1770      const asked = askedSubjects(request.subjects, plan);
 1771      const counterparty =
 1772        asked.find((subject) => subject.kind === "RELATIONSHIP") ??
 1773        asked.find(
 1774          (subject) =>
 1775            subject.kind === "COMPANY" ||
 1776            (subject.kind === "INVESTOR_ORGANISATION" &&
 1777              subject.investorOrganisationId !== ownInvestor),
 1778        );
 1779      /**
 1780       * The company on their screen or asked about, read for them (speed
 1781       * sweep 2026-10-01): "this company" is known before the model is
 1782       * asked, so the commonest Discover question needs no tool round to
 1783       * learn its name. Same tool, same plan as the model's own call.
 1784       */
 1785      let onScreenCompany: AuthorisedFact | null = null;
 1786      let onScreenCompanyCall: QToolCallObservation | null = null;
 1787      const companyRead = (async (): Promise<void> => {
 1788        if (
 1789          counterparty?.kind !== "COMPANY" ||
 1790          !prefetchTools.has("get_company")
 1791        ) {
 1792          return;
 1793        }
 1794        const call = {
 1795          callId: "q-on-screen-company",
 1796          name: "get_company",
 1797          arguments: { companyId: counterparty.companyId },
 1798        };
 1799        const outcome = await tools.execute(call, toolContext);
 1800        onScreenCompanyCall = {
 1801          toolName: outcome.toolName,
 1802          providerName: call.name,
 1803          status: outcome.status,
 1804          failureCode: outcome.failureCode,
 1805          latencyMs: outcome.latencyMs,
 1806        };
 1807        if (outcome.result.ok) {
 1808          onScreenCompany = onScreenCompanyFact(outcome.result.data);
 1809        }
 1810      })();
 1811      /**
 1812       * Their own companies this turn names, as typed or as speech misheard
 1813       * them, or as Q's last reply listed them (founder live 2026-10-01:
 1814       * "compare Yamfield Agro, Tallyloom and Kazikit against my mandate"
 1815       * got "I don't have enough company evidence"). Resolved against their
 1816       * own records only, then read through get_company under the plan.
 1817       */
 1818      const namedCompanies: AuthorisedFact[] = [];
 1819      const namedCompanyCalls: QToolCallObservation[] = [];
 1820      const namedRead = (async (): Promise<void> => {
 1821        if (standingRead === null || !prefetchTools.has("get_company")) return;
 1822        const standing = await standingRead.catch(() => null);
 1823        if (standing === null || !standing.result.ok) return;
 1824        const lastQ = [...earlier].reverse().find((m) => m.role === "Q");
 1825        const onScreen =
 1826          counterparty?.kind === "COMPANY" ? counterparty.companyId : null;
 1827        const named = companiesNamedIn(
 1828          `${latest.content}\n${lastQ?.content.slice(0, 4_000) ?? ""}`,
 1829          knownCompaniesOf(standing.result.data),
 1830        ).filter((company) => company.companyId !== onScreen);
 1831        await Promise.all(
 1832          named.map(async (company, index) => {
 1833            const call = {
 1834              callId: `q-named-company-${String(index)}`,
 1835              name: "get_company",
 1836              arguments: { companyId: company.companyId },
 1837            };
 1838            const outcome = await tools.execute(call, toolContext);
 1839            namedCompanyCalls.push({
 1840              toolName: outcome.toolName,
 1841              providerName: call.name,
 1842              status: outcome.status,
 1843              failureCode: outcome.failureCode,
 1844              latencyMs: outcome.latencyMs,
 1845            });
 1846            if (!outcome.result.ok) return;
 1847            const fact = onScreenCompanyFact(
 1848              outcome.result.data,
 1849              "A company of theirs this conversation names",
 1850            );
 1851            if (fact !== null) namedCompanies.push(fact);
 1852          }),
 1853        );
 1854      })();
 1855      /**
 1856       * The Q Daily on their screen, read for them (founder live
 1857       * 2026-10-01: "summarize everything here" on the Daily never read the
 1858       * edition). Their own edition, through the tool the model would use.
 1859       */
 1860      let onScreenDaily: AuthorisedFact | null = null;
 1861      let onScreenDailyCall: QToolCallObservation | null = null;
 1862      const dailyRead = (async (): Promise<void> => {
 1863        if (plan.screen?.route !== "DAILY" || !prefetchTools.has("get_q_daily")) {
 1864          return;
 1865        }
 1866        const call = {
 1867          callId: "q-on-screen-daily",
 1868          name: "get_q_daily",
 1869          arguments: {},
 1870        };
 1871        const outcome = await tools.execute(call, toolContext);
 1872        onScreenDailyCall = {
 1873          toolName: outcome.toolName,
 1874          providerName: call.name,
 1875          status: outcome.status,
 1876          failureCode: outcome.failureCode,
 1877          latencyMs: outcome.latencyMs,
 1878        };
 1879        if (outcome.result.ok) {
 1880          onScreenDaily = onScreenDailyFact(outcome.result.data);
 1881        }
 1882      })();
 1883      /**
 1884       * The document Q made for them that is open on their screen, read for
 1885       * them (voiceq-63, founder live 2026-10-04: Q opened the prep PDF and
 1886       * could not read what it showed). Through read_my_document under the
 1887       * plan, as the asker; its words are their document's, data to read
 1888       * out or summarise, never instructions.
 1889       */
 1890      let onScreenDocument: AuthorisedFact | null = null;
 1891      let onScreenDocumentCall: QToolCallObservation | null = null;
 1892      const documentRead = (async (): Promise<void> => {
 1893        const artifactId = plan.screen?.artifactId;
 1894        if (artifactId === undefined || !prefetchTools.has("read_my_document")) {
 1895          return;
 1896        }
 1897        const call = {
 1898          callId: "q-on-screen-document",
 1899          name: "read_my_document",
 1900          arguments: { artifactId },
 1901        };
 1902        const outcome = await tools.execute(call, toolContext);
 1903        onScreenDocumentCall = {
 1904          toolName: outcome.toolName,
 1905          providerName: call.name,
 1906          status: outcome.status,
 1907          failureCode: outcome.failureCode,
 1908          latencyMs: outcome.latencyMs,
 1909        };
 1910        if (outcome.result.ok) {
 1911          onScreenDocument = onScreenDocumentFact(outcome.result.data);
 1912        }
 1913      })();
 1914      /**
 1915       * Q room R1: the whole page on their screen (sections, tab, filters,
 1916       * open windows), sent as ids only and read back here through the read
 1917       * tools the model could call, under the same plan, as the asker. A ref
 1918       * whose read is refused is dropped unread; nothing the browser wrote
 1919       * reaches the model.
 1920       */
 1921      let onScreenPage: readonly AuthorisedFact[] = [];
 1922      const onScreenPageCalls: QToolCallObservation[] = [];
 1923      const pageRead = (async (): Promise<void> => {
 1924        const manifest = plan.screen?.manifest;
 1925        if (manifest === undefined) return;
 1926        const reads = manifestReads(manifest, prefetchTools);
 1927        const results = new Map<string, unknown>();
 1928        await Promise.all(
 1929          reads.map(async (read, index) => {
 1930            const outcome = await tools
 1931              .execute(
 1932                {
 1933                  callId: `q-on-screen-page-${String(index)}`,
 1934                  name: read.name,
 1935                  arguments: { ...read.arguments },
 1936                },
 1937                toolContext,
 1938              )
 1939              .catch(() => null);
 1940            if (outcome === null) return;
 1941            onScreenPageCalls.push({
 1942              toolName: outcome.toolName,
 1943              providerName: read.name,
 1944              status: outcome.status,
 1945              failureCode: outcome.failureCode,
 1946              latencyMs: outcome.latencyMs,
 1947            });
 1948            if (outcome.result.ok) results.set(read.key, outcome.result.data);
 1949          }),
 1950        );
 1951        onScreenPage = manifestFacts(manifest, results);
 1952      })();
 1953      /**
 1954       * Their day: now in their zone, calls and reminders for 7 days, what
 1955       * waits for their approval, Q's work for them, their last rehearsals
 1956       * (founder demo 2026-10-02). Own records only, through the tools the
 1957       * model would call under the same plan, plus their own rehearsals.
 1958       */
 1959      let ownDay: AuthorisedFact | null = null;
 1960      const ownDayCalls: QToolCallObservation[] = [];
```
