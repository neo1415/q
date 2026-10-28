import {
  Q_SITUATION_FACTS_MAX,
  Q_SITUATION_FACTS_PER_SECTION_MAX,
  Q_SITUATION_FORBIDDEN_LABELS,
  Q_SITUATION_SOURCES,
  Q_SITUATION_SOURCES_BY_SIDE,
  Q_SITUATION_TOPICS_MAX,
  Q_SITUATION_VERSION,
  QSituationDossierSchema,
  type EvidenceStatus,
  type QSituationDossier,
  type QSituationSection,
  type QSituationSide,
  type QSituationSource,
  type QSituationUnavailableReason,
  type TruthClass,
} from "@capital-q/contracts";
import { withRoundTripPhase } from "@capital-q/database";
import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolPort,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

import {
  SITUATION_SOURCE_SPECS,
  type SituationRawFact,
  type SituationRead,
  type SituationSubject,
} from "./sources.js";

/**
 * Situation-first planning, S2 (PLANNING-DESIGN.md B1, addendum 4): the
 * person's situation, assembled by code before anything is planned.
 *
 *  - Every read is a typed Q tool run through the tool port AS THE ASKER
 *    (the same validate -> authorise -> execute path chat uses; never a
 *    service-role read). A founder's dossier never runs an investor read
 *    and vice versa; labels the other side may not hold are dropped before
 *    the contract (which rejects them again) is applied.
 *  - All sources run at once. Each read has its own cap (1.5 s) and the
 *    whole dossier one more (3 s); a source that is late, denied or fails
 *    is UNAVAILABLE -- not known, never "none", never zero.
 *  - One tool call per distinct read: sources that share a read (the
 *    relationships list answers relationships, messages and feed
 *    decisions) share one call. Each source's round trips are labelled
 *    `situation.<SOURCE>` on the run's round-trip counter.
 *  - The ask-independent sections are cached per actor for a short window;
 *    `invalidate(actor)` drops them (lane C wires domain events to it), and
 *    `refresh` re-reads only the sections an event touched.
 *  - Public research is a separate, bounded step (`research`) so it can
 *    run beside the next stage; it sees only public-safe topics.
 */

export const SITUATION_READ_TIMEOUT_MS = 1_500;
export const SITUATION_DOSSIER_TIMEOUT_MS = 3_000;
export const SITUATION_CACHE_MS = 3 * 60_000;
export const SITUATION_RESEARCH_TIMEOUT_MS = 25_000;

/** One remembered thing about the person, as their memory read words it. */
export type SituationMemoryPort = (input: {
  readonly actor: ActorContext;
  readonly runId: string;
  readonly ask: string;
  readonly signal: AbortSignal;
}) => Promise<readonly string[]>;

/**
 * Addendum 2: what the person did recently, from their own domain events
 * and audit, read as them and worded by code. Lane C composes it.
 */
export type SituationActivityItem = {
  readonly at: string;
  readonly what: string;
  readonly record: {
    readonly kind:
      | "COMPANY"
      | "INVESTOR_ORGANISATION"
      | "RELATIONSHIP"
      | "DOCUMENT"
      | "MEETING";
    readonly id: string;
  } | null;
};
export type SituationActivityPort = (input: {
  readonly actor: ActorContext;
  readonly signal: AbortSignal;
}) => Promise<readonly SituationActivityItem[]>;

/** A public finding the research step admitted, with its page. */
export type SituationPublicFinding = {
  readonly statement: string;
  readonly url: string;
  readonly publishedOn: string | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
};

/**
 * The bounded research hook (interface only; lane C wires deep research
 * with its own search budget). It receives public-safe topics and the ask,
 * never a dossier fact.
 */
export type SituationResearchHook = (input: {
  readonly side: QSituationSide;
  readonly topics: readonly string[];
  readonly ask: string;
  readonly journey: string | null;
  readonly signal: AbortSignal;
}) => Promise<readonly SituationPublicFinding[]>;

