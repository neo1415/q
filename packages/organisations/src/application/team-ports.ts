import type { CorrelationId, OrganisationType } from "@capital-q/contracts";

import type { InvitationStatus } from "../domain/team.js";

/**
 * G1/G2: what the team use cases need from storage, journal (audit and
 * domain events) and email. Generic over the transaction handle so the
 * service runs unchanged against Postgres and against the in-memory fake
 * its tests use. Every read and write names the organisation it acts in;
 * the service only ever passes the actor's own, resolved on the server.
 */

export type TeamOrganisationRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly type: OrganisationType;
  readonly name: string;
  readonly status: "active" | "suspended" | "closed";
};

export type TeamMemberRecord = {
  readonly membershipId: string;
  readonly userId: string;
  /** The person's chosen name; null when they have not given one. */
  readonly name: string | null;
  readonly email: string | null;
  readonly title: string | null;
  /** Currently valid role template codes. */
  readonly roleCodes: readonly string[];
  readonly joinedAt: string;
};

export type InvitationRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly email: string;
  readonly roleCode: string;
  readonly message: string | null;
  readonly status: InvitationStatus;
  readonly invitedByUserId: string;
  readonly invitedByName: string | null;
  readonly sentCount: number;
  readonly lastSentAt: Date;
  readonly expiresAt: Date;
  readonly acceptedMembershipId: string | null;
};

export type JoinRequestRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly message: string | null;
  readonly status: "pending" | "approved" | "declined" | "withdrawn";
  readonly createdAt: string;
};

export type OwnershipOfferRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly fromMembershipId: string;
  readonly toMembershipId: string;
  readonly status: "pending" | "accepted" | "declined" | "cancelled";
  readonly createdAt: string;
};

export type MyOrganisationRecord = {
  readonly organisationId: string;
  readonly name: string;
  readonly type: OrganisationType;
  readonly roleCodes: readonly string[];
  readonly memberCount: number;
  readonly active: boolean;
};

