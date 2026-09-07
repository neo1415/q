import { z } from "zod";

import {
  CorrelationIdSchema,
  RequestIdSchema,
  UuidSchema,
} from "../common/ids.js";
import { EVENT_ACTOR_TYPES } from "../events/envelope.js";
import { MarketplaceVisibilitySchema } from "../http/companies.js";
import {
  QCapabilitySchema,
  QConsequenceClassSchema,
  QModalitySchema,
  QSourceApplicationSchema,
} from "./capability.js";
import { QConversationIdSchema } from "./ids.js";
import { QSubjectRefsSchema } from "./subject.js";

/**
 * The server-resolved context a Q run executes under (doc 12 §8).
 *
 * INTERNAL. This shape is assembled by the Q API from an authenticated,
 * server-resolved ActorContext and from policy -- it is never parsed from a
 * request body. The public shape a client sends is CreateQRunRequest, which
 * has no actor, no tenant, no consequence class and no way to express any of
 * them. Keeping the two apart is what makes "the browser does not prove
 * tenant by sending tenantId" a property of the type system rather than a
 * convention.
 *
 * Holding a QRequestContext means the server knows who is asking, for which
 * tenant, to what end, and about which subjects. It does not mean any of
 * those subjects may be read, nor that any requested knowledge scope is
 * granted. The Context Firewall (CQ-Q-004) turns this into authorised
 * context; nothing here is that decision.
 */

/**
 * Who is asking, mirroring @capital-q/security's ActorContext field for
 * field. Declared structurally here because the security package depends on
 * this one and the dependency cannot run the other way.
 *
 * Deliberately absent, exactly as on ActorContext: roles, capabilities,
 * business titles, admin flags. A capability is a separate resolved decision,
 * and a context that carried a list of them would tempt every consumer to
 * authorise from the list instead of asking the authorisation service.
 */
export const QActorSchema = z
  .object({
    userId: UuidSchema,
    /** Present only with the membership that granted it. */
    organisationId: UuidSchema.optional(),
    membershipId: UuidSchema.optional(),
    actorType: z.enum(EVENT_ACTOR_TYPES),
  })
  .strict()
  .refine(
    (actor) =>
      actor.organisationId === undefined || actor.membershipId !== undefined,
    {
      message: "an organisation context is always granted by a membership",
      path: ["membershipId"],
    },
  );

export type QActor = z.infer<typeof QActorSchema>;

/** The isolation boundary. Resolved from the actor, never chosen by the model. */
export const QTenantSchema = z.object({ tenantId: UuidSchema }).strict();

export type QTenant = z.infer<typeof QTenantSchema>;

export const Q_OBJECTIVE_MAX_LENGTH = 500;

/**
 * Why Q is being asked. The objective is a short bounded statement of what
 * the person is trying to accomplish; the capability is the Q outcome that
 * serves it; the consequence class is policy's view of what a mistake costs.
 */
export const QPurposeSchema = z
  .object({
    objective: z.string().trim().min(1).max(Q_OBJECTIVE_MAX_LENGTH),
    capability: QCapabilitySchema,
    consequenceClass: QConsequenceClassSchema,
  })
  .strict();

export type QPurpose = z.infer<typeof QPurposeSchema>;

/** BCP 47-shaped language tag, bounded. Presentation hint only. */
export const QLocaleSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "expected a language tag")
  .max(35);

export const QInteractionSchema = z
  .object({
    modality: QModalitySchema,
    locale: QLocaleSchema.optional(),
    /** Continuation of an earlier exchange, when there is one. */
    conversationId: QConversationIdSchema.optional(),
  })
  .strict();

export type QInteraction = z.infer<typeof QInteractionSchema>;

/**
 * Knowledge scopes the caller is asking Q to reason over, in ADR-001's
 * disclosure vocabulary. REQUESTED, never granted: a client asking for
 * founder_private context has asked, and that is all. Whether any of it is
 * eligible is the Context Firewall's answer.
 */
export const QRequestedKnowledgeScopesSchema = z
  .array(MarketplaceVisibilitySchema)
  .max(MarketplaceVisibilitySchema.options.length);

export const QRequestContextSchema = z
  .object({
    requestId: RequestIdSchema,
    correlationId: CorrelationIdSchema.optional(),
    sourceApplication: QSourceApplicationSchema,

    actor: QActorSchema,
    tenant: QTenantSchema,
    purpose: QPurposeSchema,

    /** Canonical entities the request is about. Selection, not authority. */
    subjects: QSubjectRefsSchema,

    interaction: QInteractionSchema,

    requestedKnowledgeScopes: QRequestedKnowledgeScopesSchema.optional(),
  })
  .strict();

export type QRequestContext = z.infer<typeof QRequestContextSchema>;
