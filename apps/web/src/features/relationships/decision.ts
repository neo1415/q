import type {
  RelationshipCommitmentsDto,
  RelationshipPassResponseDto,
  RelationshipStatusDto,
} from "@capital-q/contracts";

import { commitmentLine } from "./portfolio";

/**
 * The decision on one relationship record (CRM S5, research 2026-10-15
 * §2: "no decision record"): the latest decision the history holds, with
 * why and the money, read from what already exists (the per-party fold's
 * milestones, the current pass as this side may see it, the current
 * commitment). Nothing new is stored, and nothing is inferred: a missing
 * reason is said as not recorded, never guessed.
 */

export const DECISION_STATES = [
  "IN_DILIGENCE",
  "PAUSED",
  "PASSED",
  "INVESTED",
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

const WORDS: Readonly<Record<DecisionState, string>> = {
  IN_DILIGENCE: "Diligence started",
  PAUSED: "Paused",
  PASSED: "Passed",
  INVESTED: "Invested",
};

export type Decision = {
  readonly state: DecisionState;
  readonly title: string;
  readonly at: string;
  /** Lines of why and how much, in words; empty when nothing applies. */
  readonly details: readonly string[];
  /** Earlier decisions, newest first: "Diligence started 2 Oct". */
  readonly earlier: readonly { readonly title: string; readonly at: string }[];
};

const isDecision = (state: string): state is DecisionState =>
  (DECISION_STATES as readonly string[]).includes(state);

/**
 * Whether the record shows a decision card: a pass or an investment, the
 * decisions with a why or an amount. Diligence and a pause are already the
 * hero's state line; they appear here only as earlier decisions.
 */
export function decided(
  relationship: Pick<RelationshipStatusDto, "state"> | null,
): boolean {
  return (
    relationship !== null &&
    (relationship.state === "PASSED" || relationship.state === "INVESTED")
  );
}

export function decisionOf(input: {
  readonly relationship: Pick<
    RelationshipStatusDto,
    "state" | "stateSince" | "milestones"
  >;
  readonly side: "INVESTOR" | "COMPANY";
  /** Read for a pass; undefined: it could not be read. */
  readonly pass?: RelationshipPassResponseDto | undefined;
  /** Read for an investment; undefined: it could not be read. */
  readonly commitments?: RelationshipCommitmentsDto | undefined;
}): Decision | null {
  const { relationship, side } = input;
  if (!decided(relationship) || !isDecision(relationship.state)) return null;
  const milestones = relationship.milestones
    .filter((milestone) => isDecision(milestone.state))
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const details: string[] = [];
  if (relationship.state === "PASSED") {
    const pass = input.pass?.pass;
    if (input.pass === undefined) {
      details.push("The reason couldn't be read");
    } else if (pass === null || pass === undefined) {
      // The company side sees a reason only when the investor shared it.
      details.push(
        side === "COMPANY" ? "No reason shared" : "No reason recorded",
      );
    } else {
      details.push(
        pass.reasonLabel === null
          ? "No reason recorded"
          : `Reason: ${pass.reasonLabel}`,
      );
      if (pass.note !== null) details.push(`Note: ${pass.note}`);
      if (side === "INVESTOR")
        details.push(
          pass.sharedWithFounder
            ? "Reason shared with the founder"
            : "Reason private to your firm",
        );
    }
  }
  if (relationship.state === "INVESTED") {
    details.push(commitmentLine(input.commitments));
  }
  return {
    state: relationship.state,
    title: WORDS[relationship.state],
    at: relationship.stateSince,
    details,
    earlier: milestones
      .filter((milestone) => milestone.at !== relationship.stateSince)
      .flatMap((milestone) =>
        isDecision(milestone.state)
          ? [{ title: WORDS[milestone.state], at: milestone.at }]
          : [],
      ),
  };
}
