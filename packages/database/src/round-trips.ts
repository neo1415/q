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
  // Which part of the turn asked: the frames of the model gateway's Q
  // answer module (prepareTurn's reads start there), outermost last.
  const via = (raw ?? "")
    .split("\n")
    .map((frame) =>
      /(?:model-gateway\/(?:dist|src)\/q\/index|q-specialists\/(?:dist|src)\/answer|q-orchestrator\/(?:dist|src)\/graph)\.[jt]s:(\d+):/.exec(
        frame,
      ),
    )
    .flatMap((m) => (m === null ? [] : [m[1] ?? ""]))
    .slice(0, 4);
  const base = sites.length === 0 ? "unknown" : sites.join(" < ");
  return via.length === 0 ? base : `${base} [q/index ${via.join(",")}]`;
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
  /**
   * The driver's own; settle the awaited query (postgres.js Query). The
   * driver calls them when the connection is done with the query.
   */
  resolve?: (result: unknown) => void;
  reject?: (error: unknown) => void;
  cancel?: () => unknown;
  /** Set for a cursor or forEach read, which governs its own pace. */
  cursorFn?: unknown;
  forEachFn?: unknown;
};

/** Client-side limits applied where each query is handed to the driver. */
export type SqlInstrumentOptions = {
  /**
   * Milliseconds after a query is handed to the driver at which it is
   * asked to cancel and its await rejects with SQLSTATE 57014 (TIMEOUT).
   * Undefined: no deadline.
   */
  readonly queryDeadlineMs?: number | undefined;
  /**
   * Transaction pooler only: the most statements and transactions handed
   * to the driver at once, which is the pool size (ConnectionGate).
   * Undefined: no gate.
   */
  readonly connectionSlots?: number | undefined;
  /**
   * Gated only: opens a fresh driver with the same settings, so a pool
   * whose every connection is wedged can be replaced while the process
   * keeps running (`connectionPoolOf(sql).recycle()`, used by
   * `watchConnectionPool`). Absent: the pool can be inspected, not
   * recycled.
   */
  readonly reopen?: (() => object) | undefined;
};

/** What a held slot is for; never any statement text. */
export type ConnectionPermitKind =
  "statement" | "transaction" | "reserved" | "notify";

type Permit = { readonly kind: ConnectionPermitKind; readonly since: number };

/** A snapshot of the gate, for the pool watchdog. Counts and ages only. */
export type ConnectionPoolState = {
  readonly slots: number;
  readonly held: number;
  readonly waiting: number;
  /** Age of the longest-held slot; null when none is held. */
  readonly oldestHeldMs: number | null;
  /** Age of the most recently taken slot; null when none is held. */
  readonly youngestHeldMs: number | null;
  readonly heldByKind: Readonly<Record<ConnectionPermitKind, number>>;
  /** Times this pool was replaced since the process started. */
  readonly recycles: number;
};

export type ConnectionPoolControl = {
  readonly inspect: () => ConnectionPoolState;
  /**
   * Replaces the driver with a fresh one and ends the old one at once: its
   * connections are destroyed, so every statement or transaction still
   * holding one rejects (CONNECTION) and its holder unwinds; whoever was
   * waiting for a slot fails the same way. False when it cannot (no
   * `reopen`).
   */
  readonly recycle: () => boolean;
  /** The client deadline each query carries; undefined: none. */
  readonly deadlineMs: number | undefined;
};

/**
 * At most one statement in flight per connection behind Supavisor's
 * transaction mode (17 Nov 2026, scripts/db/pooler-proof).
 *
 * When no connection is free, postgres.js writes a query onto a connection
 * whose current query has not answered yet (its `max_pipeline`, which
 * cannot be 0: a transaction's BEGIN then never reserves its connection).
 * Supavisor releases the server connection at the first query's
 * ReadyForQuery and never answers the one written behind it, so that
 * await hangs. So the driver is never handed more work than it has
 * connections: each statement outside a transaction, and each transaction
 * as a whole, holds one slot from before the driver sees it until the
 * driver is done with it; the driver then always finds a free or unopened
 * connection. A statement waiting for a slot is already under its client
 * deadline; a transaction waits at most that long for one.
 *
 * Each held slot is a permit with the time it was taken, so the pool
 * watchdog can tell a busy pool from a wedged one (19 Nov 2026).
 */
