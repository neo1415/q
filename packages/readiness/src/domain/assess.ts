import type {
  ReadinessAction,
  ReadinessBlocker,
  ReadinessPillar,
  ReadinessStatus,
} from "@capital-q/contracts";

import type {
  ReadinessCheckRule,
  ReadinessRules,
  ReadinessSeverity,
} from "../rules/v1.js";
import { stageRank, type ReadinessInputs } from "./inputs.js";
import { readSignal, type SignalResult } from "./signals.js";

/**
 * The assessment: rules over inputs, nothing else. Same inputs and rules,
 * same answer, every time (no clock, no model, no randomness), so a stored
 * assessment can be reproduced from its basis.
 *
 * A pillar's status:
 *   UNKNOWN     no check in it has anything on record. Never a weakness.
 *   GAP         something its BLOCKER checks need is missing or unsupported.
 *   STRONG      nothing expected is missing, no contradiction is open, and
 *               at least `strongMinEvidenced` checks are document-backed,
 *               verified or the company's own record.
 *   DEVELOPING  everything else.
 * A contradiction never makes a pillar a Gap (it is something to settle,
 * not a penalty); it only keeps the pillar from reading Strong.
 */

export type CheckOutcome = {
  readonly rule: ReadinessCheckRule;
  readonly severity: ReadinessSeverity;
  readonly result: SignalResult;
  /** Not met for the rule: missing, stated where evidence is required, or contradicted. */
  readonly open: "MISSING" | "UNSUPPORTED" | "CONTRADICTED" | null;
};

export type ActionMark = { readonly done: boolean; readonly at: string };

export type ReadinessAssessment = {
  readonly rulesVersion: string;
  readonly stageCode: string | null;
  readonly pillars: readonly ReadinessPillar[];
  readonly blockers: readonly ReadinessBlocker[];
  readonly actions: readonly ReadinessAction[];
  readonly uncertainty: readonly string[];
  /** For the Blueprint: every evaluated check with its outcome. */
  readonly outcomes: readonly CheckOutcome[];
};

const OWNER_LABELS: Readonly<Record<ReadinessAction["owner"], string>> = {
  FOUNDER: "You",
  WITH_Q: "Q drafts, you approve",
  EXPERT_SUPPORT: "You or an adviser",
};

const SEVERITY_ORDER: Readonly<Record<ReadinessSeverity, number>> = {
  BLOCKER: 0,
  EXPECTED: 1,
  SUPPORTING: 2,
};

function openOf(
  rule: ReadinessCheckRule,
  result: SignalResult,
): CheckOutcome["open"] {
  switch (result.state) {
    case "MISSING":
      return "MISSING";
    case "CONTRADICTED":
      return "CONTRADICTED";
    case "STATED":
      return rule.requireEvidenced === true ? "UNSUPPORTED" : null;
    case "EVIDENCED":
      return null;
  }
}

export function evaluate(
  inputs: ReadinessInputs,
  rules: ReadinessRules,
): readonly CheckOutcome[] {
  const rank = stageRank(inputs.stageCode);
  const out: CheckOutcome[] = [];
  for (const rule of rules.checks) {
    const result = readSignal(rule.signal, inputs);
    if (result === null) continue;
    out.push({
      rule,
      severity: rule.severity[rank - 1] ?? "SUPPORTING",
      result,
      open: openOf(rule, result),
    });
  }
  return out;
}

function pillarStatus(
  outcomes: readonly CheckOutcome[],
  rules: ReadinessRules,
): ReadinessStatus {
  if (outcomes.every((outcome) => outcome.result.state === "MISSING")) {
    return "UNKNOWN";
  }
  const blocking = outcomes.some(
    (outcome) =>
      outcome.severity === "BLOCKER" &&
      (outcome.open === "MISSING" || outcome.open === "UNSUPPORTED"),
  );
  if (blocking) return "GAP";
  const expectedOpen = outcomes.some(
    (outcome) => outcome.severity !== "SUPPORTING" && outcome.open !== null,
  );
  const contradicted = outcomes.some(
    (outcome) => outcome.open === "CONTRADICTED",
  );
  const evidenced = outcomes.filter(
    (outcome) => outcome.result.state === "EVIDENCED",
  ).length;
  return !expectedOpen && !contradicted && evidenced >= rules.strongMinEvidenced
    ? "STRONG"
    : "DEVELOPING";
}

