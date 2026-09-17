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

/**
 * What the person is called, for the one query that is about them.
 *
 * A name alone is a bad query and a person's name is the worst of them:
 * the presence build drops every page that does not name the subject, so
 * without something to disambiguate, a common name reads as nothing found.
 * The company they have just named is that something.
 */
export type PersonNameLookup = {
  readonly displayNameFor: (
    actor: ActorContext,
  ) => Promise<string | null> | string | null;
};

/**
 * What was found about the person, on its way back to them.
 *
 * Looking somebody up at arrival is only worth doing if Q can then say so:
 * here is what is public under your name, have I got the right person?
 * Without this the research happened in silence and the person had no idea
 * Q had done anything at all.
 *
 * Their own understandings, going back to them. Nobody else's ever reaches
 * this, because a build only runs for a subject the actor already owns.
 */
export type PresenceFound = {
  readonly name: string;
  readonly statements: readonly string[];
  readonly domains: readonly string[];
};

export type PresenceTriggerDependencies = {
  readonly presence: PresenceService;
  /** Absent means companies only; a person is simply not looked up. */
  readonly people?: PersonNameLookup | undefined;
  /** Told what was found about the person, so Q can check it is them. */
  readonly onPersonFound?: ((found: PresenceFound) => void) | undefined;
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
    /** Told what was found about the person, so Q can check it is them. */
    onFound?: (found: PresenceFound) => void,
    /** What the person told Capital Q before the interview began. */
    hints?: { readonly organisationName?: string | null | undefined },
  ) => void;
};

export function createPresenceTrigger(
  dependencies: PresenceTriggerDependencies,
): PresenceTrigger {
  const { presence, people, onPersonFound, logger } = dependencies;

  /** One build, detached, never able to delay or fail a turn. */
  const start = (
    actor: ActorContext,
    subjectType: "COMPANY" | "PERSON",
    subjectId: string,
    identity: {
      readonly name: string;
      readonly websiteUrl: string | null;
      readonly profileUrl: string | null;
      readonly qualifier: string | null;
    },
    report: ((found: PresenceFound) => void) | undefined,
  ): void => {
    void (async () => {
      try {
        const outcome = await presence.build({
          actor,
          subject: { subjectType, subjectId },
          identity,
          correlationId: createCorrelationId(),
        });
        // Counts and a status. Never a statement, a query or a page.
        logger?.info(
          { status: outcome.status, subjectType },
          "public presence build finished",
        );
        if (
          subjectType === "PERSON" &&
          outcome.status === "COMPLETED" &&
          outcome.understandings.length > 0 &&
          report !== undefined
        ) {
          report({
            name: identity.name,
            statements: outcome.understandings.map((u) => u.statement),
            domains: outcome.domains,
          });
        }
      } catch (error: unknown) {
        logger?.warn(
          { err: error, subjectType },
          "public presence build threw",
        );
      }
    })();
  };

  /**
   * One read per subject per process. The interview calls this after
   * every turn; the presence service has its own memory of what it read,
   * but a build it is still running must not be asked for again on the
   * next sentence.
   */
  const started = new Set<string>();
  const once = (subjectType: string, subjectId: string): boolean => {
    const key = `${subjectType}:${subjectId}`;
    if (started.has(key)) return false;
    started.add(key);
    return true;
  };

  return {
    afterInterviewTurn: (actor, view, onFound, hints) => {
      const subject = view.session.subject;
      const interviewName = firstText(view, FOUNDER_COMPANY_NAME);
      const website = firstText(view, FOUNDER_WEBSITE);
      // What tells one person of that name from another: the company they
      // named in the interview, or failing that the organisation they
      // typed at sign-up. Public either way.
      const qualifier =
        interviewName !== null && interviewName.length >= 2
          ? interviewName
          : (hints?.organisationName ?? "").trim() || null;

      if (
        subject !== null &&
        subject.type === "COMPANY" &&
        interviewName !== null &&
        interviewName.length >= 2 &&
        once("COMPANY", subject.id)
      ) {
        start(
          actor,
          "COMPANY",
          subject.id,
          {
            name: interviewName,
            websiteUrl: website,
            profileUrl: null,
            qualifier: null,
          },
          undefined,
        );
      }

      /**
       * And the person themselves, which is the whole point of doing this
       * at arrival: what they have published, what they say they do, what
       * they are known for. Their own row, never anybody else's; the
       * presence service refuses a subject the actor does not own.
       *
       * This does not wait for a company record to exist. Live, a new
       * founder went through a whole interview and was never looked up,
       * because the company row is created late in the setup and the
       * lookup was tied to it. A name and a qualifier are enough.
       * Their company's website is not theirs and is not passed.
       */
      if (people === undefined || qualifier === null) return;
      if (!once("PERSON", actor.userId)) return;
      void (async () => {
        try {
          const personName = await people.displayNameFor(actor);
          if (personName === null || personName.trim().length < 2) return;
          start(
            actor,
            "PERSON",
            actor.userId,
            {
              name: personName.trim(),
              websiteUrl: null,
              profileUrl: null,
              qualifier,
            },
            onFound ?? onPersonFound,
          );
        } catch (error: unknown) {
          logger?.warn({ err: error }, "could not read a name to look up");
        }
      })();
    },
  };
}
