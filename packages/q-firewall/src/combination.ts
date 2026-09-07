import type {
  QAuthorisedKnowledgeScope,
  QCombinationConstraint,
  QDeniedScope,
  QFactCategory,
  QKnowledgeScopeKind,
} from "@capital-q/contracts";

import type { SubjectRelation } from "./catalogue.js";

/**
 * Combination-risk policy (doc 12 §15.3, doc 15 §3.7, §22).
 *
 * Several individually permitted scopes can together reveal a conclusion
 * none of them reveals alone — cash, burn, payroll timing and a funding
 * deadline give away a negotiation-sensitive liquidity position. The rules
 * here are deterministic, bounded and explicit: each names the fact
 * categories that must not co-occur for an actor who does not own the
 * subject, and what to do when they do. No classifier, no model, no DSL.
 *
 * Rules only ever remove or narrow. An owning side is never constrained
 * by its own facts.
 */

export type CombinationRiskRule = {
  readonly id: string;
  /** Relations the rule protects against. Owners are never listed. */
  readonly appliesTo: readonly Exclude<SubjectRelation, "OWNER" | "SELF">[];
  /** The categories whose co-occurrence is the risk. */
  readonly categories: readonly QFactCategory[];
  /** How many of them must be present before the rule fires. */
  readonly threshold: number;
  readonly effect:
    | {
        readonly kind: "DENY_SCOPES";
        readonly scopeKinds: readonly QKnowledgeScopeKind[];
      }
    | {
        readonly kind: "AGGREGATE_PROJECTION";
        readonly scopeKinds: readonly QKnowledgeScopeKind[];
      };
};

export const COMBINATION_RISK_RULES: readonly CombinationRiskRule[] = [
  {
    // Liquidity position: any two of cash, burn, payroll timing and the
    // funding deadline, in a non-owner's context, is the runway inference.
    // The financial primitives are withdrawn; the objective is kept only as
    // an aggregate (target, not timing).
    id: "LIQUIDITY_POSITION",
    appliesTo: ["COUNTERPARTY", "NETWORK"],
    categories: [
      "CASH_POSITION",
      "BURN_RATE",
      "PAYROLL_TIMING",
      "FUNDING_DEADLINE",
    ],
    threshold: 2,
    effect: {
      kind: "DENY_SCOPES",
      scopeKinds: ["COMPANY_PRIVATE_FINANCIALS"],
    },
  },
  {
    // Negotiation leverage: a shared capital objective (with its deadline)
    // read alongside the live relationship history lets a counterparty time
    // its pressure. The objective survives as an aggregate projection.
    id: "NEGOTIATION_LEVERAGE",
    appliesTo: ["COUNTERPARTY", "NETWORK"],
    categories: ["FUNDING_DEADLINE", "NEGOTIATION_STATE"],
    threshold: 2,
    effect: {
      kind: "AGGREGATE_PROJECTION",
      scopeKinds: ["COMPANY_CAPITAL_OBJECTIVE"],
    },
  },
];

export type CombinationOutcome = {
  readonly scopes: readonly QAuthorisedKnowledgeScope[];
  readonly constraints: readonly QCombinationConstraint[];
  readonly denied: readonly QDeniedScope[];
};

/**
 * Applies every rule to the permitted scopes, given how the actor relates
 * to each scope's subject. Deterministic: same input, same output.
 */
export function applyCombinationRules(
  scopes: readonly QAuthorisedKnowledgeScope[],
  relationOf: (scope: QAuthorisedKnowledgeScope) => SubjectRelation,
  rules: readonly CombinationRiskRule[] = COMBINATION_RISK_RULES,
): CombinationOutcome {
  let current = [...scopes];
  const constraints: QCombinationConstraint[] = [];
  const denied: QDeniedScope[] = [];

  for (const rule of rules) {
    // Only scopes the actor does not own can combine into a leak.
    const exposed = current.filter((scope) =>
      (rule.appliesTo as readonly SubjectRelation[]).includes(
        relationOf(scope),
      ),
    );
    const present = new Set<QFactCategory>();
    for (const scope of exposed) {
      for (const category of scope.factCategories) {
        if (rule.categories.includes(category)) {
          present.add(category);
        }
      }
    }
    if (present.size < rule.threshold) {
      continue;
    }

    const affected = exposed.filter((scope) =>
      rule.effect.scopeKinds.includes(scope.kind),
    );
    if (affected.length === 0) {
      continue;
    }
    constraints.push({
      ruleId: rule.id,
      effect:
        rule.effect.kind === "DENY_SCOPES"
          ? "DENY_SCOPES"
          : "AGGREGATE_PROJECTION",
      affectedScopeKinds: [...new Set(affected.map((scope) => scope.kind))],
      categories: [...present],
    });

    if (rule.effect.kind === "DENY_SCOPES") {
      current = current.filter((scope) => !affected.includes(scope));
      for (const scope of affected) {
        denied.push({
          kind: scope.kind,
          ...(scope.subject === undefined ? {} : { subject: scope.subject }),
          reason: "COMBINATION_RISK",
        });
      }
    } else {
      current = current.map((scope) =>
        affected.includes(scope)
          ? {
              ...scope,
              projection: "AGGREGATE",
              // An aggregate projection reveals the target, never the timing.
              factCategories: scope.factCategories.filter(
                (category) => !rule.categories.includes(category),
              ),
            }
          : scope,
      );
    }
  }

  return { scopes: current, constraints, denied };
}