function summaryOf(
  outcomes: readonly CheckOutcome[],
  status: ReadinessStatus,
  unknownLine: string,
): string {
  if (status === "UNKNOWN") return unknownLine;
  const have = outcomes
    .filter((outcome) => outcome.open === null)
    .map((outcome) => outcome.rule.label);
  const contradicted = outcomes
    .filter((outcome) => outcome.open === "CONTRADICTED")
    .map((outcome) => outcome.rule.label.toLowerCase());
  const missing = outcomes
    .filter(
      (outcome) =>
        outcome.severity !== "SUPPORTING" &&
        (outcome.open === "MISSING" || outcome.open === "UNSUPPORTED"),
    )
    .map((outcome) =>
      outcome.open === "UNSUPPORTED"
        ? `${outcome.rule.label.toLowerCase()} (stated, no document)`
        : outcome.rule.label.toLowerCase(),
    );
  const parts: string[] = [];
  if (have.length > 0) parts.push(`On record: ${have.slice(0, 3).join(", ")}.`);
  if (contradicted.length > 0) {
    parts.push(`Two readings to settle: ${contradicted.join(", ")}.`);
  }
  if (missing.length > 0)
    parts.push(`Not yet: ${missing.slice(0, 3).join(", ")}.`);
  const text = parts.join(" ");
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function priorityOf(outcome: CheckOutcome): ReadinessAction["priority"] {
  return outcome.severity === "BLOCKER"
    ? "NOW"
    : outcome.severity === "EXPECTED"
      ? "NEXT"
      : "LATER";
}

export function assess(
  inputs: ReadinessInputs,
  rules: ReadinessRules,
  marks: ReadonlyMap<string, ActionMark> = new Map(),
): ReadinessAssessment {
  const outcomes = evaluate(inputs, rules);

  const pillars: ReadinessPillar[] = rules.pillars.map((definition) => {
    const own = outcomes.filter(
      (outcome) => outcome.rule.pillar === definition.pillar,
    );
    const status: ReadinessStatus =
      own.length === 0 ? "UNKNOWN" : pillarStatus(own, rules);
    return {
      pillar: definition.pillar,
      label: definition.label,
      status,
      summary: summaryOf(own, status, definition.unknownLine),
      evidence: own.flatMap((outcome) => outcome.result.evidence).slice(0, 30),
      improve: own
        .filter((outcome) => outcome.open !== null)
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
        .map((outcome) => outcome.result.improve ?? outcome.rule.action.next)
        .slice(0, 6),
    };
  });

  // What could stop the raise: BLOCKER checks still open, and any open
  // contradiction (investors will ask which figure is right). Ordered by
  // the rules' own order within each kind.
  const blockerOutcomes = [
    ...outcomes.filter(
      (outcome) =>
        outcome.severity === "BLOCKER" &&
        (outcome.open === "MISSING" || outcome.open === "UNSUPPORTED"),
    ),
    ...outcomes.filter((outcome) => outcome.open === "CONTRADICTED"),
  ];
  const blockers: ReadinessBlocker[] = blockerOutcomes
    .slice(0, rules.blockersMax)
    .map((outcome) => {
      const kind = outcome.open ?? "MISSING";
      const title =
        kind === "CONTRADICTED"
          ? (outcome.rule.blocker.contradicted ??
            `Two readings for ${outcome.rule.label.toLowerCase()}`)
          : kind === "UNSUPPORTED"
            ? (outcome.rule.blocker.unsupported ?? outcome.rule.blocker.missing)
            : outcome.rule.blocker.missing;
      return {
        id: outcome.rule.id,
        pillar: outcome.rule.pillar,
        kind,
        title,
        why:
          kind === "CONTRADICTED"
            ? "Your records disagree. Q won't pick one for you: say which is current."
            : outcome.rule.blocker.why,
        actionKey: outcome.rule.action.key,
      };
    });

  const actions: ReadinessAction[] = outcomes
    .map((outcome) => {
      const mark = marks.get(outcome.rule.action.key);
      const state: ReadinessAction["state"] =
        outcome.open === null
          ? "DONE_BY_EVIDENCE"
          : mark?.done === true
            ? "MARKED_DONE"
            : "OPEN";
      const contradicted = outcome.open === "CONTRADICTED";
      return {
        key: outcome.rule.action.key,
        pillar: outcome.rule.pillar,
        closesGapId: outcome.rule.id,
        priority: contradicted ? ("NOW" as const) : priorityOf(outcome),
        title: contradicted
          ? `Settle: ${outcome.rule.label.toLowerCase()}`
          : outcome.rule.action.title,
        why: contradicted
          ? "Two figures for one fact make investors check everything twice."
          : outcome.rule.action.why,
        next: contradicted
          ? "Answer Q's question about which figure is current."
          : (outcome.result.improve ?? outcome.rule.action.next),
        doneWhen: outcome.rule.action.doneWhen,
        owner: outcome.rule.action.owner,
        ownerLabel: OWNER_LABELS[outcome.rule.action.owner],
        state,
        doneAt: state === "MARKED_DONE" ? (mark?.at ?? null) : null,
        href: contradicted ? "/home" : outcome.rule.action.href,
        askQ: contradicted ? null : outcome.rule.action.askQ,
      };
    })
    .sort(
      (a, b) =>
        ["NOW", "NEXT", "LATER"].indexOf(a.priority) -
        ["NOW", "NEXT", "LATER"].indexOf(b.priority),
    );

  const uncertainty: string[] = [];
  if (inputs.deck !== null && inputs.deck.sections === null) {
    uncertainty.push(
      "Q hasn't read your pitch deck yet, so the deck's sections aren't assessed.",
    );
  }
  if (inputs.dataRoom === null) {
    uncertainty.push("Q couldn't read your data room checklist just now.");
  }
  if (inputs.stageCode === null) {
    uncertainty.push(
      "Your stage isn't on record, so Q used what seed investors usually expect.",
    );
  }
  uncertainty.push(
    "Statuses come from what you've shared on Capital Q. Not shared yet is never counted against you.",
  );

  return {
    rulesVersion: rules.version,
    stageCode: inputs.stageCode,
    pillars,
    blockers,
    actions,
    uncertainty,
    outcomes,
  };
}

/** The founder's next three: open actions, most urgent first. */
export function nextActions(
  actions: readonly ReadinessAction[],
  count = 3,
): readonly ReadinessAction[] {
  return actions.filter((action) => action.state === "OPEN").slice(0, count);
}
