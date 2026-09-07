import { z } from "zod";

import { createUuidIdSchema } from "../common/ids.js";

/**
 * Identifiers Q itself owns. Everything Q refers to that another context owns
 * (a company, an investor organisation, a document, an evidence item, a user)
 * keeps that context's identifier and is carried in a typed subject or
 * evidence reference -- nothing here duplicates a domain identifier.
 *
 * As with every Capital Q identifier the brand is type-only: the wire form is
 * a plain UUID, and holding one is never permission to read or act on the run,
 * message, proposal or approval it names.
 */

/** One unit of Q work -- an investigation, an answer, a comparison. */
export const QRunIdSchema = createUuidIdSchema("QRunId");
export type QRunId = z.infer<typeof QRunIdSchema>;

/**
 * A continuation thread across runs. Present when a request follows on from
 * an earlier exchange; absent for a fresh request. Not a provider thread id,
 * and never something the model chooses.
 */
export const QConversationIdSchema = createUuidIdSchema("QConversationId");
export type QConversationId = z.infer<typeof QConversationIdSchema>;

export const QMessageIdSchema = createUuidIdSchema("QMessageId");
export type QMessageId = z.infer<typeof QMessageIdSchema>;

export const QFindingIdSchema = createUuidIdSchema("QFindingId");
export type QFindingId = z.infer<typeof QFindingIdSchema>;

/**
 * A prepared, not-yet-approved, not-yet-executed action. Distinct from the
 * approval that may later bind to it and from any execution record.
 */
export const QActionProposalIdSchema = createUuidIdSchema("QActionProposalId");
export type QActionProposalId = z.infer<typeof QActionProposalIdSchema>;

/**
 * The application-owned approval record (doc 12 §31.3). Deliberately a
 * different brand from QActionProposalId so a proposal can never be passed
 * where an approval is required.
 */
export const QApprovalIdSchema = createUuidIdSchema("QApprovalId");
export type QApprovalId = z.infer<typeof QApprovalIdSchema>;

export const QToolCallIdSchema = createUuidIdSchema("QToolCallId");
export type QToolCallId = z.infer<typeof QToolCallIdSchema>;

/**
 * One stream event occurrence. Identity for deduplication on reconnect;
 * ordering within a run comes from the event's sequence, never from this id.
 */
export const QStreamEventIdSchema = createUuidIdSchema("QStreamEventId");
export type QStreamEventId = z.infer<typeof QStreamEventIdSchema>;
