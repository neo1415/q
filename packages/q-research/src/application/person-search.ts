import { createHash } from "node:crypto";

import {
  NO_EXTERNAL_ENTITY_IMAGE,
  type ExternalPersonSource,
  type PersonSearchResult,
} from "@capital-q/contracts/q";

import { RESEARCH_BOUNDS, type PublicWebSearchHit } from "../contracts.js";
import { composeEgressQuery } from "../domain/egress.js";
import {
  allSpellings,
  basicNameVariants,
  clarifyingQuestionFor,
  decideIdentity,
  rankCandidates,
  toCandidateView,
  type PersonCandidate,
  type PersonSpec,
  type SourcedHit,
} from "../domain/person-identity.js";
import { judgePublicUrl, publicDomainOf } from "../domain/url-safety.js";
import {
  isResearchProviderFailure,
  type PublicWebResearchProvider,
} from "../ports.js";

/**
 * The fast person-identity path (W2, 2026-10-10). A member asked Q to find
 * a named person; the answer must be an identity card or a short question
 * within seconds, not a research report minutes later.
 *
 * Three to five differently-aimed queries run in parallel across the
 * configured indexes, each under its own deadline, the whole under one
 * budget with cancellation. Results are ranked deterministically
 * (domain/person-identity.ts); a clear winner returns at once and the rest
 * of the in-flight calls are cancelled. Deeper work (reading pages,
 * building the brief) is a separate, later step and never delays the card.
 */

export const PERSON_SEARCH_BUDGET = {
  /** Each provider call's own deadline. */
  perCallMs: 3_000,
  /** The whole search, including ranking. */
  overallMs: 5_000,
  /** Queries planned for one person. */
  maxQueries: 5,
  /** Distinct hits kept per call. */
  hitsPerCall: 8,
} as const;

export type PersonQueryKind =
  | "EXACT_PLACE"
  | "NAME_ORGANISATION"
  | "NAME_ROLE"
  | "PROFILE_INDEX"
  | "VARIANT"
  | "NAME_PROFILE";

export type PlannedPersonQuery = {
  readonly kind: PersonQueryKind;
  readonly query: string;
  readonly includeDomains: readonly string[];
};

/** Trusted, ordered most-useful first; deduplicated; at most `max`. */
export function planPersonQueries(
  spec: PersonSpec,
  max: number = PERSON_SEARCH_BUDGET.maxQueries,
): readonly PlannedPersonQuery[] {
  const planned: PlannedPersonQuery[] = [];
  const seen = new Set<string>();
  const add = (
    kind: PersonQueryKind,
    parts: readonly (string | null)[],
    includeDomains: readonly string[] = [],
  ) => {
    const query = parts
      .filter((p): p is string => p !== null && p.trim().length > 0)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
    const key = `${query.toLowerCase()}|${includeDomains.join(",")}`;
    if (query.length === 0 || seen.has(key) || planned.length >= max) return;
    seen.add(key);
    planned.push({ kind, query, includeDomains });
  };
  add("EXACT_PLACE", [spec.name, spec.place]);
  add("PROFILE_INDEX", [spec.name, spec.place], ["linkedin.com"]);
  if (spec.organization !== null) {
    add("NAME_ORGANISATION", [spec.name, spec.organization]);
  }
  if (spec.role !== null) add("NAME_ROLE", [spec.name, spec.role, spec.place]);
  const variant = allSpellings(spec)[1];
  if (variant !== undefined) add("VARIANT", [variant, spec.place]);
  // The name alone on the profile index: finds a profile that states no
  // (or another) location, which the ranker then marks as unconfirmed.
  add("NAME_PROFILE", [spec.name], ["linkedin.com"]);
  return planned;
}

export type PersonSearchCommand = {
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly place?: string | null | undefined;
  readonly organization?: string | null | undefined;
  readonly role?: string | null | undefined;
  /** The member's own words; the only text a query may be built from. */
  readonly userText: string;
  readonly earlierUserText?: readonly string[] | undefined;
  /** Spellings to also look for (e.g. a transliteration the member typed). */
  readonly nameVariants?: readonly string[] | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly budget?:
    | Partial<{
        perCallMs: number;
        overallMs: number;
        maxQueries: number;
      }>
    | undefined;
};

