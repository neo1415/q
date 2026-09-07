import { z } from "zod";

import { QCapabilitySchema, QClientModalitySchema } from "./capability.js";
import {
  Q_OBJECTIVE_MAX_LENGTH,
  QLocaleSchema,
  QRequestContextSchema,
} from "./context.js";
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

export const QUserMessageInputSchema = z
  .object({
    text: z.string().trim().min(1).max(Q_MESSAGE_TEXT_MAX_LENGTH),
  })
  .strict();

export type QUserMessageInput = z.infer<typeof QUserMessageInputSchema>;

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