type ConnectionGate = {
  /** A permit when a slot was free and is now held. */
  readonly tryAcquire: (kind: ConnectionPermitKind) => Permit | undefined;
  /**
   * Queue for the next slot; returns a function that leaves the queue.
   * `fail` is called instead of `grant` when the gate is closed.
   */
  readonly wait: (
    kind: ConnectionPermitKind,
    grant: (permit: Permit) => void,
    fail: (error: Error) => void,
  ) => () => void;
  /** Gives the slot back. Idempotent per permit. */
  readonly release: (permit: Permit) => void;
  readonly inspect: () => Omit<ConnectionPoolState, "recycles">;
  /** The pool behind it is gone: drop every permit, fail every waiter. */
  readonly close: (error: Error) => void;
};

type Waiter = {
  readonly kind: ConnectionPermitKind;
  readonly grant: (permit: Permit) => void;
  readonly fail: (error: Error) => void;
};

function createConnectionGate(size: number): ConnectionGate {
  const held = new Set<Permit>();
  const waiters: Waiter[] = [];
  let closed = false;
  const take = (kind: ConnectionPermitKind): Permit => {
    const permit: Permit = { kind, since: Date.now() };
    held.add(permit);
    return permit;
  };
  return {
    tryAcquire: (kind) =>
      closed || held.size >= size || waiters.length > 0
        ? undefined
        : take(kind),
    wait: (kind, grant, fail) => {
      if (closed) {
        fail(new ConnectionPoolRecycledError());
        return () => undefined;
      }
      const waiter: Waiter = { kind, grant, fail };
      waiters.push(waiter);
      return () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
      };
    },
    release: (permit) => {
      // A second release of one permit, or one from before a close, is a
      // no-op: it can never free a slot someone else holds.
      if (!held.delete(permit)) return;
      // The slot passes straight to the next waiter, so a newcomer's
      // tryAcquire cannot overtake the queue.
      const next = waiters.shift();
      if (next !== undefined) next.grant(take(next.kind));
    },
    inspect: () => {
      const now = Date.now();
      let oldest: number | null = null;
      let youngest: number | null = null;
      const heldByKind: Record<ConnectionPermitKind, number> = {
        statement: 0,
        transaction: 0,
        reserved: 0,
        notify: 0,
      };
      for (const permit of held) {
        const age = now - permit.since;
        oldest = oldest === null ? age : Math.max(oldest, age);
        youngest = youngest === null ? age : Math.min(youngest, age);
        heldByKind[permit.kind] += 1;
      }
      return {
        slots: size,
        held: held.size,
        waiting: waiters.length,
        oldestHeldMs: oldest,
        youngestHeldMs: youngest,
        heldByKind,
      };
    },
    close: (error) => {
      closed = true;
      held.clear();
      for (const waiter of waiters.splice(0)) waiter.fail(error);
    },
  };
}

/**
 * The error a statement or transaction gets when the pool it was using, or
 * waiting for, was recycled by the watchdog. SQLSTATE 08006 (connection
 * failure), so it is classified as CONNECTION.
 */
export class ConnectionPoolRecycledError extends Error {
  readonly code = "08006";
  constructor() {
    super("the database connection pool was recycled");
    this.name = "ConnectionPoolRecycledError";
  }
}

/**
 * Statements this process saw end in SQLSTATE 57014 (the server's
 * statement timeout, or the client deadline shaped like it) since it
 * started. A monotonic count with no ids or text, read by the workers'
 * operational check, which compares two readings, so it never resets.
 */
let timeoutsObserved = 0;

export function databaseTimeoutsObserved(): number {
  return timeoutsObserved;
}

function isStatementTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "57014"
  );
}

/** Counts the query's rejection when it is a timeout; the caller's await is untouched. */
function observeTimeout(query: QueryLike): void {
  // The native then: the driver's own `then` would hand the query over.
  void Promise.prototype.then.call(query, undefined, (error: unknown) => {
    if (isStatementTimeout(error)) timeoutsObserved += 1;
  });
}

/** Resolves once a slot is held; rejects as 57014 after `deadlineMs`. */
function acquireSlot(
  gate: ConnectionGate,
  kind: ConnectionPermitKind,
  deadlineMs: number | undefined,
): Promise<Permit> {
  const free = gate.tryAcquire(kind);
  if (free !== undefined) return Promise.resolve(free);
  return new Promise<Permit>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const leave = gate.wait(
      kind,
      (permit) => {
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(permit);
      },
      (error) => {
        done = true;
        if (timer !== undefined) clearTimeout(timer);
        reject(error);
      },
    );
    if (deadlineMs !== undefined && !done) {
      timer = setTimeout(() => {
        done = true;
        leave();
        timeoutsObserved += 1;
        reject(new QueryDeadlineError(deadlineMs));
      }, deadlineMs);
      timer.unref();
    }
  });
}

async function withSlot<T>(
  gate: ConnectionGate,
  kind: ConnectionPermitKind,
  deadlineMs: number | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const permit = await acquireSlot(gate, kind, deadlineMs);
  try {
    return await work();
  } finally {
    gate.release(permit);
  }
}

/**
 * The error a query's await rejects with when its client deadline passes:
 * shaped like the server's statement timeout (57014), so it is classified
 * as TIMEOUT and never carries query text.
 */
export class QueryDeadlineError extends Error {
  readonly code = "57014";
  readonly deadlineMs: number;
  constructor(deadlineMs: number) {
    super(`query exceeded its ${String(deadlineMs)} ms client deadline`);
    this.name = "QueryDeadlineError";
    this.deadlineMs = deadlineMs;
  }
}

/**
 * Bounds one query's await (pooler-safe statement timeout, 16 Nov 2026).
 * When the deadline passes the driver is asked to cancel (a CancelRequest
 * to the backend, or the query is dropped from the queue if never sent)
 * and the await rejects at once, whether or not the cancel lands: a
 * pooler that never answers must not hold the caller. A late answer from
 * the server then settles nothing. Cursor and forEach reads are left alone.
 *
 * `rejectCaller` settles the caller's await; by default the query's own
 * reject. Behind the gate it is the driver's original reject, so that
 * rejecting the caller is not mistaken for the driver being done with the
 * connection.
 */
