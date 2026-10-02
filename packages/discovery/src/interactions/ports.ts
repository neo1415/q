import type {
  InteractionEvent,
  InteractionExposure,
  InteractionState,
  InteractionSurface,
  InteractionType,
  PassReason,
  WatchMilestone,
} from "./contracts.js";

/**
 * What the interaction layer reads and writes.
 *
 * Every field the server is responsible for is already resolved by the time
 * anything here is called: the actor, their investor organisation, the
 * company's tenant, and the slate context. A repository takes facts, not
 * claims.
 */

/** One event to append. Authoritative context only; nothing client-supplied. */
export type NewInteractionEvent = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly investorOrganisationId: string;
  readonly companyId: string;
  readonly companyTenantId: string;
  readonly interactionType: InteractionType;
  readonly surface: InteractionSurface;
  /** Server-resolved from the slate, or null when the surface had none. */
  readonly exposure: InteractionExposure | null;
  readonly mediaAssetId: string | null;
  readonly watchMilestone: WatchMilestone | null;
  readonly passReason: PassReason | null;
  readonly clientEventId: string;
  readonly sessionId: string | null;
  readonly occurredAt: string;
};

export type InteractionRepository = {
  /**
   * Append one event, or return the one an earlier identical report already
   * created. `deduplicated` distinguishes the two, because a retry that
   * silently looked like a fresh interaction would inflate exposure.
   */
  readonly append: (event: NewInteractionEvent) => Promise<{
    readonly event: InteractionEvent;
    readonly deduplicated: boolean;
  }>;
  /**
   * Apply an event to the derived state, in the same transaction that
   * appended it. Returns the state as it now stands.
   */
  readonly project: (event: InteractionEvent) => Promise<InteractionState>;
  /** One investor's state for a bounded set of companies. Absent ids are absent. */
  readonly stateForCompanies: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlyMap<string, InteractionState>>;
  /** Saved company identities, most recently saved first. Bounded. */
  readonly savedCompanyIds: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly limit: number;
  }) => Promise<readonly string[]>;
  /** Passed company identities, most recently passed first. Bounded. */
  readonly passedCompanyIds: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly limit: number;
  }) => Promise<readonly string[]>;
  /** One investor's history of one company, newest first. Bounded. */
  readonly historyForCompany: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly companyId: string;
    readonly limit: number;
  }) => Promise<readonly InteractionEvent[]>;
};

/**
 * Where an interaction's slate context comes from.
 *
 * The caller names a slate item; this resolves what that item actually is —
 * which slate, which company, which rank, under which ranking versions —
 * and returns null when the item is not this investor's. A position that
 * arrives from a browser is a suggestion; this is the fact.
 */
export type InteractionExposurePort = {
  readonly resolve: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly slateId: string;
    readonly companyId: string;
  }) => Promise<{
    readonly exposure: InteractionExposure;
    readonly companyTenantId: string;
  } | null>;
};

/** A company this investor may currently act on, and its tenant. */
export type InteractionCompanyPort = {
  readonly companyTenantId: (query: {
    readonly investorTenantId: string;
    readonly companyId: string;
  }) => Promise<string | null>;
};
