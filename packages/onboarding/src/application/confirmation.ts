import { createHash } from "node:crypto";

import {
  OnboardingConfirmationGroupSchema,
  type OnboardingConfirmationGroup,
  type OnboardingConfirmationItem,
  type OnboardingCoverage,
  type OnboardingCoverageSource,
} from "@capital-q/contracts";

/**
 * Grouped confirmations and their copy, parameterised by language (lane ob1;
 * lane ml plugs other languages in by adding a catalog, never by editing
 * the logic). The copy is presentation only: which facts are in a group,
 * and what accepting it writes, are decided by code from coverage.
 */

export type OnboardingCopyCatalog = {
  /** "I have these from your deck: A; B. Shall I save them?" */
  readonly confirmGroup: (input: {
    readonly items: readonly {
      readonly label: string;
      readonly display: string;
    }[];
    readonly sources: readonly OnboardingCoverageSource[];
  }) => string;
  /** Acknowledges what was actually saved; never claims more. */
  readonly saved: (labels: readonly string[]) => string;
  /** A confirmed change could not be saved yet; it is held and retried. */
  readonly heldForRetry: (labels: readonly string[]) => string;
  /** A sensitive document: received, recorded by its details, not read. */
  readonly documentAcknowledged: (input: {
    readonly filename: string;
    readonly outstanding: readonly string[];
  }) => string;
  /** A public finding put to the person; never presented as verified. */
  readonly researchProposal: (input: {
    readonly label: string;
    readonly display: string;
    readonly where: string;
  }) => string;
};

const list = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function sourcePhrase(sources: readonly OnboardingCoverageSource[]): string {
  const unique = [...new Set(sources)];
  const only = unique.length === 1 ? unique[0] : undefined;
  if (only === "DOCUMENT") return "from your document";
  if (only === "PUBLIC_RESEARCH") return "from public pages (not verified)";
  if (only === "CONVERSATION" || only === "Q_RECOMMENDATION") {
    return "from what you told me";
  }
  return "from what I have so far";
}

export const ENGLISH_ONBOARDING_COPY: OnboardingCopyCatalog = {
  confirmGroup: ({ items, sources }) =>
    `Here is what I have ${sourcePhrase(sources)}: ${items
      .map((i) => `${i.label}: ${i.display}`)
      .join(
        "; ",
      )}. Shall I save ${items.length === 1 ? "it" : "these"}, or is anything wrong?`,
  saved: (labels) =>
    labels.length === 0 ? "Nothing new was saved." : `Saved: ${list(labels)}.`,
  heldForRetry: (labels) =>
    `I couldn't save ${list(labels)} just now. Nothing is lost: I'm holding ${labels.length === 1 ? "it" : "them"} and will save as soon as I can.`,
  documentAcknowledged: ({ filename, outstanding }) =>
    `I've received ${filename} and kept it private. I've recorded only its details and haven't read it.${
      outstanding.length === 0 ? "" : ` Still to cover: ${list(outstanding)}.`
    }`,
  researchProposal: ({ label, display, where }) =>
    `I found a public description ${where}: ${label}: ${display}. Is that still accurate?`,
};

/** Catalogs by primary language subtag. Lane ml adds "ar" here. */
export const ONBOARDING_COPY_CATALOGS: Readonly<
  Record<string, OnboardingCopyCatalog>
> = { en: ENGLISH_ONBOARDING_COPY };

/** The catalog for a BCP 47 tag, falling back to English. */
export function onboardingCopyFor(
  locale: string,
  catalogs: Readonly<
    Record<string, OnboardingCopyCatalog>
  > = ONBOARDING_COPY_CATALOGS,
): OnboardingCopyCatalog {
  const primary = locale.toLowerCase().split("-")[0] ?? "en";
  return catalogs[locale] ?? catalogs[primary] ?? ENGLISH_ONBOARDING_COPY;
}

/**
 * One grouped confirmation over every field with a value on offer, most
 * material first, at most `max`. The group id is a digest of the exact
 * suggestions in it, so the same group asked twice is the same group, and
 * accepting it twice writes nothing twice. Null when nothing is on offer.
 */
export function groupConfirmation(
  coverage: Pick<OnboardingCoverage, "fields" | "locale" | "sessionId">,
  options: {
    readonly max?: number | undefined;
    readonly catalogs?:
      Readonly<Record<string, OnboardingCopyCatalog>> | undefined;
    /** Restrict to these sources (e.g. only a just-read document). */
    readonly sources?: readonly OnboardingCoverageSource[] | undefined;
  } = {},
): OnboardingConfirmationGroup | null {
  const rank = { ESSENTIAL: 0, IMPORTANT: 1, OPTIONAL: 2 } as const;
  const allowed =
    options.sources === undefined ? null : new Set(options.sources);
  const items: OnboardingConfirmationItem[] = coverage.fields
    .filter(
      (f) =>
        f.applicable && f.state === "SUPPLIED_UNCONFIRMED" && !f.savePending,
    )
    .sort((a, b) => rank[a.priority] - rank[b.priority])
    .flatMap((f) => {
      const proposal = f.proposals.find(
        (p) => allowed === null || allowed.has(p.source),
      );
      return proposal === undefined
        ? []
        : [
            {
              fieldKey: f.fieldKey,
              suggestionId: proposal.suggestionId,
              label: f.label,
              display: proposal.display,
              source: proposal.source,
            },
          ];
    })
    .slice(0, options.max ?? 8);
  if (items.length === 0) return null;
  const groupId = `grp_${createHash("sha256")
    .update(coverage.sessionId)
    .update(
      items
        .map((i) => i.suggestionId)
        .sort()
        .join(","),
    )
    .digest("hex")
    .slice(0, 40)}`;
  const copy = onboardingCopyFor(coverage.locale, options.catalogs);
  return OnboardingConfirmationGroupSchema.parse({
    groupId,
    locale: coverage.locale,
    items,
    prompt: copy
      .confirmGroup({ items, sources: items.map((i) => i.source) })
      .slice(0, 2000),
  });
}

/** The idempotency key for one item of a group: stable across retries. */
export function confirmationItemKey(
  groupId: string,
  suggestionId: string,
): string {
  const hex = createHash("sha256")
    .update(`${groupId}:${suggestionId}`)
    .digest("hex");
  // UUID-shaped (v4 layout bits) so it passes the API's idempotency-key check.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
