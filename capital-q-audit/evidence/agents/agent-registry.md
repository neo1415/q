# Evidence: packages/q-orchestrator/src/workforce/registry.ts lines 1-167

- Original path: `packages/q-orchestrator/src/workforce/registry.ts`
- Line range: 1-167 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Agent roles, tools, budgets. Complete module.

```ts
    1  /**
    2   * Q's workforce: the typed registry of agent roles (founder brief J1,
    3   * 2026-10-06).
    4   *
    5   * The person meets one Q. Behind it the lead Q plans a job and hands its
    6   * steps to specialists. A role is a fixed, code-owned definition: what it
    7   * does, which tools it may use and what one job's run of it may spend. A
    8   * model never adds a tool to a role; an ad-hoc agent the lead Q spawns gets
    9   * a subset of tools that the role list and the person's grant both permit
   10   * (see `boundPlan`). Specialists never talk to each other directly: every
   11   * hand-off is a recorded step in the job.
   12   *
   13   * Tool names are the app's own: consequential app-action names
   14   * (`chat.message.send`, ADR 0040) and Q read tools (`search_companies`).
   15   */
   16
   17  export const AGENT_ROLES = [
   18    "LEAD",
   19    "OUTREACH",
   20    "MANDATE_WATCHER",
   21    "CONVERSATION",
   22    "WRITER",
   23    "REVIEWER",
   24    "SCHEDULER",
   25    "DOCUMENTS",
   26    "RESEARCH",
   27    "AD_HOC",
   28  ] as const;
   29  export type AgentRole = (typeof AGENT_ROLES)[number];
   30
   31  /** Tools whose effect reaches the other side: always written and reviewed. */
   32  export const OUTWARD_TOOLS: ReadonlySet<string> = new Set([
   33    "chat.message.send",
   34    "email.send",
   35    "relationship.connection_request.send",
   36  ]);
   37
   38  export type AgentDefinition = {
   39    readonly role: AgentRole;
   40    /** The name the workforce page shows. */
   41    readonly title: string;
   42    readonly does: string;
   43    readonly tools: readonly string[];
   44    /** The most one run of this agent may spend in one job, USD. */
   45    readonly budgetUsd: number;
   46  };
   47
   48  export const AGENT_REGISTRY: Readonly<Record<AgentRole, AgentDefinition>> = {
   49    LEAD: {
   50      role: "LEAD",
   51      title: "Lead Q",
   52      does: "Plans the job, assigns each step to an agent and can spawn an agent for a step no role covers.",
   53      tools: [],
   54      budgetUsd: 0.1,
   55    },
   56    OUTREACH: {
   57      role: "OUTREACH",
   58      title: "Outreach",
   59      does: "Opens new relationships: expresses interest and sends first messages the reviewer passed.",
   60      tools: [
   61        "list_my_relationships",
   62        "relationship.interest.express",
   63        "relationship.connection_request.send",
   64        "chat.message.send",
   65      ],
   66      budgetUsd: 0.1,
   67    },
   68    MANDATE_WATCHER: {
   69      role: "MANDATE_WATCHER",
   70      title: "Mandate watcher",
   71      does: "Finds companies newly matching the declared mandate and expresses interest in them.",
   72      tools: [
   73        "search_companies",
   74        "list_my_relationships",
   75        "relationship.interest.express",
   76      ],
   77      budgetUsd: 0.05,
   78    },
   79    CONVERSATION: {
   80      role: "CONVERSATION",
   81      title: "Conversation",
   82      does: "Reads replies and answers them, warmly and only from what the person approved.",
   83      tools: ["list_messages", "chat.message.send"],
   84      budgetUsd: 0.1,
   85    },
   86    WRITER: {
   87      role: "WRITER",
   88      title: "Writer",
   89      does: "Drafts every outward message and redrafts it from the reviewer's feedback.",
   90      tools: [],
   91      budgetUsd: 0.1,
   92    },
   93    REVIEWER: {
   94      role: "REVIEWER",
   95      title: "Reviewer",
   96      does: "Grades every outward draft against the house and personal guides and Capital Q's integrity rules.",
   97      tools: [],
   98      budgetUsd: 0.1,
   99    },
  100    SCHEDULER: {
  101      role: "SCHEDULER",
  102      title: "Scheduler",
  103      does: "Finds times, books calls, sends invitations and confirmations.",
  104      tools: [
  105        "find_meeting_times",
  106        "list_schedule",
  107        "schedule.meeting.book",
  108        "schedule.reminder.create",
  109        "email.send",
  110      ],
  111      budgetUsd: 0.05,
  112    },
  113    DOCUMENTS: {
  114      role: "DOCUMENTS",
  115      title: "Documents",
  116      does: "Finds or prepares what the other side asked for, such as a deck or a PDF, for grading and sharing.",
  117      tools: [
  118        "list_my_documents",
  119        "list_uploaded_documents",
  120        "diligence.document.share",
  121        "diligence.request.fulfil",
  122      ],
  123      budgetUsd: 0.1,
  124    },
  125    RESEARCH: {
  126      role: "RESEARCH",
  127      title: "Research",
  128      does: "Researches companies and people on Capital Q and the public web, with sources.",
  129      tools: ["search_companies", "research_public_web"],
  130      budgetUsd: 0.1,
  131    },
  132    AD_HOC: {
  133      role: "AD_HOC",
  134      title: "Agent",
  135      does: "An agent the lead Q spawned for one step, with only the tools that step needs.",
  136      // Granted per spawn, from the union of the other roles' tools.
  137      tools: [],
  138      budgetUsd: 0.05,
  139    },
  140  };
  141
  142  /** Every tool any role may use: the ceiling for an ad-hoc agent. */
  143  export const ALL_ROLE_TOOLS: ReadonlySet<string> = new Set(
  144    Object.values(AGENT_REGISTRY).flatMap((agent) => agent.tools),
  145  );
  146
  147  export function isAgentRole(value: string): value is AgentRole {
  148    return (AGENT_ROLES as readonly string[]).includes(value);
  149  }
  150
  151  /** The roster as the lead Q's prompt reads it (trusted, code's words). */
  152  export function rosterText(
  153    permitted: ReadonlySet<string>,
  154    roles: readonly AgentRole[] = AGENT_ROLES.filter((role) => role !== "LEAD"),
  155  ): string {
  156    return roles
  157      .map((role) => {
  158        const agent = AGENT_REGISTRY[role];
  159        const tools =
  160          role === "AD_HOC"
  161            ? "any permitted tool below, the fewest it needs"
  162            : agent.tools.filter((tool) => permitted.has(tool)).join(", ") ||
  163              "none (works on drafts only)";
  164        return `- ${role} (${agent.title}): ${agent.does} Tools: ${tools}.`;
  165      })
  166      .join("\n");
  167  }
```
