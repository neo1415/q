# Evidence: apps/q-api/src/composition/instructions/engine.ts lines 1786-2000

- Original path: `apps/q-api/src/composition/instructions/engine.ts`
- Line range: 1786-2000 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Standing-instruction firing: activation checks, working hours, actor, delegation, thread reading under budget, stale-card supersede.

```ts
 1786          throw new Error("instruction run key must be 8-80 characters");
 1787        }
 1788        const row = await store.instruction(instructionId);
 1789        if (row === null || row.status !== "ACTIVE") return empty("NOT_ACTIVE");
 1790        const at = now();
 1791        if (row.expires_at !== null && row.expires_at.getTime() <= at.getTime()) {
 1792          await store.expire(row.id);
 1793          return empty("EXPIRED");
 1794        }
 1795        const grant = InstructionGrantSchema.safeParse(row.grant_payload);
 1796        if (!grant.success) return empty("NOT_ACTIVE");
 1797        // Q works in their working hours: no planning (and no spend) outside,
 1798        // and it says so once a day on their work page (QA 2026-10-03: two
 1799        // approved instructions sat ACTIVE with nothing to show on a Saturday).
 1800        if (!withinWorkingHours(at, grant.data.workingHours)) {
 1801          const hours = grant.data.workingHours;
 1802          await note(
 1803            row,
 1804            "hours",
 1805            `Waiting for your working hours (${dayRange(hours.days)} ${hours.start}-${hours.end}, ${hours.timeZone}) before I start.`,
 1806            "OUTSIDE_HOURS",
 1807          );
 1808          return empty("OUTSIDE_HOURS");
 1809        }
 1810        const actor = await dependencies.actorFor(row);
 1811        if (actor === null || actor.userId !== row.user_id) {
 1812          return empty("NO_ACTOR");
 1813        }
 1814        const people = await dependencies.people(actor).catch(() => []);
 1815        const sentBefore = await store.messagesSent(row.id);
 1816        // Scoped delegation: read once per firing. Without an audit sink, or
 1817        // when the read fails, nothing runs under it (every step asks).
 1818        const delegation =
 1819          dependencies.auditDelegated === undefined
 1820            ? null
 1821            : await Promise.resolve()
 1822                .then(() => store.delegationOf?.(row.id) ?? null)
 1823                .catch(() => null);
 1824        const startOfDay = new Date(at.getTime() - 24 * 3_600_000);
 1825        const delegatedToday = {
 1826          count:
 1827            delegation === null
 1828              ? 0
 1829              : await Promise.resolve()
 1830                  .then(() => store.delegatedSince?.(row.id, startOfDay) ?? 0)
 1831                  // Unreadable: treat the day's cap as used up.
 1832                  .catch(() => Number.MAX_SAFE_INTEGER),
 1833        };
 1834        // Unreadable is not "nothing waiting": no hold is added, as before.
 1835        // Both narrowed below when a stale card is superseded (F24).
 1836        let awaiting = await dependencies
 1837          .awaitingAnswer?.(row.id)
 1838          .catch(() => undefined);
 1839        const history = await store.history(row.id);
 1840        // Cards still waiting on the person: never drafted again. A store
 1841        // without the read (older doubles) waits on nothing.
 1842        let cardsWaiting = await Promise.resolve()
 1843          .then(() => store.waitingCards?.(row.id) ?? [])
 1844          .catch(() => []);
 1845        const isWaiting = (
 1846          action: string,
 1847          relationshipId: string | null,
 1848          words: string,
 1849        ): boolean =>
 1850          cardsWaiting.some(
 1851            (card) =>
 1852              card.action === action &&
 1853              (relationshipId === null
 1854                ? card.relationship_id === null && card.words === words
 1855                : card.relationship_id === relationshipId),
 1856          );
 1857        const keyOf = (index: number) =>
 1858          `instr:${row.id}:${runKey}:${String(index)}`;
 1859  
 1860        // S5: what is left of this month's budget. Below one planning call,
 1861        // the instruction pauses and asks to continue (no call is made).
 1862        // Whole micro-dollars: money is never compared as floats.
 1863        const micros = (usd: number) => Math.round(usd * 1_000_000);
 1864        let left =
 1865          micros(Number(row.budget_usd_month)) -
 1866          micros(Number(row.spent_this_month));
 1867  
 1868        // S6: their messages, read only through the quarantined extractor,
 1869        // keeping one planning call in reserve.
 1870        const facts = new Map<string, ThreadFacts>();
 1871        // ADR 0050: each conversation's pace, by code, for the consider step.
 1872        const paces = new Map<string, ThreadPace>();
 1873        const questions = new Map<
 1874          string,
 1875          { readonly messageId: string; readonly text: string }
 1876        >();
 1877        // Zino, 2026-10-08: the conversation and their latest words, for the
 1878        // reviewer and code's thread-consistency check only -- never the
 1879        // planner (S6). Before this the reviewer was handed an empty thread.
 1880        const transcripts = new Map<
 1881          string,
 1882          { readonly thread: string; readonly theirLatest: string | null }
 1883        >();
 1884        if (dependencies.readThread !== undefined) {
 1885          // Conversations with a card still waiting are read first (F24: a
 1886          // stale draft is only seen as stale once its thread is read).
 1887          const carded = new Set(
 1888            cardsWaiting.map((card) => card.relationship_id),
 1889          );
 1890          const threads = inScope(grant.data, people)
 1891            .map((person) => person.relationshipId)
 1892            .filter((id): id is string => id !== null)
 1893            .sort((a, b) => Number(carded.has(b)) - Number(carded.has(a)))
 1894            .slice(0, THREADS_PER_FIRING);
 1895          for (const relationshipId of threads) {
 1896            const spare = left - micros(PLAN_MAX_COST_USD);
 1897            const read = await dependencies.readThread({
 1898              actor,
 1899              instructionId: row.id,
 1900              relationshipId,
 1901              topics: grant.data.topics,
 1902              now: at,
 1903              maxCostUsd: Math.max(0, spare) / 1_000_000,
 1904            });
 1905            if (read.costUsd > 0) {
 1906              left -= micros(read.costUsd);
 1907              await store.addSpend(row.id, read.costUsd);
 1908            }
 1909            if (read.facts !== null) facts.set(relationshipId, read.facts);
 1910            if (read.pace !== undefined) paces.set(relationshipId, read.pace);
 1911            if (read.question !== undefined) {
 1912              questions.set(relationshipId, read.question);
 1913            }
 1914            if (read.transcript !== undefined) {
 1915              transcripts.set(relationshipId, {
 1916                thread: read.transcript,
 1917                theirLatest: read.theirLatest ?? null,
 1918              });
 1919            }
 1920          }
 1921        }
 1922  
 1923        // F24 follow-up (Zino, 7 Oct): a waiting card the conversation has
 1924        // moved past is superseded -- through the Approval Engine, with its
 1925        // history -- and stops counting as waiting, so this firing's planner
 1926        // may draft the reply in its place.
 1927        if (dependencies.supersedeCard !== undefined) {
 1928          for (const { card, reason } of staleCards(cardsWaiting, paces)) {
 1929            const approvalId = card.approval_id;
 1930            const relationshipId = card.relationship_id;
 1931            if (approvalId == null || relationshipId === null) continue;
 1932            const replaced = await dependencies
 1933              .supersedeCard(actor, { approvalId, reason })
 1934              .catch(() => false);
 1935            if (!replaced) continue;
 1936            cardsWaiting = cardsWaiting.filter((one) => one !== card);
 1937            if (
 1938              awaiting !== undefined &&
 1939              !cardsWaiting.some((one) => one.relationship_id === relationshipId)
 1940            ) {
 1941              awaiting = new Set(
 1942                [...awaiting].filter((id) => id !== relationshipId),
 1943              );
 1944            }
 1945            const name = (
 1946              people.find((person) => person.relationshipId === relationshipId)
 1947                ?.name ?? "them"
 1948            ).slice(0, 80);
 1949            await store
 1950              .recordStep({
 1951                instruction: row,
 1952                runKey,
 1953                stepIndex: 140,
 1954                action: "q.note",
 1955                mode: "ASK",
 1956                status: "NOTED",
 1957                relationshipId,
 1958                words: `Replaced my waiting draft to ${name}: ${STALE_WORDS[reason]}. I'll draft a reply to what they said.`,
 1959                reasonCode: "DRAFT_SUPERSEDED",
 1960                qActionId: null,
 1961                idempotencyKey: `instr:${row.id}:superseded:${approvalId}`,
 1962              })
 1963              .catch(() => false);
 1964          }
 1965        }
 1966  
 1967        // Tensorgate, 8 Oct: code's own reading of each conversation for the
 1968        // message checks -- their latest words' distinctive terms, and the
 1969        // numbers the person's own side already stated there.
 1970        const threads = new Map(
 1971          [...transcripts].map(([relationshipId, read]) => [
 1972            relationshipId,
 1973            {
 1974              theirTerms:
 1975                read.theirLatest === null
 1976                  ? []
 1977                  : distinctiveWords(read.theirLatest),
 1978              ourNumbers: threadOwnNumbers(read.thread),
 1979            },
 1980          ]),
 1981        );
 1982  
 1983        // Live QA (instruction 76d6f281): whether each conversation already
 1984        // holds the person's side's message, read from the chats themselves.
 1985        const covered = inScope(grant.data, people)
 1986          .map((person) => person.relationshipId)
 1987          .filter((id): id is string => id !== null);
 1988        const introduced =
 1989          dependencies.introduced === undefined
 1990            ? undefined
 1991            : await dependencies
 1992                .introduced(actor, covered)
 1993                .catch(() => new Set(covered));
 1994  
 1995        // What messages may say: read once per firing, as the person.
 1996        const material =
 1997          dependencies.material === undefined
 1998            ? undefined
 1999            : await dependencies
 2000                .material(actor, inScope(grant.data, people))
```
