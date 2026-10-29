import { z } from "zod";

import {
  PublicWebSearchHitSchema,
  RESEARCH_PROVIDER_CODES,
  RESEARCH_PROVIDER_FAILURE_CLASSES,
  type PublicWebExtractResult,
  type PublicWebSearchRequest,
  type PublicWebSearchResult,
  type ResearchProviderCode,
  type ResearchProviderFailureClass,
} from "../contracts.js";
import {
  isResearchProviderFailure,
  ResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";
import { SYSTEM_RESEARCH_TIME, type ResearchTime } from "../time.js";

/**
 * Record and replay for the research acceptance gate (owner 2026-10-29).
 *
 * Live runs scored 4/10 and 2/10 while every offline test was green: the
 * tests used invented markets and never pushed a real request through the
 * real egress filter, planner, tiering and report. The gate records each
 * golden case ONCE against the real providers and then replays it in CI
 * with no network.
 *
 * Recording wraps the real provider and keeps only what the provider
 * returned -- each hit's url, title, snippet, date and relevance; each
 * page's url, title and text -- copied field by field, so nothing of
 * Capital Q's own (a person's records, a vendor's raw payload) can ride
 * along. The one thing of ours kept is the query, which is what left
 * Capital Q through the egress filter and is public by construction.
 *
 * Replay serves those recordings by normalised query, and a query or a
 * page the recording does not hold is a MISS: it is listed and, by
 * default, thrown as a plain Error (never a ResearchProviderFailure,
 * which the research service would quietly degrade). A code change that
 * alters what is searched is therefore visible, never silently answered.
 */

export const RECORDED_FIXTURE_VERSION = 2;

/** The key a search is recorded and replayed under. */
export function recordedSearchKey(
  request: Pick<PublicWebSearchRequest, "query"> & {
    readonly includeDomains?: readonly string[] | undefined;
  },
): string {
  const query = request.query.trim().toLowerCase().replace(/\s+/gu, " ");
  const domains = [...(request.includeDomains ?? [])]
    .map((domain) => domain.trim().toLowerCase())
    .sort();
  return domains.length === 0 ? query : `${query} @${domains.join(",")}`;
}

const FailureSchema = z
  .object({ failureClass: z.enum(RESEARCH_PROVIDER_FAILURE_CLASSES) })
  .strict();

const RecordedSearchSchema = z
  .object({
    key: z.string().min(1),
    query: z.string().min(1),
    includeDomains: z.array(z.string()),
    hits: z.array(PublicWebSearchHitSchema),
    failure: FailureSchema.nullable(),
  })
  .strict();

const RecordedPageSchema = z
  .object({
    url: z.string().min(1),
    title: z.string().nullable(),
    text: z.string(),
  })
  .strict();

/** One page-read request as the caller saw it. */
const RecordedExtractSchema = z
  .object({
    /** The URLs asked together, in order. */
    urls: z.array(z.string()),
    /** The URLs it returned as pages, in order (their text in `pages`). */
    read: z.array(z.string()),
    failedUrls: z.array(z.string()),
    /** The request failed as a whole (a read given up on is a TIMEOUT). */
    failure: FailureSchema.nullable(),
  })
  .strict();

/** What a run waited on and when (see the header). */
export const RecordedScheduleSchema = z
  .object({
    /** Every clock reading the run took, in order (epoch ms). */
    clock: z.array(z.number()),
    /** Everything it waited on, labelled, in the order it began. */
    begun: z.array(z.string()),
    /** The order those settled: indices into `begun`. */
    settled: z.array(z.number().int().min(0)),
  })
  .strict();
export type RecordedSchedule = z.infer<typeof RecordedScheduleSchema>;

export const RecordedResearchFixtureSchema = z
  .object({
    version: z.literal(RECORDED_FIXTURE_VERSION),
    providerCode: z.enum(RESEARCH_PROVIDER_CODES),
    recordedAt: z.string().min(1),
    /** Every search, in the order it began (a repeated query twice). */
    searches: z.array(RecordedSearchSchema),
    /** Every page read, by URL. */
    pages: z.array(RecordedPageSchema),
    /** Pages the provider could not read when recorded. */
    failedUrls: z.array(z.string()),
    /** Page reads that failed as a whole when recorded. */
    extractFailures: z.array(
      z
        .object({
          urls: z.array(z.string()),
          failureClass: z.enum(RESEARCH_PROVIDER_FAILURE_CLASSES),
        })
        .strict(),
    ),
    /** Every page-read request, in the order it began. */
    extracts: z.array(RecordedExtractSchema),
    /** The run's schedule; null: recorded without one (not replayable). */
    schedule: RecordedScheduleSchema.nullable(),
  })
  .strict();
export type RecordedResearchFixture = z.infer<
  typeof RecordedResearchFixtureSchema
>;

/** Bounds on what a fixture keeps of a page: enough for the gate's checks. */
const PAGE_TEXT_MAX = 60_000;

function copyHit(hit: PublicWebSearchResult["hits"][number]) {
  return {
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet,
    publishedAt: hit.publishedAt,
    relevance: hit.relevance,
  };
}

const searchLabel = (key: string) => `WEB SEARCH ${key}`;
const extractLabel = (urls: readonly string[]) =>
  `WEB EXTRACT ${urls.join(" ")}`;
const timerLabel = (ms: number) => `TIMER ${String(ms)}`;

function timeoutReason(): DOMException {
  return new DOMException(
    "The operation was aborted due to timeout",
    "TimeoutError",
  );
}

/** Lets every pending continuation run (microtasks and a few turns). */
async function idle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Time: recorded, replayed, and virtual (for scripted runs)
// ---------------------------------------------------------------------------

export type RecordingTime = ResearchTime & {
  /** Runs `work`, keeping when it began and when it settled. */
  readonly track: <T>(label: string, work: () => Promise<T>) => Promise<T>;
  readonly schedule: () => RecordedSchedule;
};

/** Records the run's schedule over `base` (the system's when live). */
export function createRecordingTime(
  base: ResearchTime = SYSTEM_RESEARCH_TIME,
): RecordingTime {
  const clock: number[] = [];
  const begun: string[] = [];
  const settled: number[] = [];
  return {
    now: () => {
      const value = base.now();
      clock.push(value);
      return value;
    },
    timeout: (ms) => {
      const id = begun.push(timerLabel(ms)) - 1;
      const inner = base.timeout(ms);
      // Registered first: the firing is kept before anything reacts to it.
      inner.signal.addEventListener("abort", () => settled.push(id), {
        once: true,
      });
      return inner;
    },
    track: <T>(label: string, work: () => Promise<T>): Promise<T> => {
      const id = begun.push(label) - 1;
      // Begun at once; a throw before it returns a promise is its failure.
      const running = new Promise<T>((resolve) => {
        resolve(work());
      });
      return running.then(
        (value) => {
          settled.push(id);
          return value;
        },
        (error: unknown) => {
          settled.push(id);
          throw error;
        },
      );
    },
    schedule: () => ({
      clock: [...clock],
      begun: [...begun],
      settled: [...settled],
    }),
  };
}

export type ReplayTime = ResearchTime & {
  /**
   * What the run waits on: `outcome` is its recorded answer, delivered
   * when the schedule says it settled.
   */
  readonly track: <T>(label: string, outcome: () => Promise<T>) => Promise<T>;
  /** Runs `run`, releasing what it waits on in the recorded order. */
  readonly drive: <T>(run: () => Promise<T>) => Promise<T>;
  /** Where the run left the recorded schedule. */
  readonly misses: readonly string[];
};

export function createReplayTime(schedule: RecordedSchedule): ReplayTime {
  const recorded = RecordedScheduleSchema.parse(schedule);
  const misses: string[] = [];
  const pending = new Map<number, () => void>();
  let readings = 0;
  let begun = 0;
  const begin = (label: string): number => {
    const id = begun;
    begun += 1;
    const expected = recorded.begun[id];
    if (expected !== label)
      misses.push(
        `began "${label.slice(0, 160)}" where the recording began "${(expected ?? "nothing").slice(0, 160)}"`,
      );
    return id;
  };
  return {
    misses,
    now: () => {
      const value = recorded.clock[readings];
      readings += 1;
      if (value !== undefined) return value;
      misses.push("read the clock more often than the recorded run");
      return recorded.clock.at(-1) ?? 0;
    },
    timeout: (ms) => {
      const id = begin(timerLabel(ms));
      const controller = new AbortController();
      let cancelled = false;
      pending.set(id, () => {
        if (cancelled)
          misses.push(
            `a ${String(ms)} ms deadline the recording saw fire was cancelled first`,
          );
        else controller.abort(timeoutReason());
      });
      return {
        signal: controller.signal,
        cancel: () => {
          cancelled = true;
        },
      };
    },
    track: <T>(label: string, outcome: () => Promise<T>): Promise<T> => {
      const id = begin(label);
      return new Promise<T>((resolve, reject) => {
        pending.set(id, () => {
          outcome().then(resolve, reject);
        });
      });
    },
    drive: async <T>(run: () => Promise<T>): Promise<T> => {
      let done = false;
      const running = run();
      running.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );
      for (const id of recorded.settled) {
        await idle();
        if (done) break;
        const release = pending.get(id);
        if (release === undefined) {
          misses.push(
            `the recording waited on "${(recorded.begun[id] ?? "?").slice(0, 160)}", which this run had not begun`,
          );
          break;
        }
        pending.delete(id);
        release();
      }
      await idle();
      if (!done) {
        misses.push("the run still waits after the recording's last event");
        throw new Error(`Research replay diverged: ${misses.join("; ")}`);
      }
      if (readings !== recorded.clock.length)
        misses.push(
          `read the clock ${String(readings)} times; the recorded run ${String(recorded.clock.length)}`,
        );
      if (begun !== recorded.begun.length)
        misses.push(
          `waited on ${String(begun)} things; the recorded run ${String(recorded.begun.length)}`,
        );
      return running;
    },
  };
}