export type TeamStore<Tx> = {
  readonly transaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
  /**
   * The organisation, locked for the rest of the transaction: every team
   * change in one organisation is serialised, so the owner count the rules
   * read is the one that commits.
   */
  readonly lockOrganisation: (
    tx: Tx,
    organisationId: string,
  ) => Promise<TeamOrganisationRecord | null>;
  /** The same, without the lock: for reads (the team page, Q's index). */
  readonly organisation: (
    tx: Tx,
    organisationId: string,
  ) => Promise<TeamOrganisationRecord | null>;
  /** Active members with their current roles. */
  readonly members: (
    tx: Tx,
    organisationId: string,
  ) => Promise<readonly TeamMemberRecord[]>;
  readonly person: (
    tx: Tx,
    userId: string,
  ) => Promise<{ readonly name: string | null; readonly email: string | null }>;

  readonly pendingInvitations: (
    tx: Tx,
    organisationId: string,
  ) => Promise<readonly InvitationRecord[]>;
  readonly invitation: (
    tx: Tx,
    organisationId: string,
    invitationId: string,
  ) => Promise<InvitationRecord | null>;
  /** By the stored hash, locked; across organisations (the link names none). */
  readonly invitationByTokenHash: (
    tx: Tx,
    tokenHash: string,
  ) => Promise<InvitationRecord | null>;
  readonly insertInvitation: (
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly organisationId: string;
      readonly email: string;
      readonly roleCode: "admin" | "member";
      readonly message: string | null;
      readonly tokenHash: string;
      readonly invitedByUserId: string;
      readonly expiresAt: Date;
    },
  ) => Promise<string>;
  /** A new link and expiry; the old link stops working. */
  readonly rotateInvitation: (
    tx: Tx,
    invitationId: string,
    input: { readonly tokenHash: string; readonly expiresAt: Date },
  ) => Promise<void>;
  readonly decideInvitation: (
    tx: Tx,
    invitationId: string,
    input: {
      readonly status: "accepted" | "revoked";
      readonly decidedByUserId: string;
      readonly membershipId: string | null;
    },
  ) => Promise<void>;

  readonly insertMembership: (
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly organisationId: string;
      readonly userId: string;
      readonly invitedByUserId: string | null;
    },
  ) => Promise<string>;
  /**
   * Makes exactly `roleCodes` the membership's current team roles: ends the
   * team roles not in it, assigns the missing ones. Other roles untouched.
   */
  readonly setRoles: (
    tx: Tx,
    membershipId: string,
    roleCodes: readonly string[],
  ) => Promise<void>;
  /** Ends an active membership and its team roles (authority ends; history stays). */
  readonly endMembership: (
    tx: Tx,
    membershipId: string,
    status: "left" | "revoked",
  ) => Promise<void>;
  readonly activeContextOf: (tx: Tx, userId: string) => Promise<string | null>;
  readonly setActiveContext: (
    tx: Tx,
    userId: string,
    membershipId: string,
  ) => Promise<void>;
  readonly anotherActiveMembership: (
    tx: Tx,
    userId: string,
    exceptOrganisationId: string,
  ) => Promise<{
    readonly membershipId: string;
    readonly organisationId: string;
  } | null>;

  readonly pendingJoinRequests: (
    tx: Tx,
    organisationId: string,
  ) => Promise<readonly JoinRequestRecord[]>;
  readonly joinRequest: (
    tx: Tx,
    organisationId: string,
    requestId: string,
  ) => Promise<JoinRequestRecord | null>;
  /** Null when one is already pending for this person. */
  readonly insertJoinRequest: (
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly organisationId: string;
      readonly userId: string;
      readonly message: string | null;
    },
  ) => Promise<string | null>;
  readonly decideJoinRequest: (
    tx: Tx,
    requestId: string,
    input: {
      readonly status: "approved" | "declined";
      readonly decidedByUserId: string;
      readonly membershipId: string | null;
    },
  ) => Promise<void>;

  readonly pendingOffers: (
    tx: Tx,
    organisationId: string,
  ) => Promise<readonly OwnershipOfferRecord[]>;
  readonly offer: (
    tx: Tx,
    organisationId: string,
    offerId: string,
  ) => Promise<OwnershipOfferRecord | null>;
  readonly insertOffer: (
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly organisationId: string;
      readonly fromMembershipId: string;
      readonly toMembershipId: string;
    },
  ) => Promise<string>;
  readonly decideOffer: (
    tx: Tx,
    offerId: string,
    status: "accepted" | "declined" | "cancelled",
  ) => Promise<void>;

  /** The person's active memberships, for the switcher. */
  readonly myOrganisations: (
    userId: string,
  ) => Promise<readonly MyOrganisationRecord[]>;
};

/** Who did what to the team, for audit; membership changes also become events. */
export type TeamJournalEntry = {
  readonly action:
    | "invitation.sent"
    | "invitation.resent"
    | "invitation.revoked"
    | "invitation.accepted"
    | "membership.role_changed"
    | "membership.removed"
    | "membership.left"
    | "ownership.offered"
    | "ownership.accepted"
    | "ownership.declined"
    | "join_request.created"
    | "join_request.approved"
    | "join_request.declined";
  readonly tenantId: string;
  readonly organisationId: string;
  readonly actorUserId: string;
  readonly resourceType: "invitation" | "membership" | "ownership_offer" | "join_request";
  readonly resourceId: string;
  /** Ids and codes only; never an email address or a message. */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly correlationId: CorrelationId;
  /** A membership that began, ended or changed role: published as an event. */
  readonly membership?:
    | {
        readonly change: "CREATED" | "ENDED" | "ROLE_CHANGED";
        readonly membershipId: string;
        readonly userId: string;
        readonly status?: "left" | "revoked" | undefined;
        readonly role?: string | undefined;
        readonly handedOverToUserId?: string | null | undefined;
      }
    | undefined;
};

export type TeamJournal<Tx> = {
  readonly record: (tx: Tx, entry: TeamJournalEntry) => Promise<void>;
};

/** An invitation email, already in the person's words. */
export type InvitationEmail = {
  readonly to: string;
  readonly organisationName: string;
  readonly word: "company" | "firm";
  readonly inviterName: string;
  readonly role: "Admin" | "Member";
  readonly message: string | null;
  /** The accept link with the token; built from the configured web origin. */
  readonly link: string;
  readonly expiresInDays: number;
};

/** Sends through the app's outbound email adapter; tests pass a fake. */
export type InvitationMailer = {
  readonly available: boolean;
  /** Throws on failure; the invitation stays and can be resent. */
  readonly send: (email: InvitationEmail) => Promise<void>;
};