export type PersonCallTrace = {
  readonly provider: string;
  readonly kind: PersonQueryKind;
  readonly latencyMs: number;
  readonly outcome: "OK" | "FAILED" | "TIMEOUT" | "CANCELLED";
  readonly hits: number;
  readonly failureClass: string | null;
};

export type PersonSearchRun = {
  readonly result: PersonSearchResult;
  readonly calls: readonly PersonCallTrace[];
  readonly queries: readonly PlannedPersonQuery[];
  /** The chosen candidate, with its hits, for the background enrichment. */
  readonly chosen: PersonCandidate | null;
  readonly profileKey: string | null;
  readonly spec: PersonSpec;
  readonly budgetExceeded: boolean;
};

export type PersonSearchDependencies = {
  /** The individual indexes, not a merged provider: each is timed alone. */
  readonly providers: readonly PublicWebResearchProvider[];
  readonly clock?: (() => number) | undefined;
  /** A variant source; default is the local hook until the name module lands. */
  readonly variantsOf?: ((name: string) => readonly string[]) | undefined;
};

/** A stable id per asker and person, so a repeat search finds the same record. */
export function externalPersonIdFor(
  tenantId: string,
  userId: string,
  profileKey: string,
): string {
  const hex = createHash("sha256")
    .update(
      `external-person\u0000${tenantId}\u0000${userId}\u0000${profileKey}`,
    )
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function sourceOf(
  sourced: SourcedHit,
  retrievedAt: string,
): ExternalPersonSource {
  return {
    id: null,
    description: null,
    evidenceClass: null,
    url: sourced.hit.url,
    domain: publicDomainOf(sourced.hit.url) ?? "",
    title: sourced.hit.title === null ? null : sourced.hit.title.slice(0, 300),
    publishedAt: sourced.hit.publishedAt,
    retrievedAt,
    provider: sourced.provider,
  };
}

export function sourcesOfCandidate(
  candidate: PersonCandidate,
  retrievedAt: string,
  max = 8,
): ExternalPersonSource[] {
  const seen = new Set<string>();
  const out: ExternalPersonSource[] = [];
  // The profile page first, then the rest in the order they were found.
  const ordered = [...candidate.hits].sort(
    (a, b) =>
      Number(b.hit.url === candidate.profileUrl) -
      Number(a.hit.url === candidate.profileUrl),
  );
  for (const sourced of ordered) {
    if (seen.has(sourced.hit.url)) continue;
    seen.add(sourced.hit.url);
    out.push(sourceOf(sourced, retrievedAt));
    if (out.length >= max) break;
  }
  return out;
}

class Deadline extends Error {}

/**
 * Resolves with the call's value, or rejects when the deadline passes or
 * the signal aborts, even for a provider that ignores its signal.
 */
function bounded<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent: AbortSignal,
): Promise<T> {
  const own = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      own.abort();
      reject(new Deadline("deadline"));
    }, ms);
    const onParent = () => {
      own.abort();
      clearTimeout(timer);
      reject(new Deadline("cancelled"));
    };
    if (parent.aborted) return onParent();
    parent.addEventListener("abort", onParent, { once: true });
    run(own.signal).then(
      (value) => {
        clearTimeout(timer);
        parent.removeEventListener("abort", onParent);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        parent.removeEventListener("abort", onParent);
        reject(error instanceof Error ? error : new Error("provider failed"));
      },
    );
  });
}

