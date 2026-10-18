import { z } from "zod";

/**
 * RECOVERY-2026-10 (lead contract): the one registry of what an agent step
 * can be. A planner may only assign a step whose role has a registered
 * executor in this deployment; a plan naming anything else is refused
 * before it is offered for approval (audit D-02: WRITER and REVIEWER were
 * planned but had no executor, so jobs never sent).
 */
export const Q_AGENT_ROLES = [
  "LEAD",
  /** Read and answer conversations (writes and reviews its own drafts inside). */
  "CONVERSATION",
  /** Outreach to a new counterpart (writes and reviews inside). */
  "OUTREACH",
  /** Public-web and records research with sources. */
  "RESEARCH",
  /** Make or change a document (deck, brief, one-pager, report). */
  "DOCUMENTS",
  /** Book, move or prepare meetings. */
  "SCHEDULING",
  /** Discover/fit work: find and compare companies or investors. */
  "DISCOVERY",
  /** Data-room and diligence requests. */
  "DILIGENCE",
] as const;
export const QAgentRoleSchema = z.enum(Q_AGENT_ROLES);
export type QAgentRole = z.infer<typeof QAgentRoleSchema>;

export const QAgentExecutorSchema = z
  .object({
    role: QAgentRoleSchema,
    /** The executor's version, for the run record. */
    version: z.number().int().min(1),
    /** Tool ids it may call (must exist in the Q tool registry). */
    tools: z.array(z.string().min(1).max(80)).max(40),
    /** What it delivers: a durable, checkable artifact kind. */
    delivers: z.enum([
      "MESSAGES_SENT_OR_CARDED",
      "RESEARCH_NOTE",
      "DOCUMENT",
      "MEETING",
      "SHORTLIST",
      "REQUESTS_ANSWERED",
    ]),
    /** Whether anything it does reaches another person (needs approval or delegation). */
    outward: z.boolean(),
  })
  .strict();
export type QAgentExecutor = z.infer<typeof QAgentExecutorSchema>;

/** Durable states of a job or step; each grounded in persisted facts. */
export const Q_WORK_STATES = [
  "PLANNED",
  "AWAITING_AUTHORIZATION",
  "QUEUED",
  "RUNNING",
  "BLOCKED",
  "NEEDS_DECISION",
  "RECOVERING",
  "FAILED",
  "CANCELLED",
  "COMPLETED",
] as const;
export const QWorkStateSchema = z.enum(Q_WORK_STATES);
export type QWorkState = z.infer<typeof QWorkStateSchema>;
