/**
 * Q's workforce: the typed registry of agent roles (founder brief J1,
 * 2026-10-06).
 *
 * The person meets one Q. Behind it the lead Q plans a job and hands its
 * steps to specialists. A role is a fixed, code-owned definition: what it
 * does, which tools it may use and what one job's run of it may spend. A
 * model never adds a tool to a role; an ad-hoc agent the lead Q spawns gets
 * a subset of tools that the role list and the person's grant both permit
 * (see `boundPlan`). Specialists never talk to each other directly: every
 * hand-off is a recorded step in the job.
 *
 * Tool names are the app's own: consequential app-action names
 * (`chat.message.send`, ADR 0040) and Q read tools (`search_companies`).
 */

export const AGENT_ROLES = [
  "LEAD",
  "OUTREACH",
  "MANDATE_WATCHER",
  "CONVERSATION",
  "WRITER",
  "REVIEWER",
  "SCHEDULER",
  "DOCUMENTS",
  "RESEARCH",
  "AD_HOC",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Tools whose effect reaches the other side: always written and reviewed. */
export const OUTWARD_TOOLS: ReadonlySet<string> = new Set([
  "chat.message.send",
  "email.send",
  "relationship.connection_request.send",
]);

export type AgentDefinition = {
  readonly role: AgentRole;
  /** The name the workforce page shows. */
  readonly title: string;
  readonly does: string;
  readonly tools: readonly string[];
  /** The most one run of this agent may spend in one job, USD. */
  readonly budgetUsd: number;
};

export const AGENT_REGISTRY: Readonly<Record<AgentRole, AgentDefinition>> = {
  LEAD: {
    role: "LEAD",
    title: "Lead Q",
    does: "Plans the job, assigns each step to an agent and can spawn an agent for a step no role covers.",
    tools: [],
    budgetUsd: 0.1,
  },
  OUTREACH: {
    role: "OUTREACH",
    title: "Outreach",
    does: "Opens new relationships: expresses interest in companies, the platform's first move to a new counterpart.",
    tools: ["list_my_relationships", "relationship.interest.express"],
    budgetUsd: 0.1,
  },
  MANDATE_WATCHER: {
    role: "MANDATE_WATCHER",
    title: "Mandate watcher",
    does: "Finds companies newly matching the declared mandate and shortlists them.",
    tools: ["search_companies", "list_my_relationships"],
    budgetUsd: 0.05,
  },
  CONVERSATION: {
    role: "CONVERSATION",
    title: "Conversation",
    does: "Reads replies and answers them, warmly and only from what the person approved; each draft is written and checked against the guides before it goes.",
    tools: ["list_messages", "chat.message.send"],
    budgetUsd: 0.1,
  },
  WRITER: {
    role: "WRITER",
    title: "Writer",
    does: "Drafts every outward message and redrafts it from the reviewer's feedback.",
    tools: [],
    budgetUsd: 0.1,
  },
  REVIEWER: {
    role: "REVIEWER",
    title: "Reviewer",
    does: "Grades every outward draft against the house and personal guides and Capital Q's integrity rules.",
    tools: [],
    budgetUsd: 0.1,
  },
  SCHEDULER: {
    role: "SCHEDULER",
    title: "Scheduler",
    does: "Finds times, books calls, sends invitations and confirmations.",
    tools: [
      "find_meeting_times",
      "list_schedule",
      "schedule.meeting.book",
      "schedule.reminder.create",
      "email.send",
    ],
    budgetUsd: 0.05,
  },
  DOCUMENTS: {
    role: "DOCUMENTS",
    title: "Documents",
    does: "Finds or prepares what the other side asked for, such as a deck or a PDF, for grading and sharing.",
    tools: [
      "list_my_documents",
      "list_uploaded_documents",
      "diligence.document.share",
      "diligence.request.fulfil",
    ],
    budgetUsd: 0.1,
  },
  RESEARCH: {
    role: "RESEARCH",
    title: "Research",
    does: "Researches companies and people on Capital Q and the public web, with sources.",
    tools: ["public_web.search"],
    budgetUsd: 0.1,
  },
  AD_HOC: {
    role: "AD_HOC",
    title: "Agent",
    does: "An agent the lead Q spawned for one step, with only the tools that step needs.",
    // Granted per spawn, from the union of the other roles' tools.
    tools: [],
    budgetUsd: 0.05,
  },
};

/** Every tool any role may use: the ceiling for an ad-hoc agent. */
export const ALL_ROLE_TOOLS: ReadonlySet<string> = new Set(
  Object.values(AGENT_REGISTRY).flatMap((agent) => agent.tools),
);

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

/** The roster as the lead Q's prompt reads it (trusted, code's words). */
export function rosterText(
  permitted: ReadonlySet<string>,
  roles: readonly AgentRole[] = AGENT_ROLES.filter((role) => role !== "LEAD"),
): string {
  return roles
    .map((role) => {
      const agent = AGENT_REGISTRY[role];
      const tools =
        role === "AD_HOC"
          ? "any permitted tool below, the fewest it needs"
          : agent.tools.filter((tool) => permitted.has(tool)).join(", ") ||
            "none (works on drafts only)";
      return `- ${role} (${agent.title}): ${agent.does} Tools: ${tools}.`;
    })
    .join("\n");
}