/** Public-safe fields only (own-subject.ts): never figures, claims or documents. */
export type SituationPublicProfile = {
  readonly name?: string | undefined;
  readonly country?: string | undefined;
  readonly sectors?: readonly string[] | undefined;
};

export type SituationRequest = {
  /** The asker's own run context: every read is authorised as them. */
  readonly context: QToolExecutionContext;
  readonly subject: SituationSubject;
  /** The person's ask, in their words (memory recall reads it). */
  readonly ask: string;
  /** What journey the ask is part of (e.g. a raise), when known. */
  readonly journey?: string | null | undefined;
  readonly publicProfile?: SituationPublicProfile | undefined;
  /** Re-read only these sections; the rest may come from the cache. */
  readonly refresh?: readonly QSituationSource[] | undefined;
};

export type SituationAssemblerPorts = {
  readonly tools: QToolPort;
  readonly memory?: SituationMemoryPort | undefined;
  readonly activity?: SituationActivityPort | undefined;
};

export type SituationAssemblerOptions = {
  readonly readTimeoutMs?: number;
  readonly dossierTimeoutMs?: number;
  readonly cacheMs?: number;
  readonly now?: () => Date;
};

export type SituationAssembler = {
  readonly assemble: (request: SituationRequest) => Promise<QSituationDossier>;
  /** Adds the PUBLIC section from the research hook (bounded, may be slow). */
  readonly research: (
    dossier: QSituationDossier,
    input: {
      readonly hook: SituationResearchHook;
      readonly ask: string;
      readonly journey?: string | null | undefined;
      readonly signal?: AbortSignal | undefined;
      readonly timeoutMs?: number | undefined;
    },
  ) => Promise<QSituationDossier>;
  /** Drops every cached section of this person (any organisation, any side). */
  readonly invalidate: (
    actor: Pick<ActorContext, "tenantId" | "userId">,
  ) => void;
  /**
   * S6 (lane C, additive): drops every cached section of everyone in this
   * tenant -- a domain event of the tenant may touch any of their records.
   */
  readonly invalidateTenant?: ((tenantId: string) => void) | undefined;
};

type SectionResult = {
  readonly status: QSituationSection["status"];
  readonly reason: QSituationUnavailableReason | null;
  readonly facts: readonly SituationRawFact[];
};

const unavailable = (reason: QSituationUnavailableReason): SectionResult => ({
  status: "UNAVAILABLE",
  reason,
  facts: [],
});

const TIMED_OUT = Symbol("timed out");

/** Resolves with TIMED_OUT after `ms`, or when `signal` aborts. */
function deadline(ms: number, signal: AbortSignal): Promise<typeof TIMED_OUT> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(TIMED_OUT);
      return;
    }
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(TIMED_OUT);
      },
      { once: true },
    );
  });
}

type ReadOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: QSituationUnavailableReason };

function outcomeOf(outcome: QToolCallOutcome): ReadOutcome {
  if (outcome.status === "SUCCEEDED" && outcome.result.ok) {
    return { ok: true, data: outcome.result.data };
  }
  if (outcome.toolName === null) return { ok: false, reason: "NOT_OFFERED" };
  return {
    ok: false,
    reason: outcome.status === "DENIED" ? "NOT_PERMITTED" : "FAILED",
  };
}

const actorPrefix = (actor: Pick<ActorContext, "tenantId" | "userId">) =>
  `${actor.tenantId}\u0000${actor.userId}\u0000`;

function cacheKeyOf(actor: ActorContext, subject: SituationSubject): string {
  const subjectId =
    subject.side === "FOUNDER"
      ? subject.companyId
      : subject.investorOrganisationId;
  return `${actorPrefix(actor)}${actor.organisationId ?? "-"}\u0000${subject.side}\u0000${subjectId}`;
}

/** Sections that depend on the ask (or are cheap and personal) are never cached. */
const UNCACHED: ReadonlySet<QSituationSource> = new Set(["MEMORY", "PUBLIC"]);

