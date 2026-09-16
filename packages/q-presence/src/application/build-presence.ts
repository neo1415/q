import type { CorrelationId } from "@capital-q/contracts";
import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  PRESENCE_BOUNDS,
  PRESENCE_BUILD_STALE_AFTER_MS,
  PRESENCE_REFRESH_AFTER_MS,
  PresenceIdentitySchema,
  PresenceSubjectSchema,
  type PresenceIdentity,
  type PresenceOutcome,
  type PresenceSubject,
} from "../contracts.js";
import { distinctiveTerms, pageNamesSubject } from "../domain/subject-match.js";
import type {
  PresenceBuildLog,
  PresenceEvidencePort,
  PresenceKnowledgePort,
  PresenceReaderPort,
  PresenceReadPort,
  PresenceSource,
} from "../ports.js";

/**
 * Build a subject's public presence (CQ-Q-PRESENCE-001).
 *
 * The order is the packet:
 *
 *   due? → read the public web (in parallel) → record each page as
 *   evidence → a model reads the bounded excerpts → each understanding it
 *   proposes goes through the Knowledge Write Gate → log what happened
 *
 * Every step after the read is per-source and independent, so one page
 * that cannot be recorded costs that page. The build itself is best
 * effort by design: it runs while a person is talking to Q and must never
 * be able to fail their conversation, which is why the only thing it
 * returns is an outcome and the only thing it throws is nothing.
 */

export type BuildPresenceDependencies = {
  readonly web: PresenceReadPort;
  readonly evidence: PresenceEvidencePort;
  readonly reader: PresenceReaderPort;
  readonly knowledge: PresenceKnowledgePort;
  readonly log: PresenceBuildLog;
  readonly clock?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
};

