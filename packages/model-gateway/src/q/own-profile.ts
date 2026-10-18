import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * The person's own declared investor profile as one authorised fact
 * (CQ-QX-007; acceptance directive, "Home Q doesn't know the person").
 *
 * Built from the `get_investor_mandate` result, which the tool serves only
 * to the organisation's owner under a firewall-bound INVESTOR_MANDATE
 * scope. It goes in front of the model among the AUTHORISED FACTS — the
 * section the charter tells it to answer from — rather than as a trailing
 * note: live, an investor whose profile arrived only as a note asked "who
 * am I?" and was told only their first name.
 *
 * Only what was declared: an absent criterion is left out rather than
 * written as "any", because unknown is not open; a draft says it is one.
 */
type MandateRead = {
  readonly displayName?: string;
  readonly investorType?: string | null;
  readonly deploymentState?: string | null;
  readonly mandates?: readonly {
    readonly status?: string;
    readonly cheque?: {
      readonly currency: string;
      readonly min?: string;
      readonly typical?: string;
      readonly max?: string;
    } | null;
    readonly stage?: {
      readonly minStageCode: string | null;
      readonly maxStageCode: string | null;
    };
    readonly constraints?: readonly {
      readonly dimension: string;
      readonly operator: string;
      readonly value: unknown;
      readonly isHardExclusion: boolean;
    }[];
    readonly taxonomyPreferences?: readonly {
      readonly canonicalCode: string;
      readonly isExclusion: boolean;
    }[];
  }[];
};

const words = (code: string): string => code.toLowerCase().replace(/_/g, " ");

function mandateParts(mandate: NonNullable<MandateRead["mandates"]>[number]) {
  const parts: string[] = [];
  const cheque = mandate.cheque ?? null;
  if (cheque !== null) {
    const bounds = [cheque.min, cheque.max].filter(
      (value): value is string => value !== undefined,
    );
    const typical =
      cheque.typical === undefined ? "" : ` (typical ${cheque.typical})`;
    if (bounds.length > 0 || typical.length > 0) {
      parts.push(`cheque ${bounds.join(" to ")}${typical} ${cheque.currency}`);
    }
  }
  const stage = mandate.stage ?? { minStageCode: null, maxStageCode: null };
  if (stage.minStageCode !== null || stage.maxStageCode !== null) {
    parts.push(
      `stages ${stage.minStageCode ?? "not stated"} to ${stage.maxStageCode ?? "not stated"}`,
    );
  }
  // Read defensively: this is a tool result, and a field it did not carry
  // is a criterion not declared, never a crash.
  const preferences = mandate.taxonomyPreferences ?? [];
  const preferred = preferences
    .filter((preference) => !preference.isExclusion)
    .map((preference) => preference.canonicalCode);
  const excluded = preferences
    .filter((preference) => preference.isExclusion)
    .map((preference) => preference.canonicalCode);
  if (preferred.length > 0) parts.push(`focus ${preferred.join(", ")}`);
  if (excluded.length > 0) parts.push(`excludes ${excluded.join(", ")}`);
  for (const constraint of (mandate.constraints ?? []).slice(0, 20)) {
    parts.push(
      `${constraint.dimension.toLowerCase()} ${constraint.operator.toLowerCase()} ${JSON.stringify(constraint.value)}${constraint.isHardExclusion ? " (hard exclusion)" : ""}`,
    );
  }
  return parts;
}

/** The declared mandate alone, as one plain statement; null when nothing is declared. */
export function mandateStatement(data: unknown): string | null {
  const read = data as MandateRead;
  const mandate = read.mandates?.[0];
  if (mandate === undefined) return null;
  const parts = mandateParts(mandate);
  if (parts.length === 0) return null;
  const whose = read.displayName === undefined ? "" : ` (${read.displayName})`;
  const draft = mandate.status === "DRAFT" ? ", still a draft" : "";
  return `The person's own declared investment mandate${whose}${draft}: ${parts.join("; ")}.`.slice(
    0,
    4_000,
  );
}

/** Their whole declared investor profile as one authorised fact; null when the result says nothing. */
export function ownProfileFact(data: unknown): AuthorisedFact | null {
  const read = data as MandateRead;
  const who: string[] = [];
  if (typeof read.displayName === "string" && read.displayName.length > 0) {
    who.push(`their investor organisation is ${read.displayName}`);
  }
  if (typeof read.investorType === "string") {
    who.push(`they invest as ${words(read.investorType)}`);
  }
  if (typeof read.deploymentState === "string") {
    who.push(`deployment: ${words(read.deploymentState)}`);
  }
  const mandate = read.mandates?.[0];
  const parts = mandate === undefined ? [] : mandateParts(mandate);
  const mandateLine =
    mandate === undefined
      ? "no mandate declared yet"
      : `${mandate.status === "DRAFT" ? "draft mandate (still being declared)" : "mandate"}: ${parts.length === 0 ? "no criteria declared yet" : parts.join("; ")}`;
  if (who.length === 0 && mandate === undefined) return null;
  return {
    scope: "INVESTOR_MANDATE",
    statement:
      `The person's own declared investor profile — ${[...who, mandateLine].join("; ")}.`.slice(
        0,
        4_000,
      ),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "your own declared investor profile",
  };
}
