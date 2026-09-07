import type {
  QCapability,
  QKnowledgeScopeKind,
  QSensitivityClass,
  QSubjectKind,
  QTaskClass,
} from "@capital-q/contracts";

import type { SubjectRelation } from "./catalogue.js";

/**
 * Purpose policy (doc 12 §15.2 "purpose relevance"; packet §13-14, §55).
 *
 * The task class is DERIVED — from the capability the client asked for and
 * from how the actor relates to the resolved subjects — never accepted
 * from a request. The candidate table then says which knowledge each task
 * may need at most. Everything downstream can only remove from it.
 *
 * Minimum sufficient context is a property of this table: a plain answer
 * about one's own company gets its profile and capital objective, not its
 * financial model, its document corpus or its investor relationships.
 */

export type SubjectSummary = {
  readonly kind: QSubjectKind;
  readonly relation: SubjectRelation;
};

export function deriveTaskClass(
  capability: QCapability,
  subjects: readonly SubjectSummary[],
): QTaskClass {
  if (capability === "PREPARE_ACTION") {
    return "ACTION_PREPARATION";
  }
  if (capability === "COMPARE") {
    return "COMPARISON";
  }
  const entity = subjects.filter(
    (subject) => subject.kind !== "USER" && subject.kind !== "ORGANISATION",
  );
  if (entity.length === 0) {
    return "GENERAL_QUESTION";
  }
  if (entity.some((subject) => subject.kind === "RELATIONSHIP")) {
    return "RELATIONSHIP_QUESTION";
  }
  if (entity.some((subject) => subject.kind === "INVESTOR_ORGANISATION")) {
    return "INVESTOR_QUESTION";
  }
  // Company-shaped subjects (company, capital objective, document): the
  // actor's relation to them decides which side of the firewall they are.
  return entity.every((subject) => subject.relation === "OWNER")
    ? "OWN_COMPANY_QUESTION"
    : "COUNTERPARTY_COMPANY_QUESTION";
}

/**
 * Subject-bound knowledge a capability may need for a subject kind. The
 * owner side and the counterparty side get the same candidates: which of
 * them survive is the permission layer's answer, not this one's.
 */
export function candidateScopeKinds(
  capability: QCapability,
  subjectKind: QSubjectKind,
): readonly QKnowledgeScopeKind[] {
  switch (subjectKind) {
    case "COMPANY":
      switch (capability) {
        case "ANSWER":
          return ["COMPANY_PROFILE", "COMPANY_CAPITAL_OBJECTIVE"];
        case "INVESTIGATE":
        case "ASSESS":
          return [
            "COMPANY_PROFILE",
            "COMPANY_CAPITAL_OBJECTIVE",
            "COMPANY_PRIVATE_FINANCIALS",
            "EVIDENCE_DOCUMENTS",
          ];
        case "COMPARE":
          return ["COMPANY_PROFILE", "COMPANY_CAPITAL_OBJECTIVE"];
        case "CLASSIFY":
        case "PREPARE_ACTION":
          return ["COMPANY_PROFILE"];
      }
      break;
    case "INVESTOR_ORGANISATION":
      switch (capability) {
        case "ANSWER":
        case "INVESTIGATE":
        case "ASSESS":
          return ["INVESTOR_PROFILE", "INVESTOR_MANDATE"];
        case "COMPARE":
        case "CLASSIFY":
        case "PREPARE_ACTION":
          return ["INVESTOR_PROFILE"];
      }
      break;
    case "RELATIONSHIP":
      return ["RELATIONSHIP_CONTEXT"];
    case "CAPITAL_OBJECTIVE":
      return ["COMPANY_CAPITAL_OBJECTIVE"];
    case "DOCUMENT":
      return ["EVIDENCE_DOCUMENTS"];
    case "USER":
      return ["OWN_Q_CONVERSATION"];
    case "ORGANISATION":
      // An organisation is a context, not knowledge.
      return [];
  }
  return [];
}

/** Actor-wide knowledge every task may use. Classification stays on the subject. */
export function actorWideScopeKinds(
  capability: QCapability,
): readonly QKnowledgeScopeKind[] {
  return capability === "CLASSIFY"
    ? ["GENERAL_MODEL_KNOWLEDGE"]
    : [
        "OWN_Q_CONVERSATION",
        "NETWORK_VISIBLE_DATA",
        "PUBLIC_EXTERNAL_DATA",
        "GENERAL_MODEL_KNOWLEDGE",
      ];
}

/**
 * The strongest sensitivity a task may carry into reasoning. RESTRICTED
 * (identity artefacts) never enters Q (doc 14 §34); preparing an action or
 * classifying text never needs a financial model.
 */
export function sensitivityCeiling(taskClass: QTaskClass): QSensitivityClass {
  switch (taskClass) {
    case "ACTION_PREPARATION":
    case "COMPARISON":
      return "CONFIDENTIAL";
    case "OWN_COMPANY_QUESTION":
    case "COUNTERPARTY_COMPANY_QUESTION":
    case "INVESTOR_QUESTION":
    case "RELATIONSHIP_QUESTION":
    case "GENERAL_QUESTION":
      return "HIGHLY_CONFIDENTIAL";
  }
}