/** Public-safe topics for research: sector by country, then the name. */
export function situationTopics(
  profile: SituationPublicProfile | undefined,
): string[] {
  if (profile === undefined) return [];
  const clean = (text: string | undefined) =>
    text?.trim().replace(/\s+/gu, " ") ?? "";
  const country = clean(profile.country);
  const topics: string[] = [];
  for (const sector of profile.sectors ?? []) {
    const topic = clean(`${clean(sector)} ${country}`);
    if (topic.length >= 2) topics.push(topic.slice(0, 120));
  }
  const name = clean(profile.name);
  if (name.length >= 2) topics.push(name.slice(0, 120));
  return [...new Set(topics)].slice(0, Q_SITUATION_TOPICS_MAX);
}

export function createSituationAssembler(
  ports: SituationAssemblerPorts,
  options: SituationAssemblerOptions = {},
): SituationAssembler {
  const readTimeoutMs = options.readTimeoutMs ?? SITUATION_READ_TIMEOUT_MS;
  const dossierTimeoutMs =
    options.dossierTimeoutMs ?? SITUATION_DOSSIER_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? SITUATION_CACHE_MS;
  const now = options.now ?? (() => new Date());
  const cache = new Map<
    string,
    {
      readonly at: number;
      readonly sections: ReadonlyMap<QSituationSource, SectionResult>;
    }
  >();

  async function assemble(
    request: SituationRequest,
  ): Promise<QSituationDossier> {
    const { context, subject } = request;
    const side = subject.side;
    const allowed = new Set<QSituationSource>(
      Q_SITUATION_SOURCES_BY_SIDE[side],
    );
    const key = cacheKeyOf(context.actor, subject);
    const started = now().getTime();
    const cached = cache.get(key);
    const fresh =
      cached !== undefined && started - cached.at < cacheMs
        ? cached.sections
        : null;
    const refresh = new Set(request.refresh ?? []);

    // One abort for the whole dossier: its cap, or the caller's own signal.
    const whole = new AbortController();
    const wholeTimer = setTimeout(() => whole.abort(), dossierTimeoutMs);
    const parentSignal = context.signal;
    const onParentAbort = () => whole.abort();
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    // Each distinct read runs once, with its own cap, as the asker.
    const reads = new Map<string, Promise<ReadOutcome>>();
    const runRead = (
      read: SituationRead,
      source: QSituationSource,
    ): Promise<ReadOutcome> => {
      const existing = reads.get(read.key);
      if (existing !== undefined) return existing;
      const own = new AbortController();
      const signal = AbortSignal.any([own.signal, whole.signal]);
      const call = withRoundTripPhase(`situation.${source}`, () =>
        ports.tools.execute(
          {
            callId: `situation-${read.key}`,
            name: read.tool,
            arguments: read.args,
          },
          { ...context, signal },
        ),
      ).then(outcomeOf, (): ReadOutcome => ({ ok: false, reason: "FAILED" }));
      const result = Promise.race([call, deadline(readTimeoutMs, signal)]).then(
        (outcome): ReadOutcome => {
          if (outcome === TIMED_OUT) {
            own.abort();
            return { ok: false, reason: "TIMED_OUT" };
          }
          return outcome;
        },
      );
      reads.set(read.key, result);
      return result;
    };

    const readSection = async (
      source: QSituationSource,
    ): Promise<SectionResult> => {
      if (!allowed.has(source)) {
        return { status: "NOT_APPLICABLE", reason: null, facts: [] };
      }
      if (!UNCACHED.has(source) && !refresh.has(source)) {
        const hit = fresh?.get(source);
        if (hit !== undefined) return hit;
      }
      if (source === "MEMORY") return readMemory(request, whole.signal);
      if (source === "ACTIVITY") return readActivity(request, whole.signal);
      if (source === "PUBLIC") {
        // Filled by `research`, a separate bounded step.
        return unavailable("NOT_OFFERED");
      }
      const spec = SITUATION_SOURCE_SPECS.find(
        (entry) => entry.source === source,
      );
      if (spec === undefined) return unavailable("NOT_OFFERED");
      const planned = spec.reads(subject);
      if (planned.length === 0) return unavailable("NOT_OFFERED");
      const outcomes = await Promise.all(
        planned.map((read) => runRead(read, source)),
      );
      const answered = outcomes.filter((outcome) => outcome.ok);
      if (answered.length === 0) {
        const first = outcomes.find((outcome) => !outcome.ok);
        return unavailable(
          first !== undefined && !first.ok ? first.reason : "FAILED",
        );
      }
      const facts = spec.format(
        outcomes.map((outcome) => (outcome.ok ? outcome.data : undefined)),
        side,
      );
      return facts === null
        ? unavailable("FAILED")
        : { status: "READ", reason: null, facts };
    };

    const sources = Q_SITUATION_SOURCES;
    const settled = await Promise.all(
      sources.map((source) =>
        Promise.race([
          readSection(source),
          deadline(dossierTimeoutMs, whole.signal),
        ]).then(
          (result): SectionResult =>
            result === TIMED_OUT ? unavailable("TIMED_OUT") : result,
          (): SectionResult => unavailable("FAILED"),
        ),
      ),
    );
    clearTimeout(wholeTimer);
    parentSignal?.removeEventListener("abort", onParentAbort);
    whole.abort();

    const results = new Map<QSituationSource, SectionResult>();
    sources.forEach((source, index) => {
      const result = settled[index];
      if (result !== undefined) results.set(source, result);
    });

    // Only what was read is cached; an unknown is asked again next time.
    const keep = new Map<QSituationSource, SectionResult>();
    for (const [source, result] of results) {
      if (result.status === "READ" && !UNCACHED.has(source))
        keep.set(source, result);
    }
    cache.set(key, {
      at: fresh === null ? started : (cached?.at ?? started),
      sections: keep,
    });

    return build(side, results, situationTopics(request.publicProfile), now());
  }

  async function readMemory(
    request: SituationRequest,
    signal: AbortSignal,
  ): Promise<SectionResult> {
    const port = ports.memory;
    if (port === undefined) return unavailable("NOT_OFFERED");
    const lines = await withRoundTripPhase("situation.MEMORY", () =>
      port({
        actor: request.context.actor,
        runId: request.context.runId,
        ask: request.ask,
        signal,
      }),
    ).catch(() => null);
    if (lines === null) return unavailable("FAILED");
    return {
      status: "READ",
      reason: null,
      facts: lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => ({
          statement: `Remembered: ${line.slice(0, 980)}`,
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          label: "personal_private",
          category: "PERSONAL_CONTEXT",
          asOf: null,
          provenance: { tool: "memory_recall", record: null, url: null },
        })),
    };
  }

  async function readActivity(
    request: SituationRequest,
    signal: AbortSignal,
  ): Promise<SectionResult> {
    const port = ports.activity;
    if (port === undefined) return unavailable("NOT_OFFERED");
    const items = await withRoundTripPhase("situation.ACTIVITY", () =>
      port({ actor: request.context.actor, signal }),
    ).catch(() => null);
    if (items === null) return unavailable("FAILED");
    return {
      status: "READ",
      reason: null,
      facts: [...items]
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((item) => ({
          statement: `You ${item.what.trim().slice(0, 960)}`,
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
          label: "personal_private",
          category: null,
          asOf: Number.isNaN(Date.parse(item.at))
            ? null
            : new Date(item.at).toISOString(),
          provenance: { tool: "my_activity", record: item.record, url: null },
        })),
    };
  }

  async function research(
    dossier: QSituationDossier,
    input: Parameters<SituationAssembler["research"]>[1],
  ): Promise<QSituationDossier> {
    const own = new AbortController();
    const signal =
      input.signal === undefined
        ? own.signal
        : AbortSignal.any([own.signal, input.signal]);
    const result = await Promise.race([
      input
        .hook({
          side: dossier.side,
          topics: dossier.publicTopics,
          ask: input.ask,
          journey: input.journey ?? null,
          signal,
        })
        .catch(() => null),
      deadline(input.timeoutMs ?? SITUATION_RESEARCH_TIMEOUT_MS, signal),
    ]);
    own.abort();
    const section: SectionResult =
      result === TIMED_OUT
        ? unavailable("TIMED_OUT")
        : result === null
          ? unavailable("FAILED")
          : {
              status: "READ",
              reason: null,
              facts: result.flatMap((finding) => {
                const url = safeUrl(finding.url);
                return url === null
                  ? []
                  : [
                      {
                        statement: finding.statement.trim().slice(0, 1_000),
                        truthClass: finding.truthClass,
                        evidenceStatus: finding.evidenceStatus,
                        label: "public_external" as const,
                        category: null,
                        asOf: dayOrNull(finding.publishedOn),
                        provenance: {
                          tool: "research_public_web",
                          record: {
                            kind: "PUBLIC_PAGE" as const,
                            id: new URL(url).hostname,
                          },
                          url,
                        },
                      },
                    ];
              }),
            };
    const results = new Map<QSituationSource, SectionResult>();
    for (const existing of dossier.sections) {
      results.set(existing.source, {
        status: existing.status,
        reason: existing.reason,
        facts: existing.facts.map(({ ref: _ref, ...rest }) => rest),
      });
    }
    results.set("PUBLIC", section);
    return build(
      dossier.side,
      results,
      dossier.publicTopics,
      new Date(dossier.asOf),
    );
  }

  return {
    assemble,
    research,
    invalidate: (actor) => {
      const prefix = actorPrefix(actor);
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    },
    invalidateTenant: (tenantId) => {
      const prefix = `${tenantId}\u0000`;
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    },
  };
}

