import {
  FOUNDER_JOURNEY_TYPE,
  FOUNDER_STEPS,
} from "@capital-q/founder-onboarding";
import {
  INVESTOR_JOURNEY_TYPE,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type {
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingSuggestionRepository,
} from "@capital-q/onboarding";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  presenceCandidates,
  type PresenceService,
} from "@capital-q/q-presence";

/**
 * Public presence, dispatched off a typed onboarding turn (CQ-C2).
 *
 * `q-presence` was only ever called from the voice turn
 * (`apps/q-api/src/voice/presence-trigger.ts`), because that was the one
 * place with a live request to run a detached read from. A person typing
 * the same answer into the same step got no research at all — not a worse
 * version of it, none. `onboarding.response.committed` is written to the
 * outbox on every committed response regardless of channel (CQ-PRE-REC-001
 * already reads it here for the founder and mandate reviews), so hanging
 * the same detached read off the same event closes that gap without
 * touching the voice path or the interviewer at all.
 *
 * What it does with a finding is not the ad hoc "offer a profile field"
 * mechanism the voice trigger uses for a company's short description.
 * `presenceCandidates()` (packages/q-presence/src/domain/candidates.ts) is
 * the shared, pure mapping from a finding to a pending ONBOARDING
 * suggestion — the same mechanism a person's own sentence goes through —
 * so what Q found sits next to what Q asked, is confirmed the same way,
 * and never becomes authoritative until it is.
 *
 * Three things this keeps, deliberately:
 *
 * Detached and best effort. It runs off the worker's own domain-event
 * consumer, itself already asynchronous with respect to the turn that
 * produced the response. Nothing here is awaited by a caller; nothing it
 * throws escapes `onResponseCommitted`; a failed or slow research run costs
 * itself, never the event consumer, and never causes a redelivery.
 *
 * Researched once. `presence.build()` owns that guarantee durably (its own
 * attempt log skips a subject that is already running or was read inside
 * its refresh window) — the same guard the voice trigger relies on, reused
 * here rather than reimplemented as a second, process-local one that a
 * multi-instance worker could not honour anyway.
 *
 * Never a mandate step. `presenceCandidates()` already refuses every
 * `I1.*`/`I2.*`/`I3.*` step; this file does not special-case investors
 * beyond naming which step names an investor organisation, and does not
 * loosen what the mapper allows.
 */

type SubjectNaming = {
  readonly journeyType: "founder" | "investor";
  readonly subjectType: "COMPANY" | "INVESTOR_ORGANISATION";
};

/** Steps naming a subject well enough to search for (mirrors presence-trigger.ts's own list). */
const NAMING_STEPS: ReadonlyMap<string, SubjectNaming> = new Map([
  [
    FOUNDER_STEPS.companyName,
    { journeyType: FOUNDER_JOURNEY_TYPE, subjectType: "COMPANY" },
  ],
  [
    INVESTOR_STEPS.organisationName,
    {
      journeyType: INVESTOR_JOURNEY_TYPE,
      subjectType: "INVESTOR_ORGANISATION",
    },
  ],
]);

export type PresenceResearchDispatchDependencies = {
  readonly sql: DatabaseExecutor;
  readonly presence: PresenceService;
  readonly sessions: OnboardingSessionRepository;
  readonly responses: OnboardingResponseRepository;
  readonly suggestions: OnboardingSuggestionRepository;
  /** The onboarding runtime's internal, never-browser-reachable creation. */
  readonly createSuggestion: (command: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly targetField: string;
    readonly suggestedValue: unknown;
    readonly sourceRefs: readonly {
      readonly sourceType: string;
      readonly sourceId: string;
    }[];
    readonly confidence: string | null;
  }) => Promise<unknown>;
  readonly logger?: Logger | undefined;
};

export type PresenceResearchDispatch = {
  /**
   * Fire-and-forget: returns before the research has even started. Call it
   * from the domain-event handler exactly like a log line, not like a step
   * whose outcome the caller waits on.
   */
  readonly onResponseCommitted: (event: {
    readonly sessionId: string;
    readonly stepKey: string;
    readonly responseId: string;
  }) => void;
};