function armDeadline(
  query: QueryLike,
  deadlineMs: number,
  rejectCaller?: (error: unknown) => void,
): void {
  const timer = setTimeout(() => {
    if (query.cursorFn !== undefined || query.forEachFn !== undefined) return;
    try {
      void Promise.resolve(query.cancel?.()).catch(() => undefined);
    } catch {
      // Best effort: the rejection below is what bounds the caller.
    }
    const error = new QueryDeadlineError(deadlineMs);
    if (rejectCaller === undefined) query.reject?.(error);
    else rejectCaller(error);
  }, deadlineMs);
  timer.unref();
  const clear = () => {
    clearTimeout(timer);
  };
  // The native then: the driver's own `then` would hand the query over.
  void Promise.prototype.then.call(query, clear, clear);
}

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
function track(
  value: unknown,
  first: unknown,
  options: SqlInstrumentOptions,
  gate?: ConnectionGate,
): unknown {
  if (!isQuery(value)) return value;
  const query = value;
  const handle = query.handle;
  const text = statementText(first);
  const stack = TRACE ? new Error().stack : undefined;
  const deadlineMs = options.queryDeadlineMs;
  if (gate === undefined) {
    query.handle = function (this: QueryLike, ...args: unknown[]) {
      if (this.executed !== true) {
        querySent(text, stack);
        observeTimeout(this);
        if (deadlineMs !== undefined) armDeadline(this, deadlineMs);
      }
      return handle.apply(this, args);
    };
    return query;
  }
  // Gated (transaction pooler): the driver's own handle runs only once a
  // slot is held. The deadline is armed first, so it bounds the wait for a
  // slot too.
  let started = false;
  query.handle = function (this: QueryLike, ...args: unknown[]) {
    if (started) return undefined;
    started = true;
    querySent(text, stack);
    observeTimeout(this);
    // The slot follows the CONNECTION, never the caller's await (incident
    // 19 Nov 2026). The client deadline rejects the caller while the
    // statement may still be running on its connection; releasing the
    // slot then let the next statement be written behind it, which
    // Supavisor never answers, and every such connection stayed wedged
    // until the process restarted. The driver settles a query (its own
    // resolve or reject, at ReadyForQuery or when the connection fails)
    // only once the connection is free, so the slot is released there.
    const driverResolve = this.resolve;
    const driverReject = this.reject;
    const followsDriver =
      typeof driverResolve === "function" && typeof driverReject === "function";
    let permit: Permit | undefined;
    let driverDone = false;
    let callerDone = false;
    const releaseHeld = () => {
      const held = permit;
      permit = undefined;
      if (held !== undefined) gate.release(held);
    };
    if (followsDriver) {
      const driverSettled = () => {
        if (driverDone) return;
        driverDone = true;
        // After the driver's own bookkeeping for this answer has run, as
        // the caller's continuation would.
        queueMicrotask(releaseHeld);
      };
      this.resolve = (result: unknown) => {
        driverSettled();
        driverResolve(result);
      };
      this.reject = (error: unknown) => {
        driverSettled();
        driverReject(error);
      };
    }
    if (deadlineMs !== undefined) {
      armDeadline(
        this,
        deadlineMs,
        followsDriver
          ? (error) => {
              callerDone = true;
              driverReject(error);
            }
          : undefined,
      );
    }
    const callerSettled = () => {
      callerDone = true;
      // A driver of unknown shape: the caller's settlement is all there is.
      if (!followsDriver) releaseHeld();
    };
    // The native then: the driver's own `then` would hand the query over.
    void Promise.prototype.then.call(this, callerSettled, callerSettled);
    const run = (granted: Permit) => {
      // Rejected while it waited (its deadline, or the pool recycled):
      // never handed to the driver, which would park a connection on a
      // cancelled query.
      if (callerDone || driverDone) {
        gate.release(granted);
        return;
      }
      permit = granted;
      handle.apply(this, args);
    };
    const fail = (error: Error) => {
      callerDone = true;
      (followsDriver ? driverReject : this.reject)?.(error);
    };
    const free = gate.tryAcquire("statement");
    if (free !== undefined) {
      run(free);
      return undefined;
    }
    const leave = gate.wait("statement", run, fail);
    void Promise.prototype.then.call(this, leave, leave);
    return undefined;
  };
  return query;
}

const pools = new WeakMap<object, ConnectionPoolControl>();

/**
 * The gate and recycle control of a request client behind the transaction
 * pooler; undefined for any other client (no gate, nothing to watch).
 */
export function connectionPoolOf(
  sql: object,
): ConnectionPoolControl | undefined {
  return pools.get(sql);
}

/**
 * The request client, instrumented for the per-run counter and the run
 * read cache. Every query this client, its transactions and its reserved
 * connections send is counted where it is sent; BEGIN and COMMIT (or
 * ROLLBACK) count one each. Arguments, results and errors pass through.
 *
 * Gated, the driver behind the client can be replaced (`recycle`): every
 * call reads the current driver and its gate, so callers keep the same
 * client object across a recycle.
 */
