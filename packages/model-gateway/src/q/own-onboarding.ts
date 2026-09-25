import type { ActorContext } from "@capital-q/security";
import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Who the person is, from what they told Capital Q while setting up
 * (CQ-QX-007; acceptance directive — Home Q knowing the person).
 *
 * The port is the person's own: the composition reads their own name and
 * their own onboarding sessions by their own user id, and the gateway only
 * asks when the plan holds the actor-wide OWN_ONBOARDING scope, which the
 * Context Firewall grants to nobody but the person themselves.
 *
 * The fact states what is on record — name, role, how far along, which
 * questions are answered and which are left — and nothing about how to say
 * it: that is the conversation's job, and a list of fields read out is
 * exactly what a person asking "who am I?" should never get.
 */
export type OwnOnboardingJourney = {
  readonly journeyType: string;
  readonly status: string;
  readonly role: string | null;
  readonly answeredCount: number;
  readonly eligibleCount: number;
  readonly currentStep: string | null;
  readonly answered: readonly string[];
  readonly open: readonly string[];
};

export type OwnOnboarding = {
  readonly name: string | null;
  readonly journeys: readonly OwnOnboardingJourney[];
};

export type QOwnOnboardingPort = {
  readonly read: (actor: ActorContext) => Promise<OwnOnboarding>;
};

const LIST_IN_FACT = 25;

const journeyWords = (type: string): string =>
  type === "investor"
    ? "investor setup"
    : type === "founder"
      ? "founder setup"
      : `${type.replace(/_/g, " ")} setup`;

const statusWords = (status: string): string =>
  status === "COMPLETED"
    ? "completed"
    : status === "ACTIVE"
      ? "in progress"
      : status.toLowerCase();

const quoted = (items: readonly string[]): string =>
  items
    .slice(0, LIST_IN_FACT)
    .map((item) => `"${item}"`)
    .join(", ");

/** One authorised fact per journey, plus their name; empty when nothing is on record. */
export function ownOnboardingFacts(
  onboarding: OwnOnboarding,
): readonly AuthorisedFact[] {
  const facts: AuthorisedFact[] = [];
  const name = onboarding.name?.trim() ?? "";
  if (name.length > 0) {
    facts.push({
      scope: "OWN_ONBOARDING",
      statement: `The person's name on Capital Q: ${name.slice(0, 120)}.`,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      source: "your Capital Q profile",
    });
  }
  for (const journey of onboarding.journeys) {
    const parts = [
      `${journeyWords(journey.journeyType)}, ${statusWords(journey.status)}`,
      ...(journey.role === null ? [] : [`role they gave: ${journey.role}`]),
      `${String(journey.answeredCount)} of ${String(journey.eligibleCount)} questions answered`,
      ...(journey.currentStep === null
        ? []
        : [`the question they are on: "${journey.currentStep}"`]),
      ...(journey.answered.length === 0
        ? []
        : [`answered: ${quoted(journey.answered)}`]),
      ...(journey.open.length === 0
        ? []
        : [`not answered yet: ${quoted(journey.open)}`]),
    ];
    facts.push({
      scope: "OWN_ONBOARDING",
      statement: `The person's own onboarding — ${parts.join("; ")}.`.slice(
        0,
        4_000,
      ),
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      source: "your own setup on Capital Q",
    });
  }
  return facts;
}