/**
 * A committed step's text answer, read the same defensive way founder
 * review's own `narrativeOf` does: the runtime's response value is already
 * validated against its step, but nothing here re-derives that trust.
 */
function textOf(
  responses: readonly { readonly stepKey: string; readonly value: unknown }[],
  stepKey: string,
): string | null {
  const response = responses.find((candidate) => candidate.stepKey === stepKey);
  if (
    response === undefined ||
    typeof response.value !== "object" ||
    response.value === null
  ) {
    return null;
  }
  const text = (response.value as Record<string, unknown>)["text"];
  return typeof text === "string" && text.trim().length > 0
    ? text.trim()
    : null;
}

export function createPresenceResearchDispatch(
  dependencies: PresenceResearchDispatchDependencies,
): PresenceResearchDispatch {
  const {
    sql,
    presence,
    sessions,
    responses,
    suggestions,
    createSuggestion,
    logger,
  } = dependencies;

  return {
    onResponseCommitted: (event) => {
      const naming = NAMING_STEPS.get(event.stepKey);
      if (naming === undefined) return;

      // Detached: nothing below this line is awaited by the event handler,
      // and nothing it throws leaves this function.
      void (async () => {
        try {
          const session = await sessions.findById(
            sql,
            event.sessionId as never,
          );
          if (
            session === null ||
            session.status !== "ACTIVE" ||
            session.tenantId === null ||
            session.journeyType !== naming.journeyType ||
            session.subject === null ||
            session.subject.subjectType !== naming.subjectType
          ) {
            return;
          }

          const current = await responses.listCurrent(sql, session.id);
          const committed = current.find(
            (response) =>
              response.stepKey === event.stepKey &&
              response.id === event.responseId,
          );
          const name =
            committed !== undefined && committed.value.type === "TEXT"
              ? committed.value.text.trim()
              : "";
          if (name.length < 2) return;

          // Only a founder's company has a separate website step to offer
          // alongside its name; an investor organisation's name is asked
          // alone (CQ-Q-PRESENCE-001's own trigger draws the same line).
          const website =
            naming.subjectType === "COMPANY"
              ? textOf(current, FOUNDER_STEPS.website)
              : null;

          const outcome = await presence.build({
            actor: {
              userId: session.userId,
              tenantId: session.tenantId,
              actorType: "HUMAN",
              ...(session.organisationId === null
                ? {}
                : { organisationId: session.organisationId }),
            },
            subject: {
              subjectType: naming.subjectType,
              subjectId: session.subject.subjectId,
            },
            identity: {
              name,
              websiteUrl: website,
              profileUrl: null,
              qualifier: null,
            },
            correlationId: createCorrelationId(),
          });

          logger?.info(
            {
              sessionId: session.id,
              subjectType: naming.subjectType,
              status: outcome.status,
            },
            "presence research for a typed onboarding turn finished",
          );

          if (
            outcome.status !== "COMPLETED" ||
            outcome.understandings.length === 0
          ) {
            return;
          }

          const pending = await suggestions.listPending(sql, session.id);
          const reading = presenceCandidates({
            journeyType: naming.journeyType,
            subjectType: naming.subjectType,
            findings: outcome.understandings,
            answeredStepKeys: new Set(
              current.map((response) => response.stepKey),
            ),
            pendingStepKeys: new Set(
              pending.map((suggestion) => suggestion.stepKey),
            ),
          });

          for (const candidate of reading.candidates) {
            try {
              await createSuggestion({
                sessionId: session.id,
                stepKey: candidate.stepKey,
                targetField: candidate.targetField,
                suggestedValue: candidate.suggestedValue,
                sourceRefs: candidate.sourceRefs,
                confidence: candidate.confidence,
              });
            } catch (error: unknown) {
              logger?.warn(
                {
                  err: error,
                  sessionId: session.id,
                  stepKey: candidate.stepKey,
                },
                "a presence candidate was refused by the onboarding runtime",
              );
            }
          }
        } catch (error: unknown) {
          logger?.warn(
            { err: error, sessionId: event.sessionId },
            "presence research for a typed onboarding turn failed",
          );
        }
      })();
    },
  };
}