function dayOrNull(raw: string | null): string | null {
  if (raw === null) return null;
  const match = /^\d{4}-\d{2}-\d{2}/u.exec(raw);
  return match === null ? null : match[0];
}

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * The dossier, in the catalogue's source order: facts labelled F1.. in
 * that order, bounded per section and in total (the largest sections give
 * way first), the other side's private labels dropped, and the contract
 * applied.
 */
function build(
  side: QSituationSide,
  results: ReadonlyMap<QSituationSource, SectionResult>,
  topics: readonly string[],
  at: Date,
): QSituationDossier {
  const forbidden = new Set<string>(Q_SITUATION_FORBIDDEN_LABELS[side]);
  const kept = Q_SITUATION_SOURCES.map((source) => {
    const result = results.get(source) ?? unavailable("NOT_OFFERED");
    const allowedFacts = result.facts.filter(
      (fact) => !forbidden.has(fact.label),
    );
    return {
      source,
      result,
      facts: allowedFacts.slice(0, Q_SITUATION_FACTS_PER_SECTION_MAX),
      truncated: allowedFacts.length > Q_SITUATION_FACTS_PER_SECTION_MAX,
    };
  });
  let total = kept.reduce((sum, entry) => sum + entry.facts.length, 0);
  while (total > Q_SITUATION_FACTS_MAX) {
    const largest = kept.reduce((a, b) =>
      b.facts.length > a.facts.length ? b : a,
    );
    largest.facts = largest.facts.slice(0, -1);
    largest.truncated = true;
    total -= 1;
  }
  let next = 1;
  const sections: QSituationSection[] = kept.map((entry) => ({
    source: entry.source,
    status: entry.result.status,
    reason:
      entry.result.status === "UNAVAILABLE"
        ? (entry.result.reason ?? "FAILED")
        : null,
    facts:
      entry.result.status === "READ"
        ? entry.facts.map((fact) => ({ ref: `F${String(next++)}`, ...fact }))
        : [],
    truncated: entry.result.status === "READ" && entry.truncated,
  }));
  return QSituationDossierSchema.parse({
    version: Q_SITUATION_VERSION,
    side,
    asOf: at.toISOString(),
    sections,
    unknowns: sections
      .filter((section) => section.status === "UNAVAILABLE")
      .map((section) => section.source),
    publicTopics: [...topics],
  });
}
