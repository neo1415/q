import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Database round trips per unit of work (SUB-SECOND; asked for by G).
 *
 * On hosted, a round trip to Supabase costs 15-20 ms, so the number of
 * them a Q run makes before it can start answering is the latency budget.
 * A counter is bound to an async context (`withRoundTripCounter`), and
 * every query issued inside it, on the request client or the checkpoint
 * pool, is counted. `mark` records the count at a named moment, so a run
 * can report "N round trips before the answer started".
 *
 * Counts queries, not wall time, and nothing about their content.
 *
 * R5: counted where the query is handed to the driver, in the caller's own
 * async context (`instrumentSql`). The driver's debug hook, used before,
 * runs where the driver writes; a query that waited for a free connection
 * was counted in that socket's context, so under load other requests'
 * queries were counted to whichever run opened the socket.
 */

export type RoundTripCounter = {
  count: number;
  /** Round trips so far at each named moment. */
  readonly marks: Record<string, number>;
  /** Milliseconds since the counter was created, at each named moment. */
  readonly markedAtMs: Record<string, number>;
  /**
   * Round trips per phase (R5): the innermost `withRoundTripPhase` label
   * the query was sent under, or "other". Sums to `count`.
   */
  readonly phases: Record<string, number>;
  /**
   * Local diagnosis only (CQ_ROUND_TRIP_TRACE=1): queries sent, per phase
   * and calling source location, so a sink no phase names can still be
   * found. Empty otherwise.
   */
  readonly sites: Record<string, number>;
  /** The run this counter is for; part of every run-cache key. */
  readonly runId: string | null;
  /** The run read cache (`cachedInRun`); lives as long as the counter. */
  readonly cache: Map<string, RunCacheEntry>;
  readonly startedAt: number;
};

type RunCacheEntry = {
  readonly tables: readonly string[];
  readonly value: Promise<unknown>;
};

const storage = new AsyncLocalStorage<RoundTripCounter>();
const phaseStorage = new AsyncLocalStorage<string>();
const TRACE = process.env["CQ_ROUND_TRIP_TRACE"] === "1";

export function createRoundTripCounter(
  runId: string | null = null,
): RoundTripCounter {
  return {
    count: 0,
    marks: {},
    markedAtMs: {},
    phases: {},
    sites: {},
    runId,
    cache: new Map(),
    startedAt: performance.now(),
  };
}

export type RunCacheKey = {
  /** The aggregate read, e.g. "onboarding-summary". */
  readonly aggregate: string;
  /**
   * Tables the read depends on, schema-qualified as the SQL writes them
   * ("core.companies"). A statement this run sends that writes any of them
   * drops the entry (read-your-writes).
   */
  readonly tables: readonly string[];
  /** Whose read it is: the actor's ids, never a role or a claim. */
  readonly actor: string;
  /** The read's own arguments, so different reads never share an entry. */
  readonly fingerprint: string;
};

/**
 * R5: a read of context that is identical within one run, made once per
 * run. Outside a run (no counter bound) it is a plain call. The key is run
 * id + aggregate + actor + fingerprint; a write this run sends to any of
 * the entry's tables drops it, and a failed read is never kept.
 *
 * Never for authorization, firewall or disclosure checks: those are fresh
 * every time, by rule.
 */
export function cachedInRun<T>(
  key: RunCacheKey,
  load: () => Promise<T>,
): Promise<T> {
  const counter = storage.getStore();
  if (counter === undefined) return load();
  const id = [
    counter.runId ?? "",
    key.aggregate,
    key.actor,
    key.fingerprint,
  ].join("\u0000");
  const found = counter.cache.get(id);
  if (found !== undefined) return found.value as Promise<T>;
  const value = load();
  counter.cache.set(id, { tables: key.tables, value });
  value.catch(() => {
    if (counter.cache.get(id)?.value === value) counter.cache.delete(id);
  });
  return value;
}

