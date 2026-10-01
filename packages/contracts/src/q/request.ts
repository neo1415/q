import { z } from "zod";

import { QCapabilitySchema, QClientModalitySchema } from "./capability.js";
import {
  Q_OBJECTIVE_MAX_LENGTH,
  QLocaleSchema,
  QRequestContextSchema,
} from "./context.js";
import { UuidSchema } from "../common/ids.js";
import { QConversationIdSchema, QRunIdSchema } from "./ids.js";
import { QSubjectRefsSchema } from "./subject.js";
import { QContractVersionSchema } from "./version.js";

/**
 * What a person may say to Q in one turn. Bounded: an unbounded string at a
 * trust boundary is a cost, a prompt-injection surface and a storage problem
 * all at once. The limit is a V1 technical bound in line with the other
 * free-text contracts in this package, not a product rule.
 */
export const Q_MESSAGE_TEXT_MAX_LENGTH = 8000;

/** A surface's opening words: a greeting and a short briefing, never a page. */
export const Q_OPENING_MAX_LENGTH = 1200;

export const QUserMessageInputSchema = z
  .object({
    text: z.string().trim().min(1).max(Q_MESSAGE_TEXT_MAX_LENGTH),
  })
  .strict();

export type QUserMessageInput = z.infer<typeof QUserMessageInputSchema>;

/**
 * What the person is watching as they ask (R18: Q watches the video with
 * us): a pitch and the playback position. A request, never authority --
 * the Q API authorises the asset for the asker with the pitch playback
 * rule and the company's visibility before anything enters the run's
 * context, and drops it silently when refused, exactly as if absent.
 */
export const QViewingMomentSchema = z
  .object({
    kind: z.literal("PITCH_PLAYBACK"),
    companyId: UuidSchema,
    mediaAssetId: UuidSchema,
    positionSeconds: z.number().int().min(0).max(7200),
  })
  .strict();
export type QViewingMoment = z.infer<typeof QViewingMomentSchema>;

/**
 * The screens a person can be on when they ask (R21). A closed list the
 * web maps its routes onto; OTHER for anything else. Not pixels.
 */
export const Q_SCREEN_ROUTES = [
  "HOME",
  "DISCOVER",
  "CAPITAL",
  "PROFILE",
  "COMPANY_VISIBILITY",
  "COMPANY_INTEREST",
  "COMPANY",
  "PITCH",
  "RELATIONSHIPS",
  "RELATIONSHIP_COMPANY",
  "RELATIONSHIP_INVESTOR",
  "VERIFICATION",
  "ONBOARDING",
  // The Q Daily (founder live 2026-10-01): "summarize everything here" on
  // the Daily was answered from older conversation text.
  "DAILY",
  "OTHER",
] as const;
export const QScreenRouteSchema = z.enum(Q_SCREEN_ROUTES);
export type QScreenRoute = z.infer<typeof QScreenRouteSchema>;

/**
 * What is on the person's screen as they ask (R21): the screen, and the
 * canonical entities it shows -- a company, an investor organisation, an
 * open Q document. The pitch and playback position travel as `viewing`
 * (R18), not here. A request, never authority: each entity is resolved
 * for the asker through its owning context exactly like a named subject,
 * and one that does not resolve is dropped silently, as if absent.
 */
export const QScreenContextSchema = z
  .object({
    route: QScreenRouteSchema,
    companyId: UuidSchema.optional(),
    investorOrganisationId: UuidSchema.optional(),
    documentId: UuidSchema.optional(),
    /**
     * The device's IANA time zone as the person asks (live test 2026-09-28
     * #2): "tomorrow at 2 PM" is resolved by code in this zone, never in
     * UTC by accident. A request like the rest: a zone the runtime does not
     * know is ignored, and it grants nothing.
     */
    timeZone: z
      .string()
      .regex(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/)
      .max(64)
      .optional(),
  })
  .strict();
export type QScreenContext = z.infer<typeof QScreenContextSchema>;

/**
 * PUBLIC. The body a client sends to start a Q run (doc 22 §67).
 *
 * Strict, and deliberately small. What a client may say: which capability it
 * wants, what it is trying to achieve, what it is asking, which canonical
 * subjects it means, how it is interacting, and which conversation this
 * continues. What it may not say, and what fails validation if it tries:
 * who it is, which tenant it is in, what it is permitted to see, how
 * consequential the request is, which model or prompt to use, which tools
 * exist, or that anything has been approved. Every one of those is resolved
 * server-side or belongs to a later packet's internal contract.
 *
 * Extra fields are rejected rather than stripped. A client that sends
 * `tenantId` or `approved: true` is either broken or probing, and in both
 * cases a loud failure is more useful than silent acceptance.
 */
export const CreateQRunRequestSchema = z
  .object({
    capability: QCapabilitySchema,
    /** Optional; when absent the message itself states the objective. */
    objective: z.string().trim().min(1).max(Q_OBJECTIVE_MAX_LENGTH).optional(),
    message: QUserMessageInputSchema,
    subjects: QSubjectRefsSchema.optional(),
    modality: QClientModalitySchema,
    locale: QLocaleSchema.optional(),
    conversationId: QConversationIdSchema.optional(),
    /** R18: asked while watching a pitch; authorised server-side or dropped. */
    viewing: QViewingMomentSchema.optional(),
    /** R21: what is on screen; each entity resolved for the asker or dropped. */
    screen: QScreenContextSchema.optional(),
    /**
     * What Q's surface said to the person before this first question (the
     * welcome or briefing on Home: "There are companies in your feed…").
     * Kept as Q's opening line of a NEW conversation, so a follow-up such
     * as "what are these companies?" has what it refers to. Ignored when
     * the run continues a conversation. It is what this person's own
     * screen showed them, read as conversation (data, never instruction),
     * and it grants nothing.
     */
    opening: z.string().trim().min(1).max(Q_OPENING_MAX_LENGTH).optional(),
  })
  .strict();

export type CreateQRunRequest = z.infer<typeof CreateQRunRequestSchema>;

/**
 * PUBLIC. A follow-up message into an existing run (doc 22 §77) -- the
 * answer to a clarification, or the next turn of a conversation.
 */
export const AppendQRunMessageRequestSchema = z
  .object({ message: QUserMessageInputSchema })
  .strict();

export type AppendQRunMessageRequest = z.infer<
  typeof AppendQRunMessageRequestSchema
>;

/**
 * INTERNAL. The fully resolved unit of work handed to the Q runtime: the
 * server-resolved context plus the person's input.
 *
 * Assembled only by the Q API after authentication, actor resolution and
 * policy have run. Never parsed from a client body. There is no field for a
 * system prompt, a provider, a model, a tool list or a permission override,
 * and there will not be one here: advanced controls for trusted callers, if
 * they are ever needed, belong in a separate internal contract so that this
 * one cannot be weakened by accident.
 */
export const QRequestEnvelopeSchema = z
  .object({
    contractVersion: QContractVersionSchema,
    context: QRequestContextSchema,
    input: QUserMessageInputSchema,
    /** The run this request continues, when it is a follow-up turn. */
    continuesRunId: QRunIdSchema.optional(),
  })
  .strict();

export type QRequestEnvelope = z.infer<typeof QRequestEnvelopeSchema>;
