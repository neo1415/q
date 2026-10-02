import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Where the person's own side stands with the counterparty the question is
 * about, as one authorised fact (CQ-Q-030).
 *
 * Read through the same `get_relationship` tool the model could call,
 * under the same plan, so it carries exactly what that side may see: a
 * company never learns of an investor's private discovery here either.
 * A context fact in plain words, dated -- not a field dump -- so an answer
 * about Apex can say "you connected on 25 September" without being asked
 * to look. Nothing on record is no fact at all: absence is not a state.
 */

type RelationshipRead = {
  readonly yourSide?: unknown;
  readonly counterpart?: { readonly name?: unknown };
  readonly relationship?: {
    readonly state?: unknown;
    readonly stateSince?: unknown;
    readonly milestones?: readonly { state?: unknown; at?: unknown }[];
    readonly nextStep?: unknown;
  } | null;
};

const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "discovered (no interest expressed yet)",
  INTEREST_EXPRESSED:
    "you expressed interest; waiting for the company to accept (nothing for you to answer)",
  CONNECTED: "connected -- both sides have agreed to connect",
  DECLINED: "the company has not taken the interest forward",
};

const MILESTONE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "interest expressed",
  CONNECTED: "connected",
  DECLINED: "not taken forward",
};

const NEXT_WORDS: Readonly<Record<string, string>> = {
  EXPRESS_INTEREST: "they could express interest, if they want to explore it",
  AWAIT_ANSWER: "the company has not answered yet",
  ANSWER_INTEREST: "they have an interest to accept or decline",
  SCHEDULE_MEETING: "a first meeting is the natural next step",
  NONE: "nothing is pending",
};

function day(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function relationshipFact(data: unknown): AuthorisedFact | null {
  const read = data as RelationshipRead;
  const relationship = read.relationship;
  if (relationship === null || relationship === undefined) return null;
  // From their own side (live 2026-10-02: an investor's own interest was
  // said as the company waiting for them).
  const founderSide = read.yourSide === "COMPANY";
  const state =
    typeof relationship.state === "string"
      ? founderSide && relationship.state === "INTEREST_EXPRESSED"
        ? "the investor expressed interest; waiting for you to accept or decline"
        : founderSide && relationship.state === "DECLINED"
          ? "the investor expressed interest; you did not take it forward"
          : STATE_WORDS[relationship.state]
      : undefined;
  if (state === undefined) return null;
  const name =
    typeof read.counterpart?.name === "string" &&
    read.counterpart.name.length > 0
      ? read.counterpart.name
      : "this counterparty";
  const since = day(relationship.stateSince);
  const history = (relationship.milestones ?? [])
    .map((milestone) => {
      const words =
        typeof milestone.state === "string"
          ? MILESTONE_WORDS[milestone.state]
          : undefined;
      const at = day(milestone.at);
      return words === undefined || at === null ? null : `${words} ${at}`;
    })
    .filter((entry): entry is string => entry !== null);
  const next =
    typeof relationship.nextStep === "string"
      ? NEXT_WORDS[relationship.nextStep]
      : undefined;
  const parts = [
    `${state}${since === null ? "" : ` since ${since}`}`,
    ...(history.length === 0 ? [] : [`what happened: ${history.join("; ")}`]),
    ...(next === undefined ? [] : [`next: ${next}`]),
  ];
  return {
    scope: "RELATIONSHIP_CONTEXT",
    statement:
      `The person's own relationship with ${name} on Capital Q -- ${parts.join("; ")}.`.slice(
        0,
        2_000,
      ),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Capital Q relationship history",
    ...(since === null ? {} : { asOf: since }),
  };
}
