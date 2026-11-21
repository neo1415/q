import type {
  BiometricConsent,
  IdentityCheck,
  RegistryOfficer,
  RegistryRecord,
} from "../providers/contract.js";
import { matchNames, type NameMatch } from "./name-match.js";

/**
 * V1, the linking rule (research §6.1 tier 3): "Founder ID verified" when
 *   - the company is on the register and active,
 *   - the founder's government ID and live selfie are both verified, and
 *   - the name on the ID matches a current director, shareholder or PSC.
 * Pure and deterministic. Anything that does not settle cleanly goes to a
 * person (core.human_reviews), never to an automatic refusal: a holding
 * company, a stale register or a trading name are common and innocent.
 */

export const BIOMETRIC_CONSENT_TEXT_VERSION = "biometric-consent-v1";

/** The words the person agrees to before any ID or selfie is sent. */
export const BIOMETRIC_CONSENT_TEXT =
  "I agree that Capital Q may send my government ID details and a live selfie to its verification provider to confirm who I am. The provider compares my face with my ID photo. Capital Q keeps only the result, never my ID number or my selfie, and investors see only that I am verified.";

export type LinkInput = {
  readonly registry: RegistryRecord | null;
  readonly identity: IdentityCheck | null;
  readonly consent: BiometricConsent | null;
};

export type LinkMissing = "REGISTRY" | "IDENTITY" | "CONSENT";

export type LinkReviewReason =
  | "REGISTRY_NOT_ACTIVE"
  | "ID_NOT_VERIFIED"
  | "SELFIE_NOT_MATCHED"
  | "NO_NAME_ON_ID"
  | "NAME_PARTLY_MATCHES"
  | "NOT_AN_OFFICER"
  | "FORMER_OFFICER_ONLY";

export type LinkOutcome =
  | {
      readonly kind: "FOUNDER_ID_VERIFIED";
      readonly officer: Pick<RegistryOfficer, "name" | "role">;
    }
  | { readonly kind: "REVIEW"; readonly reasons: readonly LinkReviewReason[] }
  | { readonly kind: "NOT_READY"; readonly missing: readonly LinkMissing[] };

const LINKING_ROLES: ReadonlySet<RegistryOfficer["role"]> = new Set([
  "DIRECTOR",
  "SHAREHOLDER",
  "PSC",
]);

export function linkFounder(input: LinkInput): LinkOutcome {
  const missing: LinkMissing[] = [];
  if (input.consent === null) missing.push("CONSENT");
  if (input.registry === null) missing.push("REGISTRY");
  if (
    input.identity === null ||
    input.identity.idVerified === null ||
    input.identity.selfieMatched === null
  ) {
    missing.push("IDENTITY");
  }
  if (missing.length > 0) return { kind: "NOT_READY", missing };
  // Both present (narrowed above for the type checker).
  const registry = input.registry;
  const identity = input.identity;
  if (registry === null || identity === null) {
    return { kind: "NOT_READY", missing: ["REGISTRY", "IDENTITY"] };
  }

  const reasons: LinkReviewReason[] = [];
  if (registry.status !== "ACTIVE") reasons.push("REGISTRY_NOT_ACTIVE");
  if (identity.idVerified !== true) reasons.push("ID_NOT_VERIFIED");
  if (identity.selfieMatched !== true) reasons.push("SELFIE_NOT_MATCHED");

  const name = identity.nameOnId;
  if (name === null) {
    reasons.push("NO_NAME_ON_ID");
    return { kind: "REVIEW", reasons };
  }
  const candidates = registry.officers.filter((officer) =>
    LINKING_ROLES.has(officer.role),
  );
  const graded = candidates.map((officer) => ({
    officer,
    match: matchNames(name, officer.name),
  }));
  const best = (wanted: NameMatch, current: boolean) =>
    graded.find(
      (entry) => entry.match === wanted && entry.officer.current === current,
    );
  const exactNow = best("MATCH", true);
  if (exactNow === undefined) {
    if (best("MATCH", false) !== undefined) {
      reasons.push("FORMER_OFFICER_ONLY");
    } else if (
      best("PARTIAL", true) !== undefined ||
      best("PARTIAL", false) !== undefined
    ) {
      reasons.push("NAME_PARTLY_MATCHES");
    } else {
      reasons.push("NOT_AN_OFFICER");
    }
  }
  if (reasons.length > 0 || exactNow === undefined) {
    return { kind: "REVIEW", reasons };
  }
  return {
    kind: "FOUNDER_ID_VERIFIED",
    officer: { name: exactNow.officer.name, role: exactNow.officer.role },
  };
}

const REASON_WORDS: Readonly<Record<LinkReviewReason, string>> = {
  REGISTRY_NOT_ACTIVE: "the register does not show the company as active",
  ID_NOT_VERIFIED: "the ID document was not verified",
  SELFIE_NOT_MATCHED: "the live selfie did not match the ID photo",
  NO_NAME_ON_ID: "the provider returned no name on the ID",
  NAME_PARTLY_MATCHES: "the name on the ID only partly matches an officer",
  NOT_AN_OFFICER:
    "the name on the ID is not among the directors, shareholders or PSCs",
  FORMER_OFFICER_ONLY: "the name on the ID matches only a former officer",
};

/** The review's reason, from the provider extract only (never a model's view). */
export function linkReviewReason(reasons: readonly LinkReviewReason[]): string {
  return `Founder ID link needs a person: ${reasons.map((r) => REASON_WORDS[r]).join("; ")}.`;
}

/**
 * The decision basis recorded on the VERIFIED claim: what was checked, in
 * prose for the audit reader. Never the ID number, never the selfie. The
 * biometric consent it relied on is its own record
 * (evidence.verification_consents), never words in here.
 */
export function linkDecisionBasis(input: {
  readonly registry: RegistryRecord;
  readonly officer: Pick<RegistryOfficer, "name" | "role">;
  readonly identityProvider: string;
}): string {
  return [
    `register ${input.registry.jurisdictionCode} ${input.registry.registrationNumber}: ${input.registry.status}`,
    `ID and live selfie verified by ${input.identityProvider}`,
    `name on ID matches ${input.officer.role.toLowerCase()} on the register`,
  ]
    .join("; ")
    .slice(0, 1000);
}