export function instrumentSql<T extends object>(
  sql: T,
  options: SqlInstrumentOptions = {},
): T {
  // Only the pool itself is gated: the statements of a transaction or a
  // reserved connection run on the connection its slot already holds.
  const slots = options.connectionSlots;
  let current: { driver: object; gate: ConnectionGate | undefined } = {
    driver: sql,
    gate: slots === undefined ? undefined : createConnectionGate(slots),
  };
  let recycles = 0;
  const inner: SqlInstrumentOptions = {
    queryDeadlineMs: options.queryDeadlineMs,
  };
  const deadlineMs = options.queryDeadlineMs;
  const proxy = new Proxy(sql, {
    apply(_target, thisArg, args: unknown[]) {
      const { driver, gate } = current;
      return track(
        Reflect.apply(driver as Fn, thisArg, args),
        args[0],
        options,
        gate,
      );
    },
    get(target, property, receiver) {
      const { driver, gate } = current;
      const own = Reflect.getOwnPropertyDescriptor(target, property);
      // A proxy must report a non-configurable own property of its target
      // as it is; nothing reads those (a function's `prototype`).
      const value: unknown =
        driver === target || own?.configurable === false
          ? Reflect.get(target, property, receiver)
          : Reflect.get(driver, property, driver);
      if (typeof value !== "function") return value;
      const fn = value as Fn;
      if (property === "begin" || property === "savepoint") {
        return (...args: unknown[]) => {
          const last = args.length - 1;
          const work = args[last];
          if (typeof work === "function") {
            args[last] = (transaction: object) =>
              (work as Fn)(instrumentSql(transaction, inner));
          }
          const run = () => {
            querySent(property === "begin" ? "begin" : "savepoint", undefined);
            const done = fn.apply(driver, args) as Promise<unknown>;
            return done.finally(() => {
              querySent("commit", undefined);
            });
          };
          return gate === undefined
            ? run()
            : withSlot(gate, "transaction", deadlineMs, run);
        };
      }
      if (property === "reserve") {
        return async (...args: unknown[]) => {
          if (gate === undefined) {
            return instrumentSql(
              (await fn.apply(driver, args)) as object,
              inner,
            );
          }
          // The slot is held until the caller releases the connection.
          const permit = await acquireSlot(gate, "reserved", deadlineMs);
          let reserved: { release: () => void };
          try {
            reserved = (await fn.apply(driver, args)) as {
              release: () => void;
            };
          } catch (error) {
            gate.release(permit);
            throw error;
          }
          const free = reserved.release.bind(reserved);
          reserved.release = () => {
            free();
            gate.release(permit);
          };
          return instrumentSql(reserved, inner);
        };
      }
      if (property === "notify" && gate !== undefined) {
        // The driver sends pg_notify through its own pool, uninstrumented.
        return (...args: unknown[]) =>
          withSlot(gate, "notify", deadlineMs, () =>
            Promise.resolve(fn.apply(driver, args)),
          );
      }
      return (...args: unknown[]) =>
        track(fn.apply(driver, args), args[0], options, gate);
    },
  });
  if (slots !== undefined) {
    pools.set(proxy, {
      deadlineMs,
      inspect: () => {
        const gate = current.gate;
        return {
          ...(gate === undefined
            ? {
                slots,
                held: 0,
                waiting: 0,
                oldestHeldMs: null,
                youngestHeldMs: null,
                heldByKind: {
                  statement: 0,
                  transaction: 0,
                  reserved: 0,
                  notify: 0,
                },
              }
            : gate.inspect()),
          recycles,
        };
      },
      recycle: () => {
        const reopen = options.reopen;
        if (reopen === undefined) return false;
        const old = current;
        current = { driver: reopen(), gate: createConnectionGate(slots) };
        recycles += 1;
        // Waiters fail now; holders unwind as the old driver destroys
        // their connections (each statement and transaction rejects).
        old.gate?.close(new ConnectionPoolRecycledError());
        const end = (old.driver as { end?: unknown }).end;
        if (typeof end === "function") {
          try {
            void Promise.resolve(
              (end as Fn).call(old.driver, { timeout: 0 }),
            ).catch(() => undefined);
          } catch {
            // Best effort: the new pool is already serving.
          }
        }
        return true;
      },
    });
  }
  return proxy;
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
