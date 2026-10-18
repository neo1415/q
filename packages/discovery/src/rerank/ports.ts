/**
 * What REC-009 may learn about an investor organisation's history with a
 * company — and, much more importantly, what it may not.
 *
 * REC-008 records a great deal: impression counts, watch milestones, save
 * state, pass reasons, Ask-Q events, timestamps for each. Almost none of
 * that may reach a reordering decision, because a count is a magnitude and
 * a magnitude in a ranking pipeline is a popularity signal however it was
 * named (§10, §14; doc 19 §83). So the boundary is the shape of this port
 * rather than a rule somebody has to remember: three facts, none of them a
 * number, and there is no field here for "how many" or "how long".
 *
 * Saved state is absent for the same reason and one more: Save is an
 * investor's own bookmark, served from the Saved list, and it must never
 * move a company for them or for anybody else. The way to guarantee that
 * is to make it unavailable at this stage.
 *
 * The state is keyed by investor organisation, as REC-008 stores it, so it
 * is already organisation-safe (CQ-PERM-ORG-VIEW-001). The actor stays on
 * the event for accountability and never arrives here.
 */
export type RerankSignals = {
  /** This organisation has been shown the company at least once. */
  readonly exposed: boolean;
  /** When, if ever. One instant, compared once; never accumulated. */
  readonly lastSeenAt: string | null;
  /** This organisation passed on it. */
  readonly passed: boolean;
};

export type RerankSignalsPort = {
  /**
   * One investor organisation's signals for a bounded set of companies, in
   * one call. Companies with no history are simply absent, and absence is
   * read as "never shown, never passed" — the correct answer for a company
   * nobody has seen yet, and the reason a cold-start company is not
   * penalised (doc 19 §80).
   */
  readonly forCompanies: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlyMap<string, RerankSignals>>;
};

/**
 * Where a proven reason to offer a passed company again comes from.
 *
 * Only evidenced changes, never a row timestamp (§12): today, a new pitch
 * that became playable after the pass (`createPitchReintroductions`). An
 * explicit reset is UNPASS, which clears the pass itself. `change` names
 * what is new, for the card's "since you last saw it" line.
 */
export type PassReintroduction = {
  readonly reason: string;
  /** What changed, as a bounded code (NEW_PITCH). */
  readonly change: string | null;
};
export type PassReintroductionPort = {
  readonly reasonsFor: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly mandateVersion: number;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlyMap<string, string | PassReintroduction>>;
};