export function createPersonSearch(dependencies: PersonSearchDependencies): {
  readonly search: (command: PersonSearchCommand) => Promise<PersonSearchRun>;
} {
  const now = dependencies.clock ?? (() => Date.now());
  const variantsOf = dependencies.variantsOf ?? basicNameVariants;
  return {
    search: async (command) => {
      const started = now();
      const perCallMs =
        command.budget?.perCallMs ?? PERSON_SEARCH_BUDGET.perCallMs;
      const overallMs =
        command.budget?.overallMs ?? PERSON_SEARCH_BUDGET.overallMs;
      const spec: PersonSpec = {
        name: command.name.trim(),
        place: command.place?.trim() || null,
        organization: command.organization?.trim() || null,
        role: command.role?.trim() || null,
        variants: [...(command.nameVariants ?? []), ...variantsOf(command.name)]
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
          .slice(0, 6),
      };
      const providers = dependencies.providers;
      // Every query leaves through the same egress allowlist as any other
      // research: only the member's own words and their spellings of the name.
      const composed = planPersonQueries(
        spec,
        command.budget?.maxQueries ?? PERSON_SEARCH_BUDGET.maxQueries,
      ).flatMap((planned) => {
        const egress = composeEgressQuery({
          requestedQuery: planned.query,
          userText: command.userText,
          earlierUserText: [
            ...(command.earlierUserText ?? []),
            // Their spellings are the member's words transformed, not new facts.
            ...spec.variants,
            spec.name,
          ],
          publicIdentity: [],
        });
        return egress.ok
          ? [
              {
                ...planned,
                query: egress.query.slice(0, RESEARCH_BOUNDS.maxQueryChars),
              },
            ]
          : [];
      });
      const overall = new AbortController();
      const stop = () => overall.abort();
      if (command.signal?.aborted === true) stop();
      command.signal?.addEventListener("abort", stop, { once: true });
      const overallTimer = setTimeout(stop, overallMs);

      const calls: PersonCallTrace[] = [];
      const pool: SourcedHit[] = [];
      let settled = 0;
      let decided: ReturnType<typeof decideIdentity> = { kind: "NONE" };
      let early = false;
      let closed = false;
      const inflight = new Map<
        number,
        { provider: string; kind: PersonQueryKind; start: number }
      >();
      let nextCall = 0;

      // The exact query and the profile-index query go to every index; the
      // rest are spread round-robin so five queries do not cost five x n calls.
      const assignments: {
        planned: (typeof composed)[number];
        provider: PublicWebResearchProvider;
      }[] = [];
      composed.forEach((planned, index) => {
        const everywhere =
          planned.kind === "EXACT_PLACE" || planned.kind === "PROFILE_INDEX";
        if (everywhere) {
          for (const provider of providers) {
            assignments.push({ planned, provider });
          }
        } else {
          const provider = providers[index % Math.max(providers.length, 1)];
          if (provider !== undefined) assignments.push({ planned, provider });
        }
      });

      const reevaluate = (): boolean => {
        decided = decideIdentity(spec, rankCandidates(spec, pool));
        // Early exit only on a clear winner confirmed by two settled calls:
        // one fast index must not hide a namesake the slower one is about to show.
        return (
          decided.kind === "MATCHED" &&
          decided.chosen.confidence === "STRONG" &&
          decided.chosen.profileUrl !== null &&
          settled >= 2
        );
      };

      await new Promise<void>((resolve) => {
        let pending = assignments.length;
        if (pending === 0) return resolve();
        const finish = () => {
          pending -= 1;
          if (pending === 0) resolve();
        };
        overall.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
        for (const { planned, provider } of assignments) {
          const callStart = now();
          const callId = nextCall++;
          inflight.set(callId, {
            provider: provider.code,
            kind: planned.kind,
            start: callStart,
          });
          bounded(
            (signal) =>
              provider.search(
                {
                  query: planned.query,
                  maxResults: RESEARCH_BOUNDS.maxSearchResults,
                  freshness: "ANY",
                  includeDomains: [...planned.includeDomains],
                },
                { signal },
              ),
            perCallMs,
            overall.signal,
          ).then(
            (result) => {
              if (closed) return;
              inflight.delete(callId);
              calls.push({
                provider: provider.code,
                kind: planned.kind,
                latencyMs: now() - callStart,
                outcome: "OK",
                hits: result.hits.length,
                failureClass: null,
              });
              settled += 1;
              const kept: PublicWebSearchHit[] = result.hits
                .filter((hit) => judgePublicUrl(hit.url).ok)
                .slice(0, PERSON_SEARCH_BUDGET.hitsPerCall);
              for (const hit of kept)
                pool.push({ provider: provider.code, hit });
              if (!early && reevaluate()) {
                early = true;
                resolve();
                stop();
              }
              finish();
            },
            (error: unknown) => {
              if (closed) return;
              inflight.delete(callId);
              const cancelled =
                error instanceof Deadline && error.message === "cancelled";
              calls.push({
                provider: provider.code,
                kind: planned.kind,
                latencyMs: now() - callStart,
                outcome: cancelled
                  ? "CANCELLED"
                  : error instanceof Deadline
                    ? "TIMEOUT"
                    : "FAILED",
                hits: 0,
                failureClass: isResearchProviderFailure(error)
                  ? error.failureClass
                  : null,
              });
              settled += 1;
              finish();
            },
          );
        }
      });
      clearTimeout(overallTimer);
      closed = true;
      // Calls still in flight are cancelled (winner found) or cut off (budget spent).
      for (const call of inflight.values()) {
        calls.push({
          provider: call.provider,
          kind: call.kind,
          latencyMs: now() - call.start,
          outcome: early ? "CANCELLED" : "TIMEOUT",
          hits: 0,
          failureClass: null,
        });
      }
      command.signal?.removeEventListener("abort", stop);
      const budgetExceeded = !early && overall.signal.aborted;
      overall.abort();
      // Whatever arrived inside the budget is judged; late results are not awaited.
      decided = decideIdentity(spec, rankCandidates(spec, pool));

      const retrievedAt = new Date().toISOString();
      const elapsedMs = Math.max(0, now() - started);
      const anyOk = calls.some((c) => c.outcome === "OK");
      let result: PersonSearchResult;
      let chosen: PersonCandidate | null = null;
      if (decided.kind === "MATCHED" && decided.chosen.hits.length > 0) {
        chosen = decided.chosen;
        const profileKey = chosen.key;
        const sources = sourcesOfCandidate(chosen, retrievedAt);
        result = {
          outcome: "MATCHED",
          card: {
            entityKind: "PERSON",
            subject: {
              entityKind: "PERSON",
              researchStatus: "RESEARCHED",
              requiresRefresh: false,
              image: NO_EXTERNAL_ENTITY_IMAGE,
              quotes: [],
              externalPersonId: externalPersonIdFor(
                command.tenantId,
                command.userId,
                profileKey,
              ),
              displayName: chosen.displayName.slice(0, 200),
              nameVariants: allSpellings(spec).slice(0, 12),
              profileUrl: chosen.profileUrl,
              role: chosen.role,
              organization: chosen.organization,
              location: chosen.location,
              evidenceBundleId: null,
              briefVersion: 0,
              confidence: chosen.confidence,
            },
            sources,
            uncertainty: [...decided.uncertainty],
            enriching: true,
            actions: ["RESEARCH_FURTHER", "REHEARSE"],
          },
          candidates: decided.others.map(toCandidateView),
          clarifyingQuestion: null,
          elapsedMs,
        };
      } else if (decided.kind === "AMBIGUOUS") {
        result = {
          outcome: "AMBIGUOUS",
          card: null,
          candidates: decided.candidates.map(toCandidateView),
          clarifyingQuestion: clarifyingQuestionFor(spec, decided.candidates),
          elapsedMs,
        };
      } else {
        result = {
          outcome: anyOk ? "NOT_FOUND" : "UNAVAILABLE",
          card: null,
          candidates: [],
          clarifyingQuestion: null,
          elapsedMs,
        };
      }
      return {
        result,
        calls: [...calls],
        queries: composed,
        chosen,
        profileKey: chosen?.key ?? null,
        spec,
        budgetExceeded,
      };
    },
  };
}