const WRITE =
  /^\s*(?:insert|update|delete|merge|truncate)\b|\b(?:insert\s+into|update\s+[\w."]+\s+set|delete\s+from)\b/iu;

/** A statement was sent: if it writes, drop what it may have changed. */
function noteStatement(counter: RoundTripCounter, text: string): void {
  if (counter.cache.size === 0 || !WRITE.test(text)) return;
  const lower = text.toLowerCase();
  for (const [id, entry] of counter.cache) {
    if (entry.tables.some((table) => lower.includes(table))) {
      counter.cache.delete(id);
    }
  }
}

/**
 * Attributes the round trips `work` sends to `label` (the innermost label
 * wins). Labels are fixed phase or tool names, never content. A plain call
 * through when no counter is bound, so it costs nothing outside a run.
 */
export function withRoundTripPhase<T>(label: string, work: () => T): T {
  if (storage.getStore() === undefined) return work();
  return phaseStorage.run(label, work);
}

/**
 * The first three stack frames outside the database client and
 * node_modules, innermost first: the reading and who asked for it.
 */
function callSite(raw?: string): string {
  const stack = (raw ?? new Error().stack)?.split("\n").slice(1) ?? [];
  const sites: string[] = [];
  for (const frame of stack) {
    if (
      frame.includes("node_modules") ||
      frame.includes("/database/") ||
      frame.includes("node:")
    ) {
      continue;
    }
    const match = /\/(?:packages|apps)\/(.+?):(\d+):\d+\)?$/.exec(frame.trim());
    if (match === null) continue;
    sites.push(
      `${(match[1] ?? "").replace(/^([^/]+)\/(?:dist|src)\/(?:infrastructure\/)?/, "$1/")}:${match[2] ?? ""}`,
    );
    if (sites.length === 3) break;
  }
  return sites.length === 0 ? "unknown" : sites.join(" < ");
}

export function withRoundTripCounter<T>(
  counter: RoundTripCounter,
  work: () => T,
): T {
  return storage.run(counter, work);
}

/** One query was sent. A no-op outside a counted context. */
export function countRoundTrip(phase?: string): void {
  const counter = storage.getStore();
  if (counter === undefined) return;
  counter.count += 1;
  const label = phase ?? phaseStorage.getStore() ?? "other";
  counter.phases[label] = (counter.phases[label] ?? 0) + 1;
}

/**
 * The request client's query was handed to the driver (instrumentSql), in
 * the caller's context: counted, its site traced when asked, and a write
 * drops the run-cache entries it may have changed.
 */
function querySent(text: string, stack: string | undefined): void {
  const counter = storage.getStore();
  if (counter === undefined) return;
  countRoundTrip();
  noteStatement(counter, text);
  if (TRACE) {
    const where = stack === undefined ? text : callSite(stack);
    const site = `${phaseStorage.getStore() ?? "other"} | ${where}`;
    counter.sites[site] = (counter.sites[site] ?? 0) + 1;
  }
}

type Fn = (...args: unknown[]) => unknown;
type QueryLike = Promise<unknown> & {
  handle: Fn;
  executed?: boolean;
};

function isQuery(value: unknown): value is QueryLike {
  return (
    value instanceof Promise &&
    typeof (value as { handle?: unknown }).handle === "function"
  );
}

function statementText(first: unknown): string {
  if (typeof first === "string") return first;
  if (Array.isArray(first)) return first.join("?");
  return "";
}

/**
 * Counts each query when it is handed to the driver (the driver's own
 * `handle`, which runs once, in the caller's async context, when the query
 * is awaited or executed). A query used only as a fragment of another is
 * never handled, so never counted. Behaviour is otherwise untouched.
 */
function track(value: unknown, first: unknown): unknown {
  if (!isQuery(value)) return value;
  const query = value;
  const handle = query.handle;
  const text = statementText(first);
  const stack = TRACE ? new Error().stack : undefined;
  query.handle = function (this: QueryLike, ...args: unknown[]) {
    if (this.executed !== true) querySent(text, stack);
    return handle.apply(this, args);
  };
  return query;
}

/**
 * The request client, instrumented for the per-run counter and the run
 * read cache. Every query this client, its transactions and its reserved
 * connections send is counted where it is sent; BEGIN and COMMIT (or
 * ROLLBACK) count one each. Arguments, results and errors pass through.
 */
export function instrumentSql<T extends object>(sql: T): T {
  const wrapFunction =
    (fn: Fn, target: object): Fn =>
    (...args: unknown[]) =>
      track(fn.apply(target, args), args[0]);
  return new Proxy(sql, {
    apply(target, thisArg, args: unknown[]) {
      return track(Reflect.apply(target as Fn, thisArg, args), args[0]);
    },
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const fn = value as Fn;
      if (property === "begin" || property === "savepoint") {
        return (...args: unknown[]) => {
          const last = args.length - 1;
          const work = args[last];
          if (typeof work === "function") {
            args[last] = (inner: object) => (work as Fn)(instrumentSql(inner));
          }
          querySent(property === "begin" ? "begin" : "savepoint", undefined);
          const done = fn.apply(target, args) as Promise<unknown>;
          return done.finally(() => {
            querySent("commit", undefined);
          });
        };
      }
      if (property === "reserve") {
        return async (...args: unknown[]) =>
          instrumentSql((await fn.apply(target, args)) as object);
      }
      return wrapFunction(fn, target);
    },
  });
}

if (TRACE) Error.stackTraceLimit = 40;

/** Records the count so far under a label, once (the first time wins). */
export function markRoundTrips(label: string): void {
  const counter = storage.getStore();
  if (counter !== undefined && counter.marks[label] === undefined) {
    counter.marks[label] = counter.count;
    counter.markedAtMs[label] = Math.round(
      performance.now() - counter.startedAt,
    );
  }
}

export function currentRoundTripCounter(): RoundTripCounter | undefined {
  return storage.getStore();
}
