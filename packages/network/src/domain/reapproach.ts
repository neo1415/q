/**
 * Re-approach after a pass (founder decision (b), 2026-10-02; doc 19 §67).
 *
 * A pass on a connected relationship hides the company from that
 * investor's Discover until something material changed -- never on a
 * timer, never from browsing:
 *
 *   MANDATE_CHANGED        the mandate the pass was made under is no longer
 *                          the active mandate (another mandate, or a new
 *                          version of it)
 *   MATERIAL_UPDATE        the company has evidence of something new: a
 *                          pitch that became playable after the pass (a row
 *                          timestamp is never a material update)
 *   NEW_CAPITAL_OBJECTIVE  the company set a new raise after the pass
 *
 * The fourth trigger, the investor resetting the pass, is a
 * relationship_resumed event: the relationship is no longer PASSED, so
 * nothing here is asked. Pure and deterministic; unknown evidence never
 * reopens anything.
 */

export type PassStanding = {
  readonly passedAt: string;
  /** The mandate it was made under; null when none was active or recorded. */
  readonly mandateId: string | null;
  readonly mandateVersion: number | null;
};

export type ReapproachEvidence = {
  /** The investor organisation's active mandate now, when known. */
  readonly mandate: {
    readonly mandateId: string;
    readonly version: number;
  } | null;
  readonly latestPitchReadyAt: string | null;
  readonly latestCapitalObjectiveAt: string | null;
};

export type ReapproachReason =
  "MANDATE_CHANGED" | "MATERIAL_UPDATE" | "NEW_CAPITAL_OBJECTIVE";

const after = (at: string | null, passedAt: string): boolean =>
  at !== null && Date.parse(at) > Date.parse(passedAt);

export function reapproachAfterPass(
  pass: PassStanding,
  evidence: ReapproachEvidence,
): ReapproachReason | null {
  // A mandate change is provable only when the pass recorded one and an
  // active mandate is known now; absence is never a change.
  if (
    pass.mandateId !== null &&
    pass.mandateVersion !== null &&
    evidence.mandate !== null &&
    (evidence.mandate.mandateId !== pass.mandateId ||
      evidence.mandate.version !== pass.mandateVersion)
  ) {
    return "MANDATE_CHANGED";
  }
  if (after(evidence.latestPitchReadyAt, pass.passedAt)) {
    return "MATERIAL_UPDATE";
  }
  if (after(evidence.latestCapitalObjectiveAt, pass.passedAt)) {
    return "NEW_CAPITAL_OBJECTIVE";
  }
  return null;
}
