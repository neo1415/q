import { z } from "zod";

import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "../identity/ids.js";

/**
 * What kind of thing is acting. Shared vocabulary with the event envelope.
 *
 * The type describes attribution, not authority. `Q` records that Q initiated
 * something; whether Q was permitted to is a separate question answered by
 * approval and delegation records.
 */
export const ACTOR_TYPES = [
  "HUMAN",
  "Q",
  "SYSTEM",
  "CONNECTED_SYSTEM",
] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

export const ActorTypeSchema = z.enum(ACTOR_TYPES);

/**
 * The canonical, server-resolved answer to "who is acting, and in what
 * capacity" (doc 22, 27).
 *
 * Every field here is produced by trusted server-side resolution from an
 * authenticated identity. None of it is ever read from a client. A client may
 * *request* an organisation context; only the server can grant one.
 *
 * What this deliberately does NOT contain, and why:
 *
 *   roles / capabilities   Collapsing context resolution and authorisation into
 *                          one object means every consumer decides permissions
 *                          for itself. CQ-SEC-002 owns capabilities.
 *   business title         "CEO" is professional context, not authority. A CFO
 *                          is not automatically permitted to share a Data Room.
 *   verification state     A separate claim system, consulted where a decision
 *                          actually depends on it.
 *   admin flags            There is no platform-admin shortcut. Support access
 *                          is an explicit capability through an audited path.
 *   Q knowledge scopes     The Context Firewall builds Q's context from this
 *                          plus authorisation, disclosure policy and scope.
 *
 * Holding a valid ActorContext means the server knows who you are and which
 * organisation you are operating in. It does not mean you may touch any
 * particular object in that tenant.
 */
export const ActorContextSchema = z.object({
  userId: UserIdSchema,
  tenantId: TenantIdSchema,

  /**
   * Absent for a person acting personally rather than for an organisation.
   * When present it is always accompanied by the membership that granted it.
   */
  organisationId: OrganisationIdSchema.optional(),
  membershipId: MembershipIdSchema.optional(),

  actorType: ActorTypeSchema,
});

export type ActorContext = Readonly<z.infer<typeof ActorContextSchema>>;
