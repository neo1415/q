import type { KybDto } from "@capital-q/contracts";

/**
 * "Verify you and <organisation>" (founder direction 2026-10-02): one flow
 * for the person's identity and their organisation. Pure, so the form, the
 * shell item and their tests read the same answers.
 */

export type VerifyParts = {
  /** The organisation's details are still wanted from the person. */
  readonly organisation: boolean;
  /** The person's identity details are still wanted. */
  readonly person: boolean;
};

/**
 * Which parts the form asks for. A part already verified, or whose details
 * are already with Capital Q, is left out -- so if one is decided, only the
 * other shows. A request Capital Q made on its own (AUTO) still asks for
 * the organisation's own details.
 */
export function verifyParts(kyb: KybDto): VerifyParts {
  const organisationSent =
    kyb.submission?.status === "SUBMITTED" &&
    kyb.submission.source === "PERSON";
  const personSent = kyb.person.submission?.status === "SUBMITTED";
  return {
    organisation: kyb.standing !== "VERIFIED" && !organisationSent,
    person: kyb.person.standing !== "VERIFIED" && !personSent,
  };
}

export type VerifyNudgeState =
  "NOT_STARTED" | "WITH_CAPITAL_Q" | "NEEDS_YOU" | "DECLINED";

export const VERIFY_NUDGE_WORDS: Readonly<Record<VerifyNudgeState, string>> = {
  NOT_STARTED: "Not started",
  WITH_CAPITAL_Q: "With Capital Q",
  NEEDS_YOU: "Needs something from you",
  DECLINED: "Declined — review",
};

export type VerifyNudge = {
  readonly title: string;
  readonly state: VerifyNudgeState;
};

/**
 * The shell's quiet reminder. Null once both the person and the
 * organisation are VERIFIED: it disappears by itself.
 */
export function verifyNudge(kyb: KybDto): VerifyNudge | null {
  const standings = [kyb.standing, kyb.person.standing];
  if (standings.every((standing) => standing === "VERIFIED")) return null;
  const title = `Verify you and ${kyb.organisationName ?? "your organisation"}`;
  if (standings.includes("REVOKED")) return { title, state: "DECLINED" };
  const parts = verifyParts(kyb);
  const asked = standings.some(
    (standing) => standing === "PENDING" || standing === "EXPIRED",
  );
  if (!parts.organisation && !parts.person) {
    return { title, state: "WITH_CAPITAL_Q" };
  }
  return { title, state: asked ? "NEEDS_YOU" : "NOT_STARTED" };
}
