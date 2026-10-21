import type { ActivityCursor, ActivitySource } from "../domain/activity.js";
import type { InvitationStatus } from "../domain/team.js";

/**
 * The organisation-admin reads' storage port. Every method takes the
 * organisation (and tenant) the SERVICE resolved from the actor context;
 * nothing here is ever handed a client-supplied organisation.
 */

export type ActivityFilter = {
  readonly tenantId: string;
  readonly organisationId: string;
  /** Rows this person did, or Q did under their authority. */
  readonly userId?: string | undefined;
  /** LIKE patterns over the effective action type; empty: no constraint. */
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Never-shown patterns (always applied). */
  readonly privatePatterns: readonly string[];
  /** Q lifecycle codes that are shown, as the action they carried out. */
  readonly qExecutedTypes: readonly string[];
  /** Relationship event types that are stage moves. */
  readonly stageEventTypes: readonly string[];
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly before?: ActivityCursor | undefined;
  readonly limit: number;
};

/**
 * One feed row from the union of three sources, in one order:
 *   a  audit.material_actions (accountability, including Q under authority)
 *   e  network.relationship_events a person of this organisation acted in
 *      (never personal_private), as relationship.stage.change or
 *      relationship.event.<type>
 *   n  network.relationship_notes of this organisation's side, as
 *      relationship.note.add / relationship.note.correct
 */
export type ActivityRecord = {
  readonly source: ActivitySource;
  /** Internal keyset key within its source, for the cursor only. */
  readonly key: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly actorType: "human" | "q" | "capital_q_system" | "connected_system";
  readonly actorId: string | null;
  readonly authorityUserId: string | null;
  /** The recorded action type. */
  readonly actionType: string;
  /** For a Q-executed action, the action it carried out; else actionType. */
  readonly effectiveActionType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: "SUCCEEDED" | "FAILED" | "DENIED";
  /**
   * Only the whitelisted, small keys the feed may use (a role change's
   * from/to). The store never returns the rest of the metadata.
   */
  readonly roleFrom: string | null;
  readonly roleTo: string | null;
  /** A stage event's previous stage event type on the same relationship, and its own. */
  readonly stageFrom: string | null;
  readonly stageTo: string | null;
};

export type ActivityPerson = {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
};

export type ResourceRef = { readonly type: string; readonly id: string };

export type ResolvedResource = {
  readonly label: string;
  readonly link: string | null;
  readonly change?: {
    readonly before: string | null;
    readonly after: string | null;
  } | null;
};

export type MemberRecord = {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly status: "active" | "left" | "revoked";
  readonly joinedAt: string;
  readonly leftAt: string | null;
  /** Current role codes (valid now). */
  readonly roleCodes: readonly string[];
};

export type RoleSpan = {
  readonly roleCode: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
};

export type SentInvitation = {
  readonly invitationId: string;
  readonly email: string;
  readonly roleCode: string;
  readonly status: InvitationStatus;
  readonly sentAt: string;
  readonly expiresAt: string;
};

export type TouchedRelationship = {
  readonly relationshipId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
  /** Which side of it is this organisation's. */
  readonly side: "COMPANY" | "INVESTOR";
  readonly counterpartName: string | null;
  readonly lastTouchedAt: string;
  readonly events: number;
  readonly notes: number;
};

export type OrganisationAdminStore = {
  readonly activity: (
    filter: ActivityFilter,
  ) => Promise<readonly ActivityRecord[]>;
  /**
   * People who are, or were, members of this organisation, by user id.
   * Anyone else is absent: their name is not this admin's to see.
   */
  readonly people: (
    organisationId: string,
    userIds: readonly string[],
  ) => Promise<ReadonlyMap<string, ActivityPerson>>;
  /**
   * Labels for resources on this organisation's own side only. With
   * `relationshipsVisible` false, a relationship or counterpart is never
   * named. Anything it cannot place is absent (the service labels it
   * generically).
   */
  readonly resources: (input: {
    readonly tenantId: string;
    readonly organisationId: string;
    readonly refs: readonly ResourceRef[];
    readonly relationshipsVisible: boolean;
  }) => Promise<ReadonlyMap<string, ResolvedResource>>;
  /** The person's latest membership of this organisation, any status. */
  readonly member: (
    organisationId: string,
    userId: string,
  ) => Promise<MemberRecord | null>;
  readonly roleHistory: (membershipId: string) => Promise<readonly RoleSpan[]>;
  readonly invitationsSent: (
    organisationId: string,
    userId: string,
  ) => Promise<readonly SentInvitation[]>;
  /** Their latest shown action for this organisation, and per-type counts since. */
  readonly memberActivity: (input: {
    readonly tenantId: string;
    readonly organisationId: string;
    readonly userId: string;
    readonly since: string;
    readonly privatePatterns: readonly string[];
    readonly qExecutedTypes: readonly string[];
    readonly stageEventTypes: readonly string[];
  }) => Promise<{
    readonly lastActiveAt: string | null;
    readonly counts: readonly {
      readonly effectiveActionType: string;
      readonly count: number;
    }[];
  }>;
  /**
   * Relationships this person touched (relationship events they acted in,
   * notes they wrote) where this organisation is a party, on this
   * organisation's side only; never a personal_private event.
   */
  readonly relationshipsTouched: (input: {
    readonly tenantId: string;
    readonly organisationId: string;
    readonly userId: string;
  }) => Promise<readonly TouchedRelationship[]>;
};

export const resourceKey = (ref: ResourceRef): string =>
  `${ref.type}:${ref.id}`;