export type VirtualTime = ResearchTime & {
  /** Resolves after `ms` of virtual time. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Runs `run`, advancing the clock to each next timer whenever idle. */
  readonly drive: <T>(run: () => Promise<T>) => Promise<T>;
};

/**
 * A scripted run's clock (tests): time moves only when everything is
 * waiting, to the next timer, so a "slow" provider costs no real time and
 * a deadline fires exactly when due.
 */
export function createVirtualTime(startMs: number): VirtualTime {
  let current = startMs;
  let sequence = 0;
  const timers: {
    readonly due: number;
    readonly order: number;
    readonly fire: () => void;
    cancelled: boolean;
  }[] = [];
  const schedule = (ms: number, fire: () => void) => {
    const timer = {
      due: current + Math.max(0, ms),
      order: sequence,
      fire,
      cancelled: false,
    };
    sequence += 1;
    timers.push(timer);
    return timer;
  };
  return {
    now: () => current,
    timeout: (ms) => {
      const controller = new AbortController();
      const timer = schedule(ms, () => controller.abort(timeoutReason()));
      return {
        signal: controller.signal,
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        schedule(ms, resolve);
      }),
    drive: async <T>(run: () => Promise<T>): Promise<T> => {
      let done = false;
      const running = run();
      running.then(
        () => {
          done = true;
        },
        () => {
          done = true;
        },
      );
      for (;;) {
        await idle();
        if (done) return running;
        const live = timers
          .filter((timer) => !timer.cancelled)
          .sort((a, b) => a.due - b.due || a.order - b.order);
        const next = live[0];
        if (next === undefined)
          throw new Error("virtual time: the run waits on nothing that ends");
        timers.splice(timers.indexOf(next), 1);
        current = Math.max(current, next.due);
        next.fire();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The web provider, recorded and replayed
// ---------------------------------------------------------------------------

export type RecordingResearchProvider = PublicWebResearchProvider & {
  /** Everything recorded so far, ready to write as a fixture. */
  readonly fixture: () => RecordedResearchFixture;
};

export function createRecordingResearchProvider(input: {
  readonly provider: PublicWebResearchProvider;
  readonly clock?: (() => Date) | undefined;
  /** The run's recorded time: its schedule is kept with the fixture. */
  readonly time?: RecordingTime | undefined;
}): RecordingResearchProvider {
  const { provider, time } = input;
  const recordedAt = (input.clock ?? (() => new Date()))().toISOString();
  const searches: z.infer<typeof RecordedSearchSchema>[] = [];
  const pages = new Map<string, z.infer<typeof RecordedPageSchema>>();
  const failed = new Set<string>();
  const extractFailures: RecordedResearchFixture["extractFailures"] = [];
  const extracts: z.infer<typeof RecordedExtractSchema>[] = [];
  const tracked = <T>(label: string, work: () => Promise<T>) =>
    time === undefined ? work() : time.track(label, work);
  return {
    get code() {
      return provider.code;
    },
    ...(provider.canSearch === false ? { canSearch: false as const } : {}),
    ...(provider.canReadPages === false
      ? { canReadPages: false as const }
      : {}),
    fixture: () => ({
      version: RECORDED_FIXTURE_VERSION,
      providerCode: provider.code,
      recordedAt,
      searches: [...searches],
      pages: [...pages.values()],
      failedUrls: [...failed],
      extractFailures: [...extractFailures],
      extracts: extracts.map((one) => ({
        ...one,
        urls: [...one.urls],
        read: [...one.read],
        failedUrls: [...one.failedUrls],
      })),
      schedule: time === undefined ? null : time.schedule(),
    }),
    search: async (request, context) => {
      const key = recordedSearchKey(request);
      // Its place is kept when it begins: the order searches began in.
      const entry: z.infer<typeof RecordedSearchSchema> = {
        key,
        query: request.query,
        includeDomains: [...request.includeDomains],
        hits: [],
        failure: null,
      };
      searches.push(entry);
      try {
        const result = await tracked(searchLabel(key), () =>
          provider.search(request, context),
        );
        entry.hits = result.hits.map(copyHit);
        return result;
      } catch (error) {
        if (isResearchProviderFailure(error))
          entry.failure = { failureClass: error.failureClass };
        throw error;
      }
    },
    extract: async (request, context) => {
      const entry: z.infer<typeof RecordedExtractSchema> = {
        urls: [...request.urls],
        read: [],
        failedUrls: [],
        failure: null,
      };
      extracts.push(entry);
      // Recorded as the caller saw it (re-recorded case A, 2026-10-29): a
      // read the caller gave up on (its signal fired) is a TIMEOUT for the
      // whole request, and pages arriving after that are not kept. Keeping
      // them made the replay read pages live never did, and every later
      // request missed.
      let settled = false;
      const failWhole = (failureClass: ResearchProviderFailureClass) => {
        settled = true;
        entry.failure = { failureClass };
        extractFailures.push({ urls: [...request.urls], failureClass });
      };
      const gaveUp = () => {
        if (!settled) failWhole("TIMEOUT");
      };
      const signal = context?.signal;
      if (signal?.aborted === true) gaveUp();
      signal?.addEventListener("abort", gaveUp, { once: true });
      try {
        const result = await tracked(extractLabel(request.urls), () =>
          provider.extract(request, context),
        );
        if (settled) return result;
        settled = true;
        for (const page of result.pages) {
          entry.read.push(page.url);
          pages.set(page.url, {
            url: page.url,
            title: page.title,
            text: page.text.slice(0, PAGE_TEXT_MAX),
          });
        }
        for (const url of result.failedUrls) {
          entry.failedUrls.push(url);
          failed.add(url);
        }
        return result;
      } catch (error) {
        if (!settled && isResearchProviderFailure(error))
          failWhole(error.failureClass);
        throw error;
      } finally {
        signal?.removeEventListener("abort", gaveUp);
      }
    },
  };
}

/** A request the recording does not hold. */
export type RecordedMiss =
  | { readonly kind: "SEARCH"; readonly key: string }
  | { readonly kind: "PAGE"; readonly url: string }
  | { readonly kind: "EXTRACT"; readonly urls: readonly string[] };

export class RecordedFixtureMiss extends Error {
  readonly miss: RecordedMiss;
  constructor(miss: RecordedMiss) {
    super(
      miss.kind === "SEARCH"
        ? `Research replay: the query "${miss.key}" is not in the recorded fixture. A code change altered what is searched; re-record the case or fix the change.`
        : miss.kind === "PAGE"
          ? `Research replay: the page ${miss.url} is not in the recorded fixture. A code change altered which pages are read; re-record the case or fix the change.`
          : `Research replay: a read of ${miss.urls.join(", ")} is not in the recorded fixture. A code change altered which pages are read together; re-record the case or fix the change.`,
    );
    this.name = "RecordedFixtureMiss";
    this.miss = miss;
  }
}

export type ReplayResearchProvider = PublicWebResearchProvider & {
  /** Every search request served or missed, in order. */
  readonly searches: readonly PublicWebSearchRequest[];
  /** Requests the recording does not hold. */
  readonly misses: readonly RecordedMiss[];
};

const sameUrls = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((url, index) => url === b[index]);

export function createReplayResearchProvider(input: {
  readonly fixture: RecordedResearchFixture;
  /**
   * THROW (default, the CI gate): a miss is thrown and listed, and a page
   * read is served only as the same request was recorded. EMPTY (an eval
   * with live models, whose planner may ask anew): a miss returns nothing
   * and is listed, and pages recorded under other requests are served by
   * URL; there is never a network call either way.
   */
  readonly onMiss?: "THROW" | "EMPTY" | undefined;
  readonly code?: ResearchProviderCode | undefined;
  /** The recorded schedule's replay: answers arrive in recorded order. */
  readonly time?: ReplayTime | undefined;
}): ReplayResearchProvider {
  const fixture = RecordedResearchFixtureSchema.parse(input.fixture);
  const onMiss = input.onMiss ?? "THROW";
  const time = input.time;
  // The same query asked twice is answered in recorded order.
  const searchesByKey = new Map<string, (typeof fixture.searches)[number][]>();
  for (const search of fixture.searches) {
    const list = searchesByKey.get(search.key) ?? [];
    list.push(search);
    searchesByKey.set(search.key, list);
  }
  const searchesServed = new Map<string, number>();
  const extractsServed = new Set<number>();
  const pagesByUrl = new Map(
    fixture.pages.map((page) => [page.url, page] as const),
  );
  const failed = new Set(fixture.failedUrls);
  const sent: PublicWebSearchRequest[] = [];
  const misses: RecordedMiss[] = [];
  const code = input.code ?? fixture.providerCode;
  const failure = (failureClass: ResearchProviderFailureClass) =>
    new ResearchProviderFailure({ providerCode: code, failureClass });
  const tracked = <T>(label: string, outcome: () => Promise<T>) =>
    time === undefined ? outcome() : time.track(label, outcome);

  const searchOutcome = (
    request: PublicWebSearchRequest,
    key: string,
  ): (() => Promise<PublicWebSearchResult>) => {
    const list = searchesByKey.get(key) ?? [];
    const at = searchesServed.get(key) ?? 0;
    searchesServed.set(key, at + 1);
    const held = list[Math.min(at, list.length - 1)];
    if (held === undefined) {
      const miss = { kind: "SEARCH" as const, key };
      misses.push(miss);
      return onMiss === "THROW"
        ? () => Promise.reject(new RecordedFixtureMiss(miss))
        : () => Promise.resolve({ hits: [], latencyMs: 0 });
    }
    if (held.failure !== null) {
      const failureClass = held.failure.failureClass;
      return () => Promise.reject(failure(failureClass));
    }
    const hits = held.hits.slice(0, request.maxResults).map(copyHit);
    return () => Promise.resolve({ hits, latencyMs: 0 });
  };

  const pagesOf = (urls: readonly string[]) =>
    urls.flatMap((url) => {
      const page = pagesByUrl.get(url);
      return page === undefined
        ? []
        : [{ url: page.url, title: page.title, text: page.text }];
    });

  const extractOutcome = (
    urls: readonly string[],
  ): (() => Promise<PublicWebExtractResult>) => {
    const position = fixture.extracts.findIndex(
      (one, index) => !extractsServed.has(index) && sameUrls(one.urls, urls),
    );
    const held = fixture.extracts[position];
    if (held !== undefined) {
      extractsServed.add(position);
      if (held.failure !== null) {
        const failureClass = held.failure.failureClass;
        return () => Promise.reject(failure(failureClass));
      }
      const result = {
        pages: pagesOf(held.read),
        failedUrls: [...held.failedUrls],
        latencyMs: 0,
      };
      return () => Promise.resolve(result);
    }
    if (onMiss === "THROW") {
      const miss = { kind: "EXTRACT" as const, urls: [...urls] };
      misses.push(miss);
      return () => Promise.reject(new RecordedFixtureMiss(miss));
    }
    // EMPTY (an eval): pages recorded under other requests, by URL.
    const result: {
      pages: PublicWebExtractResult["pages"][number][];
      failedUrls: string[];
    } = { pages: [], failedUrls: [] };
    for (const url of urls) {
      const [page] = pagesOf([url]);
      if (page !== undefined) {
        result.pages.push(page);
        continue;
      }
      if (!failed.has(url)) misses.push({ kind: "PAGE", url });
      result.failedUrls.push(url);
    }
    return () => Promise.resolve({ ...result, latencyMs: 0 });
  };

  return {
    code,
    searches: sent,
    misses,
    search: (request) => {
      sent.push(request);
      const key = recordedSearchKey(request);
      return tracked(searchLabel(key), searchOutcome(request, key));
    },
    extract: (request) =>
      tracked(extractLabel(request.urls), extractOutcome(request.urls)),
  };
}