export type BuildPresenceCommand = {
  readonly actor: ActorContext;
  readonly subject: PresenceSubject;
  readonly identity: PresenceIdentity;
  readonly correlationId: CorrelationId;
  /** Read again even when a recent build exists ("refresh what you know about me"). */
  readonly force?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type PresenceService = {
  readonly build: (command: BuildPresenceCommand) => Promise<PresenceOutcome>;
  /** Whether a build would do anything right now, without doing it. */
  readonly isDue: (
    actor: ActorContext,
    subject: PresenceSubject,
  ) => Promise<boolean>;
};

function dedupeByUrl(
  sources: readonly PresenceSource[],
): readonly PresenceSource[] {
  const seen = new Set<string>();
  const kept: PresenceSource[] = [];
  for (const source of sources) {
    const key = source.url.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    kept.push(source);
    if (kept.length >= PRESENCE_BOUNDS.maxSourcesTotal) break;
  }
  return kept;
}

export function createPresenceService(
  dependencies: BuildPresenceDependencies,
): PresenceService {
  const { web, evidence, reader, knowledge, log, logger } = dependencies;
  const clock = dependencies.clock ?? Date.now;
  const meter = getMeter("@capital-q/q-presence");
  const metrics = {
    builds: meter.createCounter("q.presence.builds"),
    sources: meter.createCounter("q.presence.sources_recorded"),
    understandings: meter.createCounter("q.presence.understandings_accepted"),
    duration: meter.createHistogram("q.presence.build_duration_ms"),
  };

  const dueDecision = async (
    actor: ActorContext,
    subject: PresenceSubject,
    force: boolean,
  ): Promise<PresenceOutcome | null> => {
    const latest = await log.latest(actor, subject);
    if (latest === null) return null;
    const startedAt = Date.parse(latest.startedAt);
    const age = Number.isNaN(startedAt) ? Infinity : clock() - startedAt;
    if (latest.status === "RUNNING" && age < PRESENCE_BUILD_STALE_AFTER_MS) {
      // Another turn already started one. Two reads of the same pages is
      // quota spent to reach the same understandings.
      return { status: "SKIPPED", reason: "IN_PROGRESS" };
    }
    if (force) return null;
    if (
      (latest.status === "COMPLETED" || latest.status === "NOTHING_FOUND") &&
      age < PRESENCE_REFRESH_AFTER_MS
    ) {
      return { status: "SKIPPED", reason: "RECENT" };
    }
    return null;
  };

  return {
    isDue: async (actor, subject) =>
      (await dueDecision(actor, subject, false)) === null,

    build: async (command): Promise<PresenceOutcome> => {
      const subject = PresenceSubjectSchema.safeParse(command.subject);
      const identity = PresenceIdentitySchema.safeParse(command.identity);
      if (!subject.success || !identity.success) {
        return { status: "SKIPPED", reason: "NOT_CONFIGURED" };
      }
      const { actor, correlationId } = command;
      const skip = await dueDecision(
        actor,
        subject.data,
        command.force === true,
      );
      if (skip !== null) return skip;

      const startedAt = clock();
      const started = await log.start(actor, subject.data, correlationId);
      const buildId = started.id;
      let sourceCount = 0;
      let understandingCount = 0;

      try {
        // ---- 1. the public web, every read at once ---------------------
        const read = dedupeByUrl(
          await web.read({
            actor,
            correlationId,
            subject: subject.data,
            identity: identity.data,
            ...(command.signal === undefined ? {} : { signal: command.signal }),
          }),
        );
        // ---- 1b. and only the pages that name them ----------------------
        // A search for an uncommon name returns strangers, and a model
        // asked what a page says will faithfully report a stranger's page.
        // Nothing that fails to name the subject reaches evidence, a model
        // or the gate (see domain/subject-match.ts).
        const terms = distinctiveTerms(identity.data);
        const found = read.filter((page) => pageNamesSubject(terms, page));
        if (found.length < read.length) {
          logger?.info(
            {
              correlationId,
              subjectType: subject.data.subjectType,
              read: read.length,
              kept: found.length,
            },
            "public pages that do not name the subject were dropped",
          );
        }
        if (found.length === 0) {
          await log.finish(actor, {
            buildId,
            status: "NOTHING_FOUND",
            sourceCount: 0,
            understandingCount: 0,
            failureCode: null,
          });
          metrics.builds.add(1, {
            subject_type: subject.data.subjectType,
            status: "NOTHING_FOUND",
          });
          return { status: "NOTHING_FOUND", buildId };
        }

        // ---- 2. each page recorded, independently -----------------------
        const recorded: {
          readonly index: number;
          readonly source: PresenceSource;
          readonly sourceId: string;
          readonly itemId: string;
        }[] = [];
        const registrations = await Promise.allSettled(
          found.map(async (source) => {
            const registered = await evidence.registerSource(
              actor,
              {
                subject: subject.data,
                provider: source.provider,
                title: source.title,
                sourceUrl: source.url,
                retrievedAt: source.retrievedAt,
                publishedAt: source.publishedAt,
              },
              correlationId,
            );
            const item = await evidence.createItem(
              actor,
              {
                sourceId: registered.id,
                summary: source.excerpt.slice(
                  0,
                  PRESENCE_BOUNDS.maxExcerptChars,
                ),
              },
              correlationId,
            );
            return { sourceId: registered.id, itemId: item.id, source };
          }),
        );
        for (const [index, outcome] of registrations.entries()) {
          if (outcome.status !== "fulfilled") {
            logger?.warn(
              { correlationId, subjectType: subject.data.subjectType },
              "a public page could not be recorded as evidence",
            );
            continue;
          }
          recorded.push({ index, ...outcome.value });
        }
        sourceCount = recorded.length;
        metrics.sources.add(sourceCount, {
          subject_type: subject.data.subjectType,
        });
        if (recorded.length === 0) {
          await log.finish(actor, {
            buildId,
            status: "FAILED",
            sourceCount: 0,
            understandingCount: 0,
            failureCode: "EVIDENCE_UNAVAILABLE",
          });
          return {
            status: "FAILED",
            buildId,
            failureCode: "EVIDENCE_UNAVAILABLE",
          };
        }

        // ---- 3. a model reads them; it proposes, it never persists ------
        const proposals = await reader.read({
          actor,
          correlationId,
          subjectType: subject.data.subjectType,
          identity: identity.data,
          sources: recorded.map((entry, position) => ({
            index: position,
            url: entry.source.url,
            title: entry.source.title,
            excerpt: entry.source.excerpt.slice(
              0,
              PRESENCE_BOUNDS.maxExcerptChars,
            ),
          })),
          ...(command.signal === undefined ? {} : { signal: command.signal }),
        });

        // ---- 4. the Write Gate decides what is held ---------------------
        for (const proposal of proposals.slice(
          0,
          PRESENCE_BOUNDS.maxUnderstandings,
        )) {
          // A proposal with no citation rests on nothing: the gate would
          // refuse it, and asking is a round trip for a known answer.
          const cited = proposal.sourceIndexes
            .map((position) => recorded[position])
            .filter((entry): entry is (typeof recorded)[number] => {
              return entry !== undefined;
            });
          if (cited.length === 0) continue;
          try {
            const result = await knowledge.propose(
              actor,
              {
                subject: subject.data,
                key: proposal.key,
                statement: proposal.statement,
                supportingSourceIds: cited.map((entry) => entry.sourceId),
                supportingEvidenceItemIds: cited.map((entry) => entry.itemId),
              },
              correlationId,
            );
            if (result.accepted) understandingCount += 1;
          } catch (error: unknown) {
            logger?.warn(
              { err: error, correlationId, key: proposal.key },
              "a presence understanding was not accepted",
            );
          }
        }
        metrics.understandings.add(understandingCount, {
          subject_type: subject.data.subjectType,
        });

        await log.finish(actor, {
          buildId,
          status: "COMPLETED",
          sourceCount,
          understandingCount,
          failureCode: null,
        });
        metrics.builds.add(1, {
          subject_type: subject.data.subjectType,
          status: "COMPLETED",
        });
        metrics.duration.record(clock() - startedAt, {
          subject_type: subject.data.subjectType,
        });
        return {
          status: "COMPLETED",
          buildId,
          sourceCount,
          understandingCount,
        };
      } catch (error: unknown) {
        // Identifiers and a code. Never the query, the page or the model's
        // words: this line is read in a log that is not the person's.
        logger?.warn(
          {
            err: error,
            correlationId,
            subjectType: subject.data.subjectType,
            buildId,
          },
          "presence build did not finish",
        );
        const failureCode =
          command.signal?.aborted === true ? "CANCELLED" : "READ_FAILED";
        try {
          await log.finish(actor, {
            buildId,
            status: "FAILED",
            sourceCount,
            understandingCount,
            failureCode,
          });
        } catch {
          // The log is the last thing standing; losing it costs a refresh.
        }
        metrics.builds.add(1, {
          subject_type: subject.data.subjectType,
          status: "FAILED",
        });
        return { status: "FAILED", buildId, failureCode };
      }
    },
  };
}
