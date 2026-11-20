import type { VerificationMethod } from "@capital-q/contracts";

import { standingOf, type VerificationClaim } from "./claims.js";

/**
 * V1, the four badges (research §6.1), computed by code from the claim
 * history, never a flag someone flips:
 *
 *   EMAIL_VERIFIED       the domain claim verified (a code to the domain)
 *   REGISTRY_MATCHED     the organisation verified against the register
 *   FOUNDER_ID_VERIFIED  a founder's ID and selfie linked to an officer
 *   FULLY_VERIFIED       all three within 12 months, the bank account name
 *                        matched, and a Capital Q operator's sign-off
 *
 * A badge is a separate axis (ADR-001): it never raises truth class,
 * evidence status, readiness or ranking. No badge is UNKNOWN: not yet
 * established, never "suspicious". Investors see the badge, its date and
 * its method class, never an ID document, number or selfie.
 */
export const VERIFICATION_BADGES = [
  "EMAIL_VERIFIED",
  "REGISTRY_MATCHED",
  "FOUNDER_ID_VERIFIED",
  "FULLY_VERIFIED",
] as const;
export type VerificationBadge = (typeof VERIFICATION_BADGES)[number];

export const FULL_VERIFICATION_WINDOW_DAYS = 365;

/** What an investor may see of a badge: label, date, method class. */
export type BadgeView = {
  readonly badge: VerificationBadge;
  readonly label: string;
  readonly verifiedAt: string;
  readonly method: VerificationMethod;
};

export type VerificationTier = {
  /** The strongest badge held, or UNKNOWN: not yet established. */
  readonly tier: VerificationBadge | "UNKNOWN";
  readonly badges: readonly BadgeView[];
  /** Each founder verifies separately: "2 of 3", never rounded up. */
  readonly founders: {
    readonly verified: number;
    readonly total: number | null;
  };
  readonly description: string;
};

const LABELS: Readonly<Record<VerificationBadge, string>> = {
  EMAIL_VERIFIED: "Email verified",
  REGISTRY_MATCHED: "Registry matched",
  FOUNDER_ID_VERIFIED: "Founder ID verified",
  FULLY_VERIFIED: "Fully verified",
};

type Held = { readonly method: VerificationMethod; readonly at: string };

/**
 * The methods that verified one subject and still stand: the decisions
 * since the last revocation or expiry, each in date. A PENDING request
 * leaves earlier decisions standing.
 */
function standingMethods(
  history: readonly VerificationClaim[],
  now: Date,
): readonly Held[] {
  const ordered = [...history].sort((a, b) => a.revision - b.revision);
  let held: Held[] = [];
  for (const claim of ordered) {
    if (claim.status === "REVOKED" || claim.status === "EXPIRED") held = [];
    else if (
      claim.status === "VERIFIED" &&
      claim.method !== null &&
      claim.verifiedAt !== null &&
      standingOf(claim, now) === "VERIFIED"
    ) {
      held.push({ method: claim.method, at: claim.verifiedAt });
    }
  }
  return held;
}

const latest = (held: readonly Held[]): Held | null =>
  held.reduce<Held | null>(
    (best, one) => (best === null || one.at > best.at ? one : best),
    null,
  );

const withMethod = (
  held: readonly Held[],
  methods: readonly VerificationMethod[],
): Held | null => latest(held.filter((one) => methods.includes(one.method)));

export function verificationTier(input: {
  /** Every claim revision of the organisation, its domain and its founders. */
  readonly history: readonly VerificationClaim[];
  readonly organisationId: string;
  /** Founders on the company, when known; null: not known. */
  readonly foundersTotal?: number | null | undefined;
  readonly now: Date;
}): VerificationTier {
  const { history, now } = input;
  const bySubject = new Map<string, VerificationClaim[]>();
  for (const claim of history) {
    const key = `${claim.claimType}:${claim.subjectKey}`;
    bySubject.set(key, [...(bySubject.get(key) ?? []), claim]);
  }
  const subjects = (type: VerificationClaim["claimType"]) =>
    [...bySubject.values()].filter((claims) => claims[0]?.claimType === type);

  // A DOMAIN_EMAIL decision, or an operator's, on any of its domains.
  const email = latest(
    subjects("DOMAIN_CONTROL").flatMap((claims) => {
      const one = withMethod(standingMethods(claims, now), [
        "DOMAIN_EMAIL",
        "OPERATOR_DECISION",
      ]);
      return one === null ? [] : [one];
    }),
  );
  const organisation = standingMethods(
    subjects("ORGANISATION")
      .flat()
      .filter((claim) => claim.subjectId === input.organisationId),
    now,
  );
  // An operator's decision stands for a register they checked by hand
  // (a jurisdiction with no API, research §6.3).
  const registry = withMethod(organisation, [
    "REGISTRY_LOOKUP",
    "OPERATOR_DECISION",
  ]);
  const bank = withMethod(organisation, ["BANK_NAME_MATCH"]);
  const signOff = withMethod(organisation, ["OPERATOR_DECISION"]);

  // A founder is linked by the rule (DIRECTOR_MATCH) or by an operator.
  const founderLinks = subjects("FOUNDER_IDENTITY").flatMap((claims) => {
    const one = withMethod(standingMethods(claims, now), [
      "DIRECTOR_MATCH",
      "OPERATOR_DECISION",
    ]);
    return one === null ? [] : [one];
  });
  const founder = latest(founderLinks);

  const badges: BadgeView[] = [];
  const add = (badge: VerificationBadge, held: Held | null) => {
    if (held !== null) {
      badges.push({
        badge,
        label: LABELS[badge],
        verifiedAt: held.at,
        method: held.method,
      });
    }
  };
  add("EMAIL_VERIFIED", email);
  add("REGISTRY_MATCHED", registry);
  // The founder link is to the register: no register, no founder badge.
  add("FOUNDER_ID_VERIFIED", registry === null ? null : founder);
  const windowStart =
    now.getTime() - FULL_VERIFICATION_WINDOW_DAYS * 86_400_000;
  const recent = (held: Held | null) =>
    held !== null && Date.parse(held.at) >= windowStart;
  if (
    recent(email) &&
    recent(registry) &&
    registry !== null &&
    recent(founder) &&
    bank !== null &&
    signOff !== null &&
    signOff.at >=
      (latest(
        [email, registry, founder, bank].flatMap((h) =>
          h === null ? [] : [h],
        ),
      )?.at ?? "")
  ) {
    add("FULLY_VERIFIED", signOff);
  }

  const order: readonly VerificationBadge[] = [
    "FULLY_VERIFIED",
    "FOUNDER_ID_VERIFIED",
    "REGISTRY_MATCHED",
    "EMAIL_VERIFIED",
  ];
  const tier =
    order.find((badge) => badges.some((b) => b.badge === badge)) ?? "UNKNOWN";
  const total = input.foundersTotal ?? null;
  return {
    tier,
    badges,
    // Linked to a register only when there is one on record.
    founders: { verified: registry === null ? 0 : founderLinks.length, total },
    description:
      tier === "UNKNOWN"
        ? "Verification not yet established."
        : badges.map((badge) => badge.label).join(" · "),
  };
}

/** The founders line: "2 of 3 founders verified"; never rounded up. */
export function foundersLine(
  founders: VerificationTier["founders"],
): string | null {
  if (founders.total === null || founders.total === 0) {
    return founders.verified === 0
      ? null
      : `${String(founders.verified)} founder${founders.verified === 1 ? "" : "s"} verified`;
  }
  return `${String(Math.min(founders.verified, founders.total))} of ${String(founders.total)} founders verified`;
}
