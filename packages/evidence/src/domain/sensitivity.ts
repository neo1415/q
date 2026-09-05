import { MESSAGE_SENSITIVITIES } from "@capital-q/contracts";

import type { DocumentType, SensitivityClass } from "../contracts/index.js";

/**
 * Sensitivity is ordered weakest → strongest (doc 15 §20). Derived
 * information inherits the strongest relevant source sensitivity (doc 15
 * §21); this packet preserves the value on every row and exposes the
 * comparison so later derivation cannot lose it.
 */
const RANK = new Map<SensitivityClass, number>(
  MESSAGE_SENSITIVITIES.map((value, index) => [value, index]),
);

export function sensitivityRank(value: SensitivityClass): number {
  return RANK.get(value) ?? 0;
}

export function isAtLeastAsSensitive(
  candidate: SensitivityClass,
  floor: SensitivityClass,
): boolean {
  return sensitivityRank(candidate) >= sensitivityRank(floor);
}

export function strongestSensitivity(
  first: SensitivityClass,
  ...rest: readonly SensitivityClass[]
): SensitivityClass {
  return rest.reduce(
    (strongest, value) =>
      sensitivityRank(value) > sensitivityRank(strongest) ? value : strongest,
    first,
  );
}

/**
 * Conservative server-side default for a private business document. A
 * caller may strengthen it, never weaken it (doc 15 §3.5, §20).
 */
export function defaultDocumentSensitivity(
  documentType: DocumentType,
): SensitivityClass {
  switch (documentType) {
    case "FINANCIAL_MODEL":
    case "MANAGEMENT_ACCOUNTS":
    case "FINANCIAL":
      return "HIGHLY_CONFIDENTIAL";
    case "UNCLASSIFIED":
    case "PITCH_DECK":
    case "COMPANY_PROFILE":
    case "LEGAL":
    case "CORPORATE":
    case "GOVERNANCE":
    case "PRODUCT":
    case "COMMERCIAL":
    case "CUSTOMER":
    case "OPERATIONAL":
    case "OTHER":
      return "CONFIDENTIAL";
  }
}
