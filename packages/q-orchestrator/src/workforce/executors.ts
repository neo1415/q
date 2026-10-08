import {
  QAgentExecutorSchema,
  Q_AGENT_ROLES,
  type QAgentExecutor,
  type QAgentRole,
} from "@capital-q/contracts";

import { AGENT_REGISTRY, type AgentRole } from "./registry.js";

/**
 * RECOVERY-2026-10 (D1, audit D-02): the one registry of what an agent step
 * can be in this deployment, in the lead contract's words (`QAgentRole`,
 * `QAgentExecutor`).
 *
 * The planner is shown, and may assign, only roles with an executor here.
 * Writing and reviewing are not roles: every outward draft is written and
 * graded inside CONVERSATION and OUTREACH (`OutwardReview`), so a plan that
 * names WRITER or REVIEWER is refused before it is offered for approval --
 * before this, such a plan was approved, its WRITER step was HELD and every
 * later step SKIPPED, and nothing was ever sent.
 *
 * A role is listed only when code that really carries it out exists. No
 * executor is declared to make a plan look complete.
 */

/** Read and answer replies: written, reviewed, then sent or carded. */
const CONVERSATION: QAgentExecutor = {
  role: "CONVERSATION",
  version: 2,
  tools: ["list_messages", "chat.message.send"],
  delivers: "MESSAGES_SENT_OR_CARDED",
  outward: true,
};

/** Express interest in companies: the platform's own first move. */
const OUTREACH: QAgentExecutor = {
  role: "OUTREACH",
  version: 2,
  tools: ["list_my_relationships", "relationship.interest.express"],
  delivers: "MESSAGES_SENT_OR_CARDED",
  outward: true,
};

/** Book calls a reply asked for, at a free slot. */
const SCHEDULING: QAgentExecutor = {
  role: "SCHEDULING",
  version: 1,
  tools: ["find_meeting_times", "list_schedule", "schedule.meeting.book"],
  delivers: "MEETING",
  outward: true,
};

/** Companies newly matching the declared mandate, as a shortlist. Read only. */
const DISCOVERY: QAgentExecutor = {
  role: "DISCOVERY",
  version: 1,
  tools: ["search_companies", "list_my_relationships"],
  delivers: "SHORTLIST",
  outward: false,
};

/**
 * Bounded public-web research with sources (`public_web.search`). Registered
 * only where a research provider is composed: without one there is nothing
 * real to run, and a plan naming RESEARCH is refused.
 */
const RESEARCH: QAgentExecutor = {
  role: "RESEARCH",
  version: 1,
  tools: ["public_web.search"],
  delivers: "RESEARCH_NOTE",
  outward: false,
};

/**
 * Roles with no executor yet, and why, in words the planner's refusal and
 * the report carry. DOCUMENTS: there is no service that makes a document
 * whose result is a durable, checkable file (the data-room share and
 * request-fulfil actions move existing files; they do not make one).
 * DILIGENCE: no executor answers data-room requests on the person's behalf.
 */
export const UNREGISTERED_ROLE_REASONS: Readonly<
  Partial<Record<QAgentRole, string>>
> = {
  LEAD: "The lead Q plans the job; it is never a step.",
  DOCUMENTS:
    "No agent can make a document yet: nothing produces a durable, checkable file.",
  DILIGENCE: "No agent can answer data-room requests on your behalf yet.",
};

export type ExecutorAvailability = {
  /** A public-web research provider is composed in this deployment. */
  readonly research: boolean;
};

/** The executors this deployment registers, by role. */
export function registeredExecutors(
  availability: ExecutorAvailability,
): Readonly<Partial<Record<QAgentRole, QAgentExecutor>>> {
  return {
    CONVERSATION,
    OUTREACH,
    SCHEDULING,
    DISCOVERY,
    ...(availability.research ? { RESEARCH } : {}),
  };
}

/** Every executor, valid against the lead contract (checked by a test). */
export const ALL_EXECUTORS: readonly QAgentExecutor[] = [
  CONVERSATION,
  OUTREACH,
  SCHEDULING,
  DISCOVERY,
  RESEARCH,
].map((executor) => QAgentExecutorSchema.parse(executor));

export function isQAgentRole(value: string): value is QAgentRole {
  return (Q_AGENT_ROLES as readonly string[]).includes(value);
}

/**
 * The role as the workforce tables and DTO store it. Those predate the lead
 * contract (`WORKFORCE_AGENT_ROLES`, migration 20261207090000); until the
 * lead widens them, two names map. Never shown to the person: the page
 * shows the stored role's title.
 */
export const STORED_ROLE: Readonly<Record<QAgentRole, AgentRole>> = {
  LEAD: "LEAD",
  CONVERSATION: "CONVERSATION",
  OUTREACH: "OUTREACH",
  RESEARCH: "RESEARCH",
  DOCUMENTS: "DOCUMENTS",
  SCHEDULING: "SCHEDULER",
  DISCOVERY: "MANDATE_WATCHER",
  // Never stored: it has no executor, so no step of it ever runs.
  DILIGENCE: "AD_HOC",
};

/**
 * A stored role back to its executor role. WRITER, REVIEWER and AD_HOC have
 * none: an older approved plan's drafting steps are folded into the step
 * that sends (see `plannedFrom`).
 */
export function executorRoleOf(stored: string): QAgentRole | null {
  switch (stored) {
    case "CONVERSATION":
    case "OUTREACH":
    case "RESEARCH":
    case "DOCUMENTS":
      return stored;
    case "SCHEDULER":
      return "SCHEDULING";
    case "MANDATE_WATCHER":
      return "DISCOVERY";
    default:
      return null;
  }
}

/** What the person sees for a role: the stored role's title. */
export function roleTitle(role: QAgentRole): string {
  return AGENT_REGISTRY[STORED_ROLE[role]].title;
}

/** The roster as the lead Q's prompt reads it (trusted, code's words). */
export function executorRosterText(
  executors: Readonly<Partial<Record<QAgentRole, QAgentExecutor>>>,
  permitted: ReadonlySet<string>,
): string {
  return Object.values(executors)
    .filter((executor): executor is QAgentExecutor => executor !== undefined)
    .map((executor) => {
      const agent = AGENT_REGISTRY[STORED_ROLE[executor.role]];
      const tools = executor.tools.filter((tool) => permitted.has(tool));
      return `- ${executor.role} (${agent.title}): ${agent.does} Tools: ${tools.join(", ") || "none permitted"}.`;
    })
    .join("\n");
}
