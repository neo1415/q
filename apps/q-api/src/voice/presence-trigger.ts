import type { OnboardingSessionView } from "@capital-q/contracts";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import type { PresenceService } from "@capital-q/q-presence";
import type { ActorContext } from "@capital-q/security";

/**
 * When Capital Q first knows enough to look somebody up.
 *
 * The moment, not a schedule: a name alone is a bad query (every third
 * person shares one), so a presence build waits until the setup has both a
 * name and something that disambiguates it — a company name, a website.
 * From then on the presence service itself decides whether a read is due,
 * and this only asks.
 *
 * Every call here is detached and best effort. It runs while a person is
 * mid-sentence with Q; it must never delay a turn and must never be able
 * to fail one, so nothing awaits it and nothing it throws escapes.
 */

const FOUNDER_COMPANY_NAME = "F1.company_name";
const FOUNDER_WEBSITE = "F1.website";

function firstText(
  view: OnboardingSessionView,
  stepKey: string,
): string | null {
  const response = view.responses.find((r) => r.stepKey === stepKey);
  if (response === undefined) return null;
  const value: unknown = response.value;
  if (typeof value === "string") return value.trim() || null;
  if (value !== null && typeof value === "object" && "text" in value) {
    const text: unknown = value.text;
    return typeof text === "string" ? text.trim() || null : null;
  }
  return null;
}

export type PresenceTriggerDependencies = {
  readonly presence: PresenceService;
  readonly logger?: Logger | undefined;
};

export type PresenceTrigger = {
  /**
   * The setup moved on. If it now names a subject well enough to search
   * for, and a read is due, start one in the background.
   */
  readonly afterInterviewTurn: (
    actor: ActorContext,
    view: OnboardingSessionView,
  ) => void;
};

export function createPresenceTrigger(
  dependencies: PresenceTriggerDependencies,
): PresenceTrigger {
  const { presence, logger } = dependencies;
  return {
    afterInterviewTurn: (actor, view) => {
      const subject = view.session.subject;
      if (subject === null || subject.type !== "COMPANY") return;
      const name = firstText(view, FOUNDER_COMPANY_NAME);
      if (name === null || name.length < 2) return;
      const website = firstText(view, FOUNDER_WEBSITE);

      void (async () => {
        try {
          const outcome = await presence.build({
            actor,
            subject: { subjectType: "COMPANY", subjectId: subject.id },
            identity: {
              name,
              websiteUrl: website,
              profileUrl: null,
              qualifier: null,
            },
            correlationId: createCorrelationId(),
          });
          // Counts and a status. Never a statement, a query or a page.
          logger?.info(
            {
              status: outcome.status,
              subjectType: "COMPANY",
            },
            "public presence build finished",
          );
        } catch (error: unknown) {
          logger?.warn({ err: error }, "public presence build threw");
        }
      })();
    },
  };
}
