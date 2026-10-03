import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * A founder's own readiness, read for them when they ask what to do next
 * (QA 2026-10-03, run 2cba241a: "what should I do next" got a detail about
 * one market while the company was private, had no deck and was not
 * verified). The gaps that keep investors from finding and trusting the
 * company come first, in the order they matter, from the readiness
 * assessment itself -- never guessed, never a phrase list.
 */

/** Most decisive first: unseen beats unproven beats unverified. */
const ORDER: readonly string[] = [
  "DISCOVERY_VISIBILITY_CONFIRMED",
  "MINIMUM_COMPANY_PROFILE",
  "REQUIRED_DOCUMENTATION",
  "FOUNDER_IDENTITY_VERIFIED",
  "ORGANISATION_VERIFIED",
  "COMPANY_ACTIVE",
];

type Requirement = {
  readonly requirement?: unknown;
  readonly outcome?: unknown;
  readonly description?: unknown;
};
type Assessment = {
  readonly state?: unknown;
  readonly verificationAvailable?: unknown;
  readonly requirements?: readonly Requirement[];
  readonly discoverability?: {
    readonly sectorDeclared?: unknown;
    readonly stageDeclared?: unknown;
    readonly countryDeclared?: unknown;
  };
};

/** From read_my_record MARKETPLACE_READINESS output ({status, data}). */
export function ownReadinessFact(
  read: unknown,
  options: { readonly lead: boolean },
): AuthorisedFact | null {
  if (typeof read !== "object" || read === null) return null;
  const { status, data } = read as { status?: unknown; data?: unknown };
  if (status !== "FOUND" || typeof data !== "object" || data === null) {
    return null;
  }
  const assessment = data as Assessment;
  const verifiable = assessment.verificationAvailable !== false;
  const open = (assessment.requirements ?? [])
    .filter(
      (entry) =>
        (entry.outcome === "OUTSTANDING" || entry.outcome === "UNKNOWN") &&
        typeof entry.requirement === "string" &&
        typeof entry.description === "string",
    )
    // Verification nobody can complete yet is not a step to give them.
    .filter(
      (entry) =>
        verifiable ||
        (entry.requirement !== "FOUNDER_IDENTITY_VERIFIED" &&
          entry.requirement !== "ORGANISATION_VERIFIED"),
    )
    .sort(
      (a, b) =>
        ORDER.indexOf(String(a.requirement)) -
        ORDER.indexOf(String(b.requirement)),
    )
    .map((entry) => String(entry.description).slice(0, 200));
  const placement = assessment.discoverability;
  const undeclared = [
    placement?.sectorDeclared === false ? "sector" : null,
    placement?.stageDeclared === false ? "stage" : null,
    placement?.countryDeclared === false ? "country" : null,
  ].filter((item): item is string => item !== null);
  const ready = assessment.state === "marketplace_ready";
  const lines = [
    ready
      ? "Their company is marketplace-ready: investors can find it in Discover."
      : "Their company is NOT marketplace-ready: investors' feeds do not show it yet.",
    ...(open.length === 0
      ? []
      : [
          `Outstanding, most important first: ${open
            .map((line, index) => `${String(index + 1)}) ${line}`)
            .join(" ")}`,
        ]),
    ...(undeclared.length === 0
      ? []
      : [
          `Not declared, so investors' rules cannot place it: ${undeclared.join(", ")}.`,
        ]),
    ...(verifiable
      ? []
      : [
          "Verification cannot be completed by anyone yet; do not suggest it as a step.",
        ]),
  ];
  const lead = options.lead
    ? " THEY ASKED WHAT TO DO NEXT: lead with these gaps in this order (and a missing pitch video or deck from what exists on their account), each with the one action that closes it, offering to do it; mention anything else only after."
    : "";
  return {
    scope: "COMPANY_PROFILE",
    statement:
      `THEIR OWN READINESS (read for them this turn from Capital Q's readiness check): ${lines.join(" ")}${lead}`.slice(
        0,
        1_800,
      ),
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source: "Capital Q readiness check",
  };
}
