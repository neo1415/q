import type { MeetingOutcomes } from "./meeting-outcomes.js";

/**
 * S6 (R8): what Capital Q's admin receives about a meeting it facilitated
 * -- the facilitation record its fee rests on, never the call itself.
 *
 * Counts and figures only: that the meeting was held (when, how long when
 * the provider said), money signals by level with their amounts, the
 * requests made (items, no quotes), and the next step agreed. No
 * transcript, no quote, no summary, no flags: either side's private Q
 * analysis and what was said word for word stay with the two sides
 * (Context Firewall). A signal is not money: the admin sees it as said.
 */
export type MeetingDigest = {
  readonly meetingId: string;
  readonly relationshipId: string;
  readonly heldAt: string;
  /** From the provider's timestamps; null when it gave none. */
  readonly durationSeconds: number | null;
  readonly softSignals: number;
  readonly hardSignals: number;
  readonly amounts: readonly {
    readonly level: "SOFT" | "HARD";
    readonly amount: string;
    readonly currencyCode: string | null;
  }[];
  readonly requests: number;
  readonly requestItems: readonly string[];
  readonly nextStep: string | null;
};

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function meetingDigestOf(input: {
  readonly meetingId: string;
  readonly relationshipId: string;
  readonly startsAt: Date;
  readonly outcomes: MeetingOutcomes;
  /** Seconds from the recording's start of each heard line, when given. */
  readonly lineTimes: readonly (number | null | undefined)[];
  /** The first agreed next step from the record both sides read. */
  readonly nextStep: string | null;
}): MeetingDigest {
  const { commitments, requests } = input.outcomes;
  const times = input.lineTimes.filter(
    (t): t is number => typeof t === "number" && Number.isFinite(t) && t >= 0,
  );
  return {
    meetingId: input.meetingId,
    relationshipId: input.relationshipId,
    heldAt: input.startsAt.toISOString(),
    durationSeconds: times.length === 0 ? null : Math.round(Math.max(...times)),
    softSignals: commitments.filter((c) => c.level === "SOFT").length,
    hardSignals: commitments.filter((c) => c.level === "HARD").length,
    amounts: commitments.flatMap((c) =>
      c.amount === null
        ? []
        : [{ level: c.level, amount: c.amount, currencyCode: c.currencyCode }],
    ),
    requests: requests.length,
    requestItems: requests.map((r) => clip(r.item, 120)).slice(0, 10),
    nextStep: input.nextStep === null ? null : clip(input.nextStep, 200),
  };
}
