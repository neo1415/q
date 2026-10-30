import { createHash } from "node:crypto";

import {
  Q_PLAN_MAX_REDRAFTS,
  Q_PLAN_RUBRIC_VERSION,
  Q_PLAN_REVIEW_THRESHOLD,
  Q_PLAN_STEPS_MAX,
  Q_SITUATION_FACTS_MAX,
  Q_SITUATION_FACTS_PER_SECTION_MAX,
  QPlanIdSchema,
  QPlanSchema,
  QSituationDossierSchema,
  situationFacts,
  type QPlan,
  type QPlanBlock,
  type QPlanReview,
  type QPlanReviewSummary,
  type QPlanStep,
  type QPlanStepAction,
  type QPlanStepOwner,
  type QSituationDossier,
  type QSituationSection,
  type QSituationSide,
  type QSituationSource,
  type QSpecialistDefinition,
  type WORKFORCE_AGENT_ROLES,
  type WorkforceLiveStage,
} from "@capital-q/contracts";
import { APP_ACTIONS } from "@capital-q/app-actions";
import type { Logger } from "@capital-q/observability";
import {
  PLAN_RUBRIC_V1,
  PLAN_REVIEW_FOCI,
  PROMPT_EMPTY_CASES,
  planReviewScore,
  type PlanReviewResult,
  type PlanStepAction,
  type PlanWriteResult,
  type PlanWriteStep,
} from "@capital-q/q-core";
import type { QToolExecutionContext, QToolPort } from "@capital-q/q-runtime";
import type {
  SituationAssembler,
  SituationPublicProfile,
  SituationResearchHook,
  SituationSubject,
} from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

import { safeReport, type LiveReport } from "./live.js";
import type { PlanWriteInput, Who, WorkforceModels } from "./models.js";
import type { PlanStore } from "./plan-store.js";
import { derivedWaits } from "./plan-thread.js";
import type { Owner } from "./store.js";

/**
 * Situation-first planning, S4 (PLANNING-DESIGN.md B1-B3, addenda 3-4): the
 * plan job. "How do I improve my chances of getting investment?" is no
 * longer a readiness checklist: Q starts at once, then
 *
 *   GATHERING_SITUATION  the person's situation, read AS THEM through the
 *                        chat's own typed tools (the S2 assembler, with
 *                        their memory and what they did recently);
 *   READING_DOCUMENTS    their own deck, as Q read it, for their own
 *                        company's asks -- beside
 *   SEARCHING            public sources, only when the reader says the ask
 *                        needs them (bounded by the job's search budget);
 *   DRAFTING_PLAN        PLAN_WRITE v1 from the dossier;
 *   REVIEWING_PLAN       PLAN_REVIEW v1 twice, in parallel, on the same
 *                        draft (coverage/specificity; feasibility/invented
 *                        facts); code recomputes each score. Below the bar,
 *                        one redraft with the numbered defects, reviewed
 *                        again; still below, it is offered as a draft "not
 *                        fully reviewed" with what is open -- never
 *                        silently passed.
 *
 * Code owns everything a model only suggests: every cite is grounded
 * against the dossier (an invented one is dropped, a step left with none is
 * dropped), every step's owner and whether it needs approval are re-derived
 * from its action's class, and the subject is the person's own company or
 * mandate unless the reader said they named another. At most six model
 * calls (one write, two reviews, one redraft, two reviews); the reply that
 * started it and the delivery are code's words.
 *
 * The plan is personal_private: never evidence, never a ranking input.
 */

// --- the job's payload ----------------------------------------------------------

export const PLAN_JOB_KIND = "PLAN" as const;

const SubjectSchema = z.discriminatedUnion("side", [
  z
    .object({ side: z.literal("FOUNDER"), companyId: z.string().uuid() })
    .strict(),
  z
    .object({
      side: z.literal("INVESTOR"),
      investorOrganisationId: z.string().uuid(),
    })
    .strict(),
]);

/** What the durable queue holds for a plan job (never a model's words but the ask). */
export const PlanJobPayloadSchema = z
  .object({
    kind: z.literal(PLAN_JOB_KIND),
    ownerUserId: z.string().uuid(),
    /** The person's words, as asked. */
    ask: z.string().trim().min(1).max(2_000),
    /** For the Work page and an ending line: the goal, short. */
    summary: z.string().trim().min(1).max(400),
    subject: SubjectSchema,
    research: z.enum(["NONE", "MARKET", "SELF", "BOTH"]),
    deliverable: z.enum(["PLAN", "DOCUMENT_REVIEW", "ANALYSIS", "DOCUMENT"]),
    /** NEW: the first version. CHANGE: the next version, from the person's direction. */
    mode: z.enum(["NEW", "CHANGE"]),
    planId: z.string().uuid().nullable(),
    fromVersion: z.number().int().min(1).max(1000).nullable(),
    /** CHANGE: the DIRECTION entry the person's words were filed as. */
    directionId: z.string().uuid().nullable(),
  })
  .strict();
export type PlanJobPayload = z.infer<typeof PlanJobPayloadSchema>;

/** The stage a plan job shows before its first report: gathering. */
export function planGatheringStage(at: Date): WorkforceLiveStage {
  return {
    stage: "GATHERING",
    questions: null,
    sources: null,
    facts: null,
    draft: null,
    drafts: null,
    title: null,
    sections: [],
    read: [],
    openPoints: null,
    at: at.toISOString(),
  };
}

export function isPlanJobPayload(plan: unknown): boolean {
  return (
    typeof plan === "object" &&
    plan !== null &&
    (plan as { readonly kind?: unknown }).kind === PLAN_JOB_KIND
  );
}

// --- what a step may do (the roster) -----------------------------------------------

type RosterEntry =
  | {
      readonly kind: "TOOL_PROPOSAL";
      readonly name: string;
      readonly does: string;
      readonly sides: readonly QSituationSide[];
    }
  | {
      readonly kind: "APP_ACTION";
      readonly name: string;
      readonly does: string;
      readonly sides: readonly QSituationSide[];
    }
  | {
      readonly kind: "WORKFORCE";
      readonly name: (typeof WORKFORCE_AGENT_ROLES)[number];
      readonly does: string;
      /** Sends or books something with another person: always approved first. */
      readonly outward: boolean;
    };

const BOTH: readonly QSituationSide[] = ["FOUNDER", "INVESTOR"];

/** Q tools that prepare an approval card; every one waits on the person. */
const PROPOSALS: readonly RosterEntry[] = [
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_reminder",
    does: "a reminder for you at a date and time",
    sides: BOTH,
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_meeting",
    does: "a meeting with someone you are connected to, at a time that suits both",
    sides: BOTH,
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_chat_message",
    does: "a message in a conversation you already have on Capital Q",
    sides: BOTH,
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_email",
    does: "an email from you",
    sides: BOTH,
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_connection_request",
    does: "a request to connect with an investor",
    sides: ["FOUNDER"],
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_interest_answer",
    does: "your answer to an investor's interest",
    sides: ["FOUNDER"],
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_express_interest",
    does: "interest in a company, sent to its founders",
    sides: ["INVESTOR"],
  },
  {
    kind: "TOOL_PROPOSAL",
    name: "propose_connection_request_answer",
    does: "your answer to a company's request to connect",
    sides: ["INVESTOR"],
  },
];

/** App actions a plan may name; kept only when the registry holds them. */
const APP_ACTION_NAMES: readonly {
  readonly name: string;
  readonly sides: readonly QSituationSide[];
}[] = [
  { name: "board.item.add", sides: BOTH },
  { name: "deck.read_again", sides: ["FOUNDER"] },
  { name: "deck.section.review", sides: ["FOUNDER"] },
  { name: "data_room.outline.set", sides: ["FOUNDER"] },
  { name: "company.profile.update", sides: ["FOUNDER"] },
  { name: "capital.objective.update", sides: ["FOUNDER"] },
  { name: "document.access.share", sides: BOTH },
  { name: "investor.mandate.change", sides: ["INVESTOR"] },
  { name: "discovery.company.save", sides: ["INVESTOR"] },
];

const WORKFORCE_ROSTER: readonly RosterEntry[] = [
  {
    kind: "WORKFORCE",
    name: "RESEARCH",
    does: "public research into a question, with sources",
    outward: false,
  },
  {
    kind: "WORKFORCE",
    name: "DOCUMENTS",
    does: "a document of yours drafted or reworked",
    outward: false,
  },
  {
    kind: "WORKFORCE",
    name: "OUTREACH",
    does: "first messages to people you choose, each approved by you",
    outward: true,
  },
  {
    kind: "WORKFORCE",
    name: "CONVERSATION",
    does: "replies in your conversations, each approved by you",
    outward: true,
  },
  {
    kind: "WORKFORCE",
    name: "SCHEDULER",
    does: "a meeting time agreed and booked, approved by you",
    outward: true,
  },
  {
    kind: "WORKFORCE",
    name: "MANDATE_WATCHER",
    does: "watching new companies against your mandate",
    outward: false,
  },
  {
    kind: "WORKFORCE",
    name: "AD_HOC",
    does: "a piece of work none of the above covers; Q sets up someone for it, with your approval",
    outward: true,
  },
];

type AppActionClass = "READ" | "INSTANT" | "CONSEQUENTIAL";

const APP_ACTION_CLASS: ReadonlyMap<string, AppActionClass> = new Map(
  APP_ACTIONS.map((action) => [action.name, action.classification]),
);
const APP_ACTION_DOES: ReadonlyMap<string, string> = new Map(
  APP_ACTIONS.map((action) => [action.name, action.does]),
);

/** The actions a plan for this side may name (code-built, never a model's). */
export function planRoster(side: QSituationSide): readonly RosterEntry[] {
  const apps: RosterEntry[] = APP_ACTION_NAMES.flatMap((entry) => {
    const does = APP_ACTION_DOES.get(entry.name);
    return does === undefined || !entry.sides.includes(side)
      ? []
      : [
          {
            kind: "APP_ACTION" as const,
            name: entry.name,
            does,
            sides: entry.sides,
          },
        ];
  });
  return [
    ...PROPOSALS.filter(
      (entry) => entry.kind !== "TOOL_PROPOSAL" || entry.sides.includes(side),
    ),
    ...apps,
    ...WORKFORCE_ROSTER.filter(
      (entry) => side === "INVESTOR" || entry.name !== "MANDATE_WATCHER",
    ),
  ];
}

export function rosterText(roster: readonly RosterEntry[]): string {
  return roster
    .map((entry) => {
      switch (entry.kind) {
        case "TOOL_PROPOSAL":
          return `TOOL_PROPOSAL ${entry.name}: ${entry.does} (prepared for your approval)`;
        case "APP_ACTION":
          // The writer's owner rule reads this mark (PLAN_WRITE v3): Q
          // prepares it and the person approves it on its own card.
          return `APP_ACTION ${entry.name}: ${entry.does.slice(0, 160)}${
            APP_ACTION_CLASS.get(entry.name) === "CONSEQUENTIAL"
              ? " (needs your approval)"
              : ""
          }`;
        case "WORKFORCE":
          return `WORKFORCE ${entry.name}: ${entry.does}`;
      }
    })
    .join("\n")
    .slice(0, 8_000);
}

/**
 * The step's owner, action and whether it needs approval, decided by CODE
 * from the action's class (the model only suggested them). An action not
 * in the roster becomes the person's task: Q never names what it cannot do.
 */
export function classifyStep(
  suggested: {
    readonly owner: QPlanStepOwner;
    readonly action: PlanStepAction;
  },
  roster: readonly RosterEntry[],
): {
  readonly owner: QPlanStepOwner;
  readonly action: QPlanStepAction;
  readonly needsApproval: boolean;
} {
  const task = {
    owner: (suggested.owner === "TOGETHER"
      ? "TOGETHER"
      : "YOU") as QPlanStepOwner,
    action: { kind: "TASK" } as const,
    needsApproval: false,
  };
  const { action } = suggested;
  // Prepared by Q, finished by the person when they said so.
  const byQ: QPlanStepOwner = suggested.owner === "TOGETHER" ? "TOGETHER" : "Q";
  switch (action.kind) {
    case "TASK":
      return task;
    case "TOOL_PROPOSAL": {
      const known = roster.some(
        (entry) => entry.kind === "TOOL_PROPOSAL" && entry.name === action.tool,
      );
      // A proposal is a card the person approves before anything happens.
      return known
        ? {
            owner: byQ,
            action: { kind: "TOOL_PROPOSAL", tool: action.tool },
            needsApproval: true,
          }
        : task;
    }
    case "APP_ACTION": {
      const known = roster.some(
        (entry) => entry.kind === "APP_ACTION" && entry.name === action.name,
      );
      const klass = APP_ACTION_CLASS.get(action.name);
      return known && klass !== undefined
        ? {
            owner: byQ,
            action: { kind: "APP_ACTION", name: action.name },
            needsApproval: klass === "CONSEQUENTIAL",
          }
        : task;
    }
    case "WORKFORCE": {
      const entries = action.roles.flatMap((role) => {
        const entry = roster.find(
          (one) => one.kind === "WORKFORCE" && one.name === role,
        );
        return entry === undefined || entry.kind !== "WORKFORCE" ? [] : [entry];
      });
      if (entries.length === 0) return task;
      const outward = entries.some((entry) => entry.outward);
      return {
        owner: byQ,
        action: {
          kind: "WORKFORCE",
          roles: [...new Set(entries.map((entry) => entry.name))],
        },
        needsApproval: outward,
      };
    }
  }
}

// --- the dossier as the prompts read it ---------------------------------------------

const SOURCE_WORDS: Readonly<Record<QSituationSource, string>> = {
  ACTIVITY: "WHAT YOU DID RECENTLY",
  RELATIONSHIPS: "RELATIONSHIPS",
  MESSAGES: "MESSAGES",
  SCHEDULE: "SCHEDULE",
  BOARD: "BOARD",
  Q_WORK: "Q'S WORK AND APPROVALS",
  MEMORY: "WHAT Q REMEMBERS",
  Q_DAILY: "THE Q DAILY",
  PUBLIC: "PUBLIC SOURCES",
  INTEREST: "INTEREST FROM INVESTORS",
  PROSPECTS: "PROSPECTS",
  PROFILE: "PROFILE AS INVESTORS SEE IT",
  DECK: "DECK",
  DATA_ROOM: "DATA ROOM",
  PITCH_VIDEO: "PITCH VIDEO",
  READINESS: "READINESS",
  CLAIMS: "CLAIMS AND EVIDENCE",
  CAPITAL: "CAPITAL",
  MANDATE: "MANDATE",
  GATEQ: "GATEQ INBOX",
  FEED_DECISIONS: "SAVED AND PASSED",
};

/** The dossier as text: sections of facts with refs and truth class. */
export function situationText(dossier: QSituationDossier): string {
  const lines: string[] = [];
  for (const section of dossier.sections) {
    if (section.status === "NOT_APPLICABLE") continue;
    const name = SOURCE_WORDS[section.source];
    if (section.status === "UNAVAILABLE") {
      lines.push(`${name} [${section.source}]: UNAVAILABLE (not known)`);
      continue;
    }
    lines.push(
      `${name} [${section.source}]${section.facts.length === 0 ? ": read, nothing there" : ""}`,
    );
    for (const fact of section.facts) {
      const asOf = fact.asOf === null ? "" : `, as of ${fact.asOf}`;
      lines.push(
        `${fact.ref} (${fact.truthClass}${asOf}) ${fact.statement.replace(/\s+/gu, " ")}`,
      );
    }
  }
  return lines.join("\n").slice(0, 24_000);
}

/**
 * Facts added to one section after assembly (the deck as Q read it), with
 * refs that follow the dossier's last one; bounded per section and in
 * total, and validated by the contract again.
 */
export function withFacts(
  dossier: QSituationDossier,
  source: QSituationSource,
  facts: readonly Omit<
    QSituationDossier["sections"][number]["facts"][number],
    "ref"
  >[],
): QSituationDossier {
  const section = dossier.sections.find((one) => one.source === source);
  if (section === undefined || section.status === "NOT_APPLICABLE") {
    return dossier;
  }
  const total = situationFacts(dossier).length;
  const room = Math.max(
    0,
    Math.min(
      Q_SITUATION_FACTS_PER_SECTION_MAX - section.facts.length,
      Q_SITUATION_FACTS_MAX - total,
    ),
  );
  if (room === 0 || facts.length === 0) return dossier;
  let next =
    situationFacts(dossier).reduce(
      (max, fact) => Math.max(max, Number(fact.ref.slice(1))),
      0,
    ) + 1;
  const added = facts.slice(0, room).map((fact) => ({
    ...fact,
    ref: `F${String(next++)}`,
  }));
  const sections: QSituationSection[] = dossier.sections.map((one) =>
    one.source === source
      ? {
          ...one,
          status: "READ",
          reason: null,
          facts: [...one.facts, ...added],
          truncated: one.truncated || facts.length > room,
        }
      : one,
  );
  const parsed = QSituationDossierSchema.safeParse({
    ...dossier,
    sections,
    unknowns: sections
      .filter((one) => one.status === "UNAVAILABLE")
      .map((one) => one.source),
  });
  return parsed.success ? parsed.data : dossier;
}

// --- grounding a written plan ----------------------------------------------------

const ROLE_WORDS_ROLE_FREE =
  /\b(?:job|specialist|lane|workforce|agent|dossier)\b/giu;

/** A model's key ("S1", "step-2") as a stable lower_snake key, unique in the plan. */
function stepKeyOf(raw: string, taken: Set<string>): string {
  let key = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (!/^[a-z]/u.test(key)) key = `s_${key}`;
  key = key.slice(0, 60) || "step";
  let unique = key;
  for (let n = 2; taken.has(unique); n += 1) unique = `${key}_${String(n)}`;
  taken.add(unique);
  return unique;
}

/**
 * A fact ref written into the words ("(F23)", "(F29, F31)", "F12") rather
 * than into cites. Live 2026-10-29: "(F23)" reached the person on every
 * step. The refs stay data (cites); the card shows them as a "why" link.
 */
const REF_IN_WORDS =
  /\s*[([]\s*(?:[FP][1-9]\d{0,3}\s*(?:[,;/]|and)?\s*)+[)\]]|\b[FP][1-9]\d{0,3}\b/gu;

/** The words without fact refs; the spacing and punctuation left tidy. */
export function withoutRefs(text: string): string {
  return text
    .replace(REF_IN_WORDS, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\(\s*\)/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/**
 * Cut to `max` at the last sentence end that fits, never mid-word or
 * mid-sentence with a dangling ellipsis (live 2026-10-29: "payback,…").
 * With no sentence end in reach, the last whole clause or word, closed with
 * a full stop.
 */
export function sentenceClip(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  let end = -1;
  for (const match of room.matchAll(/[.!?](?=\s|$)/gu)) {
    end = match.index + 1;
  }
  if (end >= Math.floor(max / 3)) return room.slice(0, end).trim();
  const clause = Math.max(room.lastIndexOf(";"), room.lastIndexOf(","));
  const space = room.lastIndexOf(" ");
  const cut = clause > max / 2 ? clause : space > 0 ? space : max - 1;
  return `${room.slice(0, cut).replace(/[\s,;:]+$/u, "")}.`;
}

/** The person's words: no internal names reach them (addendum 3 rule 4). */
function plainWords(text: string, max: number): string {
  const clean = withoutRefs(text.replace(/\s+/gu, " ").trim());
  // The writer is told never to use these; a slip is softened, not passed.
  const softened = clean.replace(ROLE_WORDS_ROLE_FREE, (word) =>
    /^job$/iu.test(word)
      ? "work"
      : /^dossier$/iu.test(word)
        ? "situation"
        : "Q",
  );
  return sentenceClip(softened, max);
}

export type GroundedPlan = {
  readonly goal: string;
  readonly situationSummary: string;
  readonly situationRefs: readonly string[];
  readonly steps: readonly QPlanStep[];
  readonly openQuestions: readonly string[];
  readonly specialists: readonly QSpecialistDefinition[];
  /** Cites dropped because they did not resolve; steps dropped with none left. */
  readonly droppedCites: number;
  readonly droppedSteps: number;
};

/** Tools a specialist for public research may use (intersected with the run's). */
export const SPECIALIST_BASE_TOOLS: readonly string[] = [
  "research_public_web",
  "extract_public_web",
  "lookup_public_profile",
];

/**
 * The written plan, grounded by code: refs resolved against the dossier
 * (an invented one dropped; a step with none left dropped), keys made
 * stable, owners and approval re-derived, words kept plain. Steps keep the
 * writer's order; dates must be calendar days.
 */
export function groundPlan(input: {
  readonly written: PlanWriteResult;
  readonly dossier: QSituationDossier;
  readonly roster: readonly RosterEntry[];
  /** Keys the person's earlier version used, kept where the writer kept them. */
  readonly priorKeys?: ReadonlyMap<string, string> | undefined;
  /** The run's context-eligible tools, for a specialist's (S6). */
  readonly eligibleTools?: ReadonlySet<string> | undefined;
}): GroundedPlan {
  const refs = new Set(situationFacts(input.dossier).map((fact) => fact.ref));
  let droppedCites = 0;
  let droppedSteps = 0;
  const taken = new Set<string>();
  const ground = (cites: readonly string[]) => {
    const kept = [...new Set(cites)].filter((ref) => refs.has(ref));
    droppedCites += cites.length - kept.length;
    return kept.slice(0, 8);
  };
  const steps: QPlanStep[] = [];
  const specialists: QSpecialistDefinition[] = [];
  for (const step of input.written.steps.slice(0, Q_PLAN_STEPS_MAX)) {
    const cites = ground(step.cites);
    if (cites.length === 0) {
      droppedSteps += 1;
      continue;
    }
    const classified = classifyStep(step, input.roster);
    const key = input.priorKeys?.get(step.key) ?? stepKeyOf(step.key, taken);
    taken.add(key);
    steps.push({
      key,
      title: plainWords(step.title, 160),
      why: plainWords(step.why, 600),
      cites,
      owner: classified.owner,
      action: classified.action,
      needsApproval: classified.needsApproval,
      due: dueOf(step),
      evidenceNeeded: step.evidenceNeeded
        .slice(0, 6)
        .map((one) => plainWords(one, 200)),
      status: "TODO",
      waitsFor: [],
      boardItemId: null,
      proposalId: null,
      reminderId: null,
      jobId: null,
    });
    const specialist = specialistFor(steps.at(-1), input.eligibleTools);
    if (specialist !== null) specialists.push(specialist);
  }
  const situationRefs = [
    ...new Set([
      ...ground(input.written.situationRefs),
      ...steps.flatMap((step) => step.cites),
    ]),
  ].slice(0, 120);
  return {
    goal: plainWords(input.written.goal, 500),
    situationSummary: plainWords(input.written.situationSummary, 600),
    situationRefs,
    steps: derivedWaits(steps),
    openQuestions: input.written.openQuestions
      .slice(0, 6)
      .map((one) => plainWords(one, 300)),
    specialists: specialists.slice(0, 4),
    droppedCites,
    droppedSteps,
  };
}

function dueOf(step: PlanWriteStep): string | null {
  if (step.due === null) return null;
  const at = Date.parse(`${step.due}T00:00:00Z`);
  return Number.isFinite(at) ? step.due : null;
}

/**
 * Addendum 1: a Q-owned WORKFORCE step that no built-in role covers
 * (AD_HOC) gets a specialist: named plainly from the step's own title,
 * with only public-research tools the run may use -- never wider than the
 * context's eligible tools. None when no eligible tool is left.
 */
export function specialistFor(
  step: QPlanStep | undefined,
  eligible: ReadonlySet<string> | undefined,
): QSpecialistDefinition | null {
  if (
    step === undefined ||
    step.owner === "YOU" ||
    step.action.kind !== "WORKFORCE" ||
    !step.action.roles.includes("AD_HOC")
  ) {
    return null;
  }
  const tools = SPECIALIST_BASE_TOOLS.filter(
    (tool) => eligible === undefined || eligible.has(tool),
  );
  if (tools.length === 0) return null;
  const words = step.title
    .replace(/[^\p{L}\p{N} '&-]+/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .slice(0, 5)
    .join(" ");
  const name = (words.length >= 2 ? words : "Q's helper").slice(0, 60);
  return {
    stepKey: step.key,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    purpose: step.why.slice(0, 300),
    tools,
    examples: [step.title.slice(0, 300)],
    budgetUsd: 0.2,
    maxModelCalls: 4,
  };
}

/**
 * Code's own checks (design B3): every step cites, every cite resolves
 * (held by grounding), and no section that was read and holds facts is
 * left unused without the plan saying why. Returned as numbered fixes.
 */
export function codeChecks(
  plan: Pick<GroundedPlan, "steps" | "situationRefs" | "openQuestions">,
  dossier: QSituationDossier,
  grounding: Pick<GroundedPlan, "droppedCites" | "droppedSteps">,
): readonly string[] {
  const used = new Set(plan.situationRefs);
  const fixes: string[] = [];
  if (grounding.droppedSteps > 0) {
    fixes.push(
      `${String(grounding.droppedSteps)} step(s) cited no fact of the situation and were dropped: ground every step in a cited ref.`,
    );
  } else if (grounding.droppedCites > 0) {
    fixes.push(
      "Some cites named refs the situation does not hold: cite only refs listed in THE SITUATION.",
    );
  }
  // A step that waits for another is due after it (code, not a reviewer).
  const due = new Map(plan.steps.map((step) => [step.key, step.due]));
  for (const step of plan.steps) {
    for (const wait of step.waitsFor) {
      if (wait.kind !== "STEP_DONE") continue;
      const before = due.get(wait.stepKey) ?? null;
      if (step.due !== null && before !== null && step.due < before) {
        fixes.push(
          `[${step.key}] It needs ${wait.stepKey} done first but is due before it (${step.due} < ${before}): move its date after ${before}.`,
        );
      }
    }
  }
  // Sharing a document is the person's decision, approved on its own.
  for (const step of plan.steps) {
    if (
      step.action.kind === "APP_ACTION" &&
      step.action.name === "document.access.share" &&
      !step.needsApproval
    ) {
      fixes.push(
        `[${step.key}] It shares a document without the person's own approval of that share: make it a step they approve.`,
      );
    }
  }
  for (const section of dossier.sections) {
    if (section.status !== "READ" || section.facts.length === 0) continue;
    if (section.source === "MEMORY" || section.source === "Q_DAILY") continue;
    // Their own recent acts are context, not a gap the plan must close.
    if (section.source === "ACTIVITY") continue;
    if (section.facts.some((fact) => used.has(fact.ref))) continue;
    fixes.push(
      `Nothing in the plan uses ${SOURCE_WORDS[section.source]} (${section.facts
        .slice(0, 3)
        .map((fact) => fact.ref)
        .join(
          ", ",
        )}): use it, or say in an open question why it does not matter.`,
    );
  }
  return fixes.slice(0, 6);
}

// --- reviews ---------------------------------------------------------------------

/**
 * One reviewer's result on the contract's rubric. Lane B's rubric has
 * eight items; the contract's plan-rubric/v1 has six with other weights.
 * The mapping is exact (every point lands in one item, sums preserved), so
 * the contract's pass equals planReviewScore's: the bar and integrity.
 */
export function reviewOf(
  result: PlanReviewResult,
  reviewer: "R1" | "R2",
  round: number,
  promptVersion: string,
): QPlanReview {
  const verdict = planReviewScore(result);
  const asks = result.asksNothingKnown.score;
  const note = (...items: (keyof typeof PLAN_RUBRIC_V1)[]) =>
    wordClip(
      items
        .flatMap((item) => result[item].defects.map((defect) => defect.problem))
        .join(" "),
      300,
    );
  const items: QPlanReview["items"] = [
    {
      item: "SITUATION_COVERAGE",
      score: result.situationCoverage.score + Math.ceil(asks / 2),
      max: 20,
      note: note("situationCoverage", "asksNothingKnown"),
    },
    {
      item: "SPECIFICITY",
      score: result.specificity.score + Math.floor(asks / 2),
      max: 25,
      note: note("specificity"),
    },
    {
      item: "STEPS_CITE_FACTS",
      score: result.citesFacts.score,
      max: 15,
      note: note("citesFacts"),
    },
    {
      item: "OWNER_CLASSIFICATION",
      score: result.ownerClassification.score,
      max: 10,
      note: note("ownerClassification"),
    },
    {
      item: "FEASIBILITY_ORDER",
      score: result.feasibility.score + result.roleCorrectWording.score,
      max: 15,
      note: note("feasibility", "roleCorrectWording"),
    },
    {
      item: "NO_INVENTED_FACTS",
      score: result.noInventedFacts.score,
      max: 15,
      note: note("noInventedFacts"),
    },
  ];
  return {
    reviewer,
    round,
    score: verdict.score,
    passed: verdict.passes,
    items,
    fixes: reviewFixes(result).slice(0, 12),
    integrityFailed: verdict.fatal,
    promptVersion,
  };
}

/** What a reviewer still wants, kept whole: the problem and its fix apart. */
export type ReviewPoint = {
  readonly reviewer: "R1" | "R2";
  /** The rubric item it was deducted under ("firewall" for a breach). */
  readonly item: keyof typeof PLAN_RUBRIC_V1 | "firewall";
  readonly stepKey: string | null;
  readonly problem: string;
  readonly fix: string;
};

/** Integrity first, then the items a redraft most often misses. */
const REVIEW_ORDER: readonly (keyof typeof PLAN_RUBRIC_V1)[] = [
  "noInventedFacts",
  "citesFacts",
  "asksNothingKnown",
  "specificity",
  "situationCoverage",
  "ownerClassification",
  "feasibility",
  "roleCorrectWording",
];

/**
 * An integrity verdict with no defect named. Live 2026-10-30 (plan job
 * dd352104): R1 scored 97 with noInventedFacts full, so its fatal verdict
 * could only be firewall.held false -- with no defect listed, the redraft
 * and the person were told nothing about it. Code says so in its own
 * words; the verdict stays fatal.
 */
export const FIREWALL_UNNAMED: Pick<ReviewPoint, "problem" | "fix"> = {
  problem:
    "A reviewer judged that the plan may carry private material it should not, without naming the step.",
  fix: "Make sure no step states or shares an investor's private notes or decisions, and that your own private or held-back documents are only named as held back, never quoted, and shared only through their own approval step.",
};
export const INVENTED_UNNAMED: Pick<ReviewPoint, "problem" | "fix"> = {
  problem:
    "A reviewer judged that the plan states something the situation does not hold, without naming it.",
  fix: "Check every name, figure, date and status against the situation, and say a pending approval or open task as pending, never as done.",
};

/** A reviewer's defects, whole and in order: integrity first. */
export function reviewPoints(
  result: PlanReviewResult,
  reviewer: "R1" | "R2",
): readonly ReviewPoint[] {
  const points: ReviewPoint[] = [];
  const add = (
    item: ReviewPoint["item"],
    defect: Pick<ReviewPoint, "problem" | "fix"> & {
      readonly stepKey: string | null;
    },
  ) => {
    const point = {
      reviewer,
      item,
      stepKey: defect.stepKey,
      problem: defect.problem.trim(),
      fix: defect.fix.trim(),
    };
    if (!points.some((one) => samePoint(one, point))) points.push(point);
  };
  for (const defect of result.firewall.defects) add("firewall", defect);
  if (!result.firewall.held && result.firewall.defects.length === 0) {
    add("firewall", { stepKey: null, ...FIREWALL_UNNAMED });
  }
  for (const item of REVIEW_ORDER) {
    for (const defect of result[item].defects) add(item, defect);
    if (
      item === "noInventedFacts" &&
      result[item].score < PLAN_RUBRIC_V1[item] &&
      result[item].defects.length === 0
    ) {
      add(item, { stepKey: null, ...INVENTED_UNNAMED });
    }
  }
  return points;
}

const plainKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

function samePoint(a: ReviewPoint, b: ReviewPoint): boolean {
  return (
    a.stepKey === b.stepKey &&
    plainKey(a.problem) === plainKey(b.problem) &&
    plainKey(a.fix) === plainKey(b.fix)
  );
}

/**
 * Both reviewers' points as one list: the same step's deduction under the
 * same rubric item, raised by both, is one point (the first reviewer's
 * words, the other's fix kept as well when it differs). Structural only:
 * the step and the rubric item each reviewer chose, never the wording.
 */
export function mergedPoints(
  points: readonly ReviewPoint[],
): readonly (ReviewPoint & { readonly alsoFix: string | null })[] {
  const merged: (ReviewPoint & { alsoFix: string | null })[] = [];
  for (const point of points) {
    const same = merged.find(
      (one) =>
        one.reviewer !== point.reviewer &&
        one.stepKey !== null &&
        one.stepKey === point.stepKey &&
        one.item === point.item,
    );
    if (same === undefined) {
      if (!merged.some((one) => samePoint(one, point))) {
        merged.push({ ...point, alsoFix: null });
      }
      continue;
    }
    if (same.alsoFix === null && plainKey(same.fix) !== plainKey(point.fix)) {
      same.alsoFix = point.fix;
    }
  }
  return merged;
}

/** "[s2] problem Fix: fix" -- whole, never cut (the redraft reads it). */
export function pointText(
  point: Pick<ReviewPoint, "stepKey" | "problem" | "fix"> & {
    readonly alsoFix?: string | null;
  },
): string {
  const also =
    point.alsoFix === null || point.alsoFix === undefined
      ? ""
      : ` The other reviewer's fix: ${point.alsoFix}`;
  return `${point.stepKey === null ? "" : `[${point.stepKey}] `}${point.problem} Fix: ${point.fix}${also}`;
}

/**
 * Cut at a word boundary, never mid-word: the last whole sentence that
 * fits, else the last whole word with an ellipsis. Live 2026-10-30: the
 * reviewers' fixes reached the person as "source-", "Ledge", "wh".
 */
export function wordClip(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max - 1);
  let end = -1;
  for (const match of room.matchAll(/[.!?](?=\s|$)/gu)) {
    end = match.index + 1;
  }
  if (end >= Math.floor(max / 2)) return room.slice(0, end);
  const space = room.lastIndexOf(" ");
  const cut = space > 0 ? space : room.length;
  return `${room.slice(0, cut).replace(/[\s,;:\-–—]+$/u, "")}…`;
}

/**
 * A reviewer's fixes as the stored review keeps them (300 characters
 * each): the step and the change wanted, split from the problem first and
 * cut only at a word boundary.
 */
export function reviewFixes(result: PlanReviewResult): readonly string[] {
  return reviewPoints(result, "R1").map((point) =>
    wordClip(
      `${point.stepKey === null ? "" : `[${point.stepKey}] `}${point.fix}`,
      300,
    ),
  );
}

/**
 * The redraft's FIXES: every point whole, numbered, within the variable's
 * 6,000 characters -- a point that does not fit is left out whole (and
 * counted), never cut mid-way.
 */
export function redraftFixes(
  lines: readonly string[],
  max = 6_000,
): { readonly text: string; readonly left: number } {
  const kept: string[] = [];
  let used = 0;
  let left = 0;
  for (const line of [...new Set(lines)]) {
    const numbered = `${String(kept.length + 1)}. ${line}`;
    if (used + numbered.length + 1 > max) {
      left += 1;
      continue;
    }
    kept.push(numbered);
    used += numbered.length + 1;
  }
  return { text: kept.join("\n"), left };
}

// --- the job -----------------------------------------------------------------------

export const PLAN_PROMPT_VERSION = "PLAN_WRITE@3+PLAN_REVIEW@3";
/**
 * Addendum 4: at most one redraft under the six-call budget (write, two
 * reviews, redraft, two reviews). The contract allows up to two.
 */
export const PLAN_JOB_REDRAFTS = Math.min(1, Q_PLAN_MAX_REDRAFTS);
export const PLAN_JOB_MODEL_CALLS_MAX = 6;

export type PlanDocumentRead = (
  context: QToolExecutionContext,
  subject: SituationSubject,
) => Promise<
  readonly Omit<QSituationDossier["sections"][number]["facts"][number], "ref">[]
>;

export type PlanJobDependencies = {
  readonly assembler: SituationAssembler;
  /** The asker's own tool context (their firewall plan), resolved now. */
  readonly toolContext: (
    actor: ActorContext,
    runId: string,
  ) => Promise<QToolExecutionContext | null>;
  readonly models: Pick<WorkforceModels, "writePlan" | "reviewPlan">;
  readonly store: PlanStore;
  /** READING_DOCUMENTS: their own deck as Q read it (own-company asks). */
  readonly documents?: PlanDocumentRead | undefined;
  /**
   * Their own figures (what they told Q, what they confirmed from their
   * financial documents, set against their deck) and which documents are
   * held back from Q, as CAPITAL facts. Live 2026-10-29: the founder's
   * recorded cash and burn were called "not established".
   */
  readonly figures?:
    | ((
        context: QToolExecutionContext,
        subject: SituationSubject,
      ) => Promise<readonly RawFact[]>)
    | undefined;
  /** SEARCHING: deep research for this job, under its search budget. */
  readonly research?:
    | ((input: {
        readonly actor: ActorContext;
        readonly jobId: string;
        readonly runId: string;
        readonly progress: LiveReport;
      }) => SituationResearchHook | undefined)
    | undefined;
  /** Public-safe fields of their own company, for research topics. */
  readonly publicProfile?:
    | ((actor: ActorContext) => Promise<SituationPublicProfile | null>)
    | undefined;
  /** Q's eligible tools for this context (a specialist's are a subset). */
  readonly tools?: Pick<QToolPort, "offer"> | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

export type PlanJobInput = {
  readonly actor: ActorContext;
  readonly owner: Owner;
  readonly jobId: string;
  /** The job's lead run: the model calls are priced under it. */
  readonly leadRunId: string;
  /** The Q run the ask came in (its firewall plan and conversation). */
  readonly runId: string;
  readonly payload: PlanJobPayload;
  readonly progress?: LiveReport | undefined;
};

export type PlanJobOutcome =
  | {
      readonly status: "OFFERED";
      readonly planId: string;
      readonly version: number;
      readonly block: QPlanBlock;
      /** What Q says when it lands: code's words. */
      readonly line: string;
      readonly modelCalls: number;
    }
  /** Planning failed: Q answers from what it holds instead (addendum 3 rule 3). */
  | {
      readonly status: "ANSWERED";
      readonly line: string;
      readonly modelCalls: number;
    }
  | {
      readonly status: "FAILED";
      readonly reason: string;
      readonly modelCalls: number;
    };

/** The canonical body hash an approval binds to. */
export function planBodySha256(plan: QPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function todayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function runPlanJob(
  dependencies: PlanJobDependencies,
  input: PlanJobInput,
): Promise<PlanJobOutcome> {
  const { payload, actor, owner } = input;
  const now = dependencies.now ?? (() => new Date());
  const progress = safeReport(input.progress);
  // Where the job's time goes, per stage (logged with the outcome).
  const clock = () => Date.now();
  const timings: { step: string; ms: number }[] = [];
  let stepStart = clock();
  const writePlan = dependencies.models.writePlan;
  const reviewPlan = dependencies.models.reviewPlan;
  let modelCalls = 0;
  const side: QSituationSide = payload.subject.side;
  const who: Who = { tenantId: owner.tenantId, userId: owner.userId };
  const trace = { jobId: input.jobId, runId: input.leadRunId };
  // The team thread (S6): what each stage did, as status lines the
  // person may see (code's words), idempotent per job and stage.
  const say = async (
    planId: string | null,
    kind: "STATUS" | "FINDING" | "NOTE",
    author: "PLANNER" | "RESEARCH" | "REVIEWER" | "WORKER",
    stepKey: string | null,
    text: string,
    key: string,
  ) => {
    await dependencies.store
      .appendThread(owner, {
        planId: planId === null ? null : QPlanIdSchema.parse(planId),
        jobId: input.jobId,
        kind,
        author,
        stepKey,
        factRef: null,
        text,
        idempotencyKey: `plan-job:${input.jobId}:${key}`,
      })
      .catch(() => undefined);
  };

  if (writePlan === undefined || reviewPlan === undefined) {
    return {
      status: "FAILED",
      reason: "Planning is not available.",
      modelCalls,
    };
  }

  // A resumed job whose plan was already kept is delivered, never redone.
  const idempotencyKey = `plan-job:${input.jobId}`;
  const priorPlanId =
    payload.mode === "CHANGE" && payload.planId !== null
      ? payload.planId
      : null;

  // --- GATHERING_SITUATION -----------------------------------------------------
  progress({ stage: "GATHERING" });
  await say(
    null,
    "STATUS",
    "PLANNER",
    null,
    "Gathering your situation",
    "gathering",
  );
  const context = await dependencies
    .toolContext(actor, input.runId)
    .catch(() => null);
  if (context === null) {
    return {
      status: "FAILED",
      reason: "Your records could not be read as you just now.",
      modelCalls,
    };
  }
  const subject: SituationSubject =
    payload.subject.side === "FOUNDER"
      ? { side: "FOUNDER", companyId: payload.subject.companyId }
      : {
          side: "INVESTOR",
          investorOrganisationId: payload.subject.investorOrganisationId,
        };
  const publicProfile =
    (await dependencies.publicProfile?.(actor).catch(() => null)) ?? null;
  let dossier = await dependencies.assembler.assemble({
    context,
    subject,
    ask: payload.ask,
    ...(publicProfile === null ? {} : { publicProfile }),
  });
  const readSections = dossier.sections.filter(
    (section) => section.status === "READ",
  ).length;
  progress({
    stage: "GATHERING",
    sources: readSections,
    facts: situationFacts(dossier).length,
  });

  // --- READING_DOCUMENTS beside SEARCHING (addendum 4: in parallel) ---------
  const ownCompany = side === "FOUNDER";
  const wantsResearch = payload.research !== "NONE";
  if (ownCompany) progress({ stage: "READING_DOCUMENTS" });
  const documents =
    ownCompany && dependencies.documents !== undefined
      ? dependencies.documents(context, subject).catch(() => [])
      : Promise.resolve([]);
  const hook = wantsResearch
    ? dependencies.research?.({
        actor,
        jobId: input.jobId,
        runId: input.leadRunId,
        progress,
      })
    : undefined;
  if (hook !== undefined && !ownCompany) progress({ stage: "SEARCHING" });
  const researched =
    hook === undefined
      ? Promise.resolve(dossier)
      : dependencies.assembler
          .research(dossier, { hook, ask: payload.ask })
          .catch(() => dossier);
  const figures =
    ownCompany && dependencies.figures !== undefined
      ? dependencies.figures(context, subject).catch(() => [])
      : Promise.resolve([]);
  const [deckFacts, figureFacts, withPublic] = await Promise.all([
    documents,
    figures,
    researched,
  ]);
  dossier = withFacts(
    withFacts(withPublic, "DECK", deckFacts),
    "CAPITAL",
    figureFacts,
  );
  timings.push({ step: "gather", ms: clock() - stepStart });
  if (hook !== undefined) {
    const publicSection = dossier.sections.find(
      (section) => section.source === "PUBLIC",
    );
    progress({
      stage: "SEARCHING",
      facts: publicSection?.facts.length ?? 0,
    });
  }

  // --- DRAFTING_PLAN -------------------------------------------------------------
  progress({ stage: "PLANNING", title: payload.summary.slice(0, 160) });
  await say(null, "STATUS", "PLANNER", null, "Drafting the plan", "drafting");
  const roster = planRoster(side);
  const allowedActions = rosterText(roster);
  const situation = situationText(dossier) || "(nothing could be read)";
  const publicFindings =
    "Public findings, when any, are in THE SITUATION under PUBLIC SOURCES and are cited by their F refs.";
  const eligibleTools = await eligibleToolsOf(dependencies.tools, context);
  const prior =
    priorPlanId === null
      ? null
      : await dependencies.store
          .read(owner, priorPlanId, payload.fromVersion ?? undefined)
          .catch(() => null);
  const direction =
    payload.mode === "CHANGE" && payload.directionId !== null && prior !== null
      ? await directionText(
          dependencies.store,
          owner,
          prior.plan.planId,
          payload.directionId,
        )
      : null;

  // S6: what the person said to this work while it ran (DIRECTION on the
  // job's thread), re-read before each draft; their own words, as data.
  const directionsNow = async (): Promise<readonly string[]> =>
    (
      await dependencies.store
        .readThread(owner, { jobId: input.jobId }, { kinds: ["DIRECTION"] })
        .catch(() => [])
    ).map((entry) => entry.text);
  const heard = await directionsNow();
  const base: Omit<PlanWriteInput, "mode" | "priorPlan" | "fixes"> = {
    side,
    today: todayOf(now()),
    ask:
      heard.length === 0
        ? payload.ask
        : `${payload.ask}\n\nThey added since: ${heard.join(" / ")}`.slice(
            0,
            2_000,
          ),
    situation,
    publicFindings,
    allowedActions,
  };
  const firstInput: PlanWriteInput = {
    ...base,
    mode: prior === null ? "NEW" : "REDRAFT",
    // Said, never left empty: MODE NEW has no prior plan, and no fixes
    // means none (PROMPT_EMPTY_CASES), not "(not provided)".
    priorPlan:
      prior === null
        ? PROMPT_EMPTY_CASES.PLAN_WRITE.priorPlan
        : JSON.stringify(writtenOf(prior.plan)).slice(0, 16_000),
    fixes:
      direction === null
        ? PROMPT_EMPTY_CASES.PLAN_WRITE.fixes
        : `1. The person asked for this change: ${direction}`.slice(0, 6_000),
  };
  modelCalls += 1;
  stepStart = clock();
  let refused: readonly string[] = [];
  let first = await writePlan(who, trace, firstInput, (paths) => {
    refused = paths;
  });
  if (first === null && refused.length > 0) {
    // Once more, told exactly which fields were refused (paths and codes,
    // never a value). Live 2026-10-29: the identical second attempt failed
    // as the first did, and the person got no plan.
    dependencies.logger?.warn(
      { jobId: input.jobId, refusals: refused },
      "plan write refused; asked once more with the refused fields",
    );
    modelCalls += 1;
    first = await writePlan(who, trace, {
      ...firstInput,
      fixes: [
        firstInput.fixes,
        `${firstInput.fixes === "" ? "1" : "2"}. Your last answer was refused for these fields (path: reason): ${refused.join("; ")}. Keep every list and text within the limits stated in THE SHAPE, and use only the fields listed there.`,
      ]
        .filter((part) => part !== "")
        .join("\n")
        .slice(0, 6_000),
    });
  }
  timings.push({ step: "write", ms: clock() - stepStart });
  if (first === null || first.steps.length === 0) {
    return {
      status: "ANSWERED",
      line: fromWhatQHolds(dossier),
      modelCalls,
    };
  }
  const clarification = first.clarification;
  const written = first;
  let grounded = groundPlan({
    written,
    dossier,
    roster,
    ...(prior === null ? {} : { priorKeys: keysOf(prior.plan) }),
    eligibleTools,
  });
  if (grounded.steps.length === 0) {
    return { status: "ANSWERED", line: fromWhatQHolds(dossier), modelCalls };
  }

  // --- REVIEWING_PLAN: two in parallel, one redraft at most ------------------
  let reviews: QPlanReview[] = [];
  /** The failing reviewers' points of the latest round, whole. */
  let failing: ReviewPoint[] = [];
  const rounds: {
    round: number;
    scores: number[];
    integrity: boolean[];
    points: number;
  }[] = [];
  let redrafts = 0;
  for (let round = 1; ; round += 1) {
    progress({
      stage: "REVIEWING_PLAN",
      draft: round,
      drafts: PLAN_JOB_REDRAFTS + 1,
    });
    await say(
      null,
      "STATUS",
      "REVIEWER",
      null,
      round === 1 ? "Reviewing the plan" : "Reviewing the revised plan",
      `reviewing:${String(round)}`,
    );
    const planJson = JSON.stringify(writtenOfGrounded(grounded)).slice(
      0,
      16_000,
    );
    modelCalls += 2;
    stepStart = clock();
    const results = await Promise.all(
      PLAN_REVIEW_FOCI.map((focus) =>
        reviewPlan(who, trace, {
          side,
          focus,
          ask: payload.ask,
          situation,
          publicFindings,
          allowedActions,
          plan: planJson,
        }).catch(() => null),
      ),
    );
    timings.push({ step: `review${String(round)}`, ms: clock() - stepStart });
    reviews = [];
    failing = [];
    results.forEach((result, index) => {
      if (result === null) return;
      const reviewer = index === 0 ? "R1" : "R2";
      const mapped = reviewOf(result, reviewer, round, PLAN_PROMPT_VERSION);
      reviews.push(mapped);
      // A passing reviewer's remarks are not what keeps the plan a draft.
      if (!mapped.passed) failing.push(...reviewPoints(result, reviewer));
    });
    rounds.push({
      round,
      scores: reviews.map((review) => review.score),
      integrity: reviews.map((review) => review.integrityFailed),
      points: failing.length,
    });
    const code = codeChecks(grounded, dossier, grounded);
    const passed =
      reviews.length === 2 && reviews.every((review) => review.passed);
    // Code's own points ride along with a redraft the reviewers asked
    // for; when both passed they are listed with the plan, not redrafted.
    if (passed) break;
    if (
      redrafts >= PLAN_JOB_REDRAFTS ||
      modelCalls + 3 > PLAN_JOB_MODEL_CALLS_MAX
    )
      break;
    // A redraft with the numbered defects (the reviewers' and code's),
    // each whole: live 2026-10-30, every fix was cut at 300 characters
    // with its problem ("... after the revised de"), so the writer was
    // never told the end of what to change.
    const said = await directionsNow();
    const fixes = [
      ...said
        .filter((text) => !heard.includes(text))
        .map((text) => `The person asked for this change: ${text}`),
      ...mergedPoints(failing).map(pointText),
      ...code,
    ];
    if (fixes.length === 0) break;
    redrafts += 1;
    const numbered = redraftFixes(fixes);
    if (numbered.left > 0) {
      dependencies.logger?.warn(
        { jobId: input.jobId, round, left: numbered.left },
        "plan redraft: points left out to fit the fixes limit",
      );
    }
    progress({
      stage: "PLANNING",
      draft: round + 1,
      drafts: PLAN_JOB_REDRAFTS + 1,
      openPoints: fixes.length,
    });
    modelCalls += 1;
    stepStart = clock();
    const again = await writePlan(who, trace, {
      ...base,
      mode: "REDRAFT",
      priorPlan: planJson,
      fixes: numbered.text,
    });
    timings.push({ step: `redraft${String(round)}`, ms: clock() - stepStart });
    if (again === null) break;
    const regrounded = groundPlan({
      written: again,
      dossier,
      roster,
      priorKeys: keysOfGrounded(grounded),
      eligibleTools,
    });
    if (regrounded.steps.length === 0) break;
    grounded = regrounded;
  }

  const fullyReviewed =
    reviews.length === 2 && reviews.every((review) => review.passed);
  const remainingCode = codeChecks(grounded, dossier, grounded);
  const openPoints = [
    ...(reviews.length < 2
      ? ["One of the two reviews could not be completed."]
      : []),
    // Whole points, one per step and rubric item across both reviewers
    // (live 2026-10-30: the same "add F55 to step 1" twice, once each).
    ...mergedPoints(failing).map((point) =>
      pointText({ ...point, alsoFix: null }),
    ),
    ...remainingCode,
  ];
  // What the reviewers still want, in the person's words: "Step 2: …",
  // the change asked for, no fact codes (live 2026-10-29: the card said
  // only "draft", and the line quoted "[s2] … cites F26 …").
  const factWords = new Map(
    situationFacts(dossier).map((fact) => [fact.ref, fact.statement]),
  );
  const points = [
    ...new Set(
      openPoints.map((point) => personPoint(point, grounded.steps, factWords)),
    ),
  ]
    .filter((point) => point.length > 0)
    .slice(0, 12);
  const review: QPlanReviewSummary = {
    rubricVersion: Q_PLAN_RUBRIC_VERSION,
    threshold: Q_PLAN_REVIEW_THRESHOLD,
    reviews,
    redrafts,
    fullyReviewed,
    openPoints:
      !fullyReviewed && points.length === 0
        ? ["The reviews did not pass the bar."]
        : points,
  };

  // --- keep it (as the person, idempotent) -----------------------------------------
  progress({ stage: "FILING" });
  const head =
    priorPlanId === null
      ? await dependencies.store.ensurePlan(owner, {
          side,
          goal: grounded.goal,
          jobId: input.jobId,
          idempotencyKey,
        })
      : await dependencies.store.head(owner, priorPlanId);
  if (head === null) {
    return {
      status: "FAILED",
      reason: "The plan could not be kept.",
      modelCalls,
    };
  }
  // A version this job already wrote is delivered as it is.
  const existing =
    head.currentVersion > 0 && priorPlanId === null
      ? await dependencies.store.read(owner, head.planId)
      : null;
  let plan: QPlan;
  if (existing !== null) {
    plan = existing.plan;
  } else {
    const version = head.currentVersion + 1;
    plan = QPlanSchema.parse({
      planId: QPlanIdSchema.parse(head.planId),
      version,
      side,
      goal: grounded.goal,
      situationSummary: grounded.situationSummary,
      situationRefs: grounded.situationRefs,
      steps: grounded.steps,
      openQuestions: grounded.openQuestions,
      review,
      status: "OFFERED",
      supersedes: version === 1 ? null : version - 1,
      createdAt: now().toISOString(),
      ...(grounded.specialists.length === 0
        ? {}
        : { specialists: grounded.specialists }),
    });
    await dependencies.store.addVersion(owner, {
      planId: head.planId,
      plan,
      bodySha256: planBodySha256(plan),
      situation: dossier,
      threshold: Q_PLAN_REVIEW_THRESHOLD,
      rubricVersion: Q_PLAN_RUBRIC_VERSION,
      promptVersion: PLAN_PROMPT_VERSION,
      scoreR1: reviews.find((one) => one.reviewer === "R1")?.score ?? null,
      scoreR2: reviews.find((one) => one.reviewer === "R2")?.score ?? null,
      fullyReviewed,
      redrafts,
      cause: version === 1 ? "DRAFT" : "CHANGE",
      directionId: version === 1 ? null : payload.directionId,
      status: "OFFERED",
    });
  }
  await say(
    plan.planId,
    "STATUS",
    "PLANNER",
    null,
    plan.review?.fullyReviewed === true
      ? "The plan is ready"
      : "The plan is ready as a draft",
    `ready:${String(plan.version)}`,
  );
  dependencies.logger?.info(
    {
      jobId: input.jobId,
      planId: plan.planId,
      version: plan.version,
      steps: plan.steps.length,
      modelCalls,
      redrafts,
      fullyReviewed,
      scores: reviews.map((one) => one.score),
      droppedCites: grounded.droppedCites,
      droppedSteps: grounded.droppedSteps,
      // Per round: both scores, integrity, and how many points were open.
      rounds,
      timings,
    },
    "plan written and reviewed",
  );
  return {
    status: "OFFERED",
    planId: plan.planId,
    version: plan.version,
    block: planBlockOf(plan),
    line: planReadyLine(plan, clarification),
    modelCalls,
  };
}

async function eligibleToolsOf(
  tools: Pick<QToolPort, "offer"> | undefined,
  context: QToolExecutionContext,
): Promise<ReadonlySet<string> | undefined> {
  if (tools === undefined) return undefined;
  const offered = await tools.offer(context).catch(() => null);
  if (offered === null) return new Set();
  // The tool as the model names it (research_public_web): what a
  // specialist's definition lists, checked against what this context offers.
  return new Set(offered.map((tool) => tool.definition.name));
}

async function directionText(
  store: PlanStore,
  owner: Owner,
  planId: string,
  directionId: string,
): Promise<string | null> {
  const entries = await store
    .readThread(owner, { planId }, { kinds: ["DIRECTION"] })
    .catch(() => []);
  return entries.find((entry) => entry.id === directionId)?.text ?? null;
}

/** A stored plan back in the writer's shape (for a redraft or a change). */
function writtenOf(plan: QPlan): PlanWriteResult {
  return {
    goal: plan.goal.slice(0, 300),
    side: plan.side,
    situationSummary: plan.situationSummary,
    situationRefs: plan.situationRefs.slice(0, 24),
    steps: plan.steps.map((step) => ({
      key: step.key.slice(0, 24).replace(/[^A-Za-z0-9_-]/gu, "_"),
      title: step.title,
      why: step.why,
      cites: [...step.cites],
      owner: step.owner,
      action:
        step.action.kind === "WORKFORCE"
          ? {
              kind: "WORKFORCE",
              roles: step.action.roles.filter(
                (
                  role,
                ): role is
                  | "OUTREACH"
                  | "MANDATE_WATCHER"
                  | "CONVERSATION"
                  | "SCHEDULER"
                  | "DOCUMENTS"
                  | "RESEARCH"
                  | "AD_HOC" =>
                  role !== "LEAD" && role !== "WRITER" && role !== "REVIEWER",
              ),
            }
          : step.action,
      due: step.due,
      evidenceNeeded: [...step.evidenceNeeded],
    })),
    openQuestions: [...plan.openQuestions],
    clarification: null,
  };
}

function writtenOfGrounded(plan: GroundedPlan): unknown {
  return {
    goal: plan.goal,
    situationSummary: plan.situationSummary,
    situationRefs: plan.situationRefs,
    steps: plan.steps.map((step) => ({
      key: step.key,
      title: step.title,
      why: step.why,
      cites: step.cites,
      owner: step.owner,
      action: step.action,
      // The reviewers' owner rule reads it (PLAN_REVIEW v3).
      needsApproval: step.needsApproval,
      due: step.due,
      evidenceNeeded: step.evidenceNeeded,
    })),
    openQuestions: plan.openQuestions,
  };
}

/** A version's keys as the writer saw them, mapped back to the stored ones. */
function keysOf(plan: QPlan): ReadonlyMap<string, string> {
  return new Map(
    plan.steps.map((step) => [
      step.key.slice(0, 24).replace(/[^A-Za-z0-9_-]/gu, "_"),
      step.key,
    ]),
  );
}

function keysOfGrounded(plan: GroundedPlan): ReadonlyMap<string, string> {
  return new Map(plan.steps.map((step) => [step.key, step.key]));
}

/**
 * A reviewer's point ("[s2] problem Fix: change") as the person reads it:
 * the step by its number and what is still wanted, without fact codes.
 */
export function personPoint(
  point: string,
  steps: readonly Pick<QPlanStep, "key">[],
  /**
   * The situation's facts by ref. Q-page sweep 2026-10-29: with the refs
   * only taken out, "Add F62 to s6's cites" reached the person as "Add to
   * s6's cites". Each ref is said as the start of its fact instead.
   */
  facts?: ReadonlyMap<string, string>,
): string {
  const match = /^\[([^\]]+)\]\s*(.*)$/su.exec(point.trim());
  const key = match?.[1] ?? null;
  const body = match?.[2] ?? point.trim();
  const [problem = "", fix] = body.split(/\s*Fix:\s*/u);
  const wanted = withoutRefs(
    plainReviewWords(namedFacts((fix ?? problem).trim(), facts), steps),
  ).replace(/^./u, (letter) => letter.toUpperCase());
  const index = key === null ? -1 : steps.findIndex((one) => one.key === key);
  return sentenceClip(
    index === -1 ? wanted : `Step ${String(index + 1)}: ${wanted}`,
    300,
  );
}

/** A fact ref as the first words of its fact, quoted; one the situation lacks is "the record". */
function namedFacts(
  text: string,
  facts: ReadonlyMap<string, string> | undefined,
): string {
  if (facts === undefined) return text;
  return text.replace(/\b[FP][1-9]\d{0,3}\b/gu, (ref) => {
    const statement = facts.get(ref);
    if (statement === undefined) return "the record";
    const words = statement
      .replace(/^You told Q:\s*/u, "")
      .replace(/\s+/gu, " ")
      .trim()
      .split(" ");
    const start = words
      .slice(0, 8)
      .join(" ")
      .replace(/[\s.,;:]+$/u, "");
    return `\u201C${start}${words.length > 8 ? "\u2026" : ""}\u201D`;
  });
}

/**
 * A reviewer's bookkeeping words as the person reads them: a step's key is
 * "step N", and the plan's "cites" are the records a step rests on.
 */
function plainReviewWords(
  text: string,
  steps: readonly Pick<QPlanStep, "key">[],
): string {
  let out = text;
  steps.forEach((step, index) => {
    const escaped = step.key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    out = out.replace(
      new RegExp(`\\b${escaped}\\b`, "gu"),
      `step ${String(index + 1)}`,
    );
  });
  return out
    .replace(/\bcites\b/gu, "sources")
    .replace(/\bCites\b/gu, "Sources")
    .replace(/\bcite\b/gu, "point to")
    .replace(/\bCite\b/gu, "Point to");
}

/** The plan card: a reference the client reads under the person's authority. */
export function planBlockOf(plan: QPlan): QPlanBlock {
  return {
    kind: "PLAN",
    planId: plan.planId,
    version: plan.version,
    title: plan.goal.slice(0, 160),
    steps: plan.steps.length,
    reviewed: plan.review?.fullyReviewed === true,
    affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
  };
}

/**
 * What Q says when the plan lands (code's words, plain, either side): how
 * many steps, the first, whether it is fully reviewed, the one question
 * when there is one -- with the default already followed -- and the three
 * ways on.
 */
export function planReadyLine(
  plan: QPlan,
  clarification: PlanWriteResult["clarification"],
): string {
  const yours = plan.steps.filter((step) => step.owner === "YOU").length;
  const mine = plan.steps.length - yours;
  const first = plan.steps[0];
  const lines = [
    `Your plan is ready: ${String(plan.steps.length)} step${plan.steps.length === 1 ? "" : "s"}, each from where things stand for you (${String(mine)} I can do or prepare, ${String(yours)} for you).`,
  ];
  if (first !== undefined) lines.push(`First: ${first.title}`);
  if (plan.review?.fullyReviewed !== true) {
    const open = plan.review?.openPoints ?? [];
    lines.push(
      open.length === 0
        ? "It's a draft: the two reviews didn't pass it yet."
        : `It's a draft: the two reviews didn't pass it yet. What they still want: ${open
            .slice(0, 2)
            .map((point) => point.replace(/[.\s]+$/u, ""))
            .join(
              "; ",
            )}${open.length > 2 ? `; and ${String(open.length - 2)} more on the card` : ""}.`,
    );
  }
  if (clarification !== null) {
    lines.push(
      `I went with ${clarification.default.replace(/[.\s]+$/u, "")}. ${clarification.question}`,
    );
  }
  lines.push("Execute it, put it on your board, or tell me what to change.");
  return lines.join("\n\n");
}

/**
 * Planning failed: what Q holds, said plainly from the situation (code's
 * words around the facts' own statements), so the person still gets
 * something useful without asking again.
 */
export function fromWhatQHolds(dossier: QSituationDossier): string {
  const facts = dossier.sections
    .filter(
      (section) =>
        section.status === "READ" &&
        section.source !== "MEMORY" &&
        section.source !== "Q_DAILY",
    )
    .flatMap((section) => section.facts.slice(0, 2))
    .slice(0, 6);
  if (facts.length === 0) {
    return "I couldn't finish the plan just now, and I couldn't read enough of where things stand to answer from it. Ask me again in a moment and I'll start it afresh.";
  }
  return [
    "I couldn't finish the full plan just now, so here is where things stand from what I hold:",
    facts.map((fact) => `- ${fact.statement}`).join("\n"),
    "Ask me again and I'll draft the plan from here.",
  ].join("\n\n");
}

/** The reply that starts the work, at once (code's words; never "nothing has started"). */
export function planStartLine(
  deliverable: PlanJobPayload["deliverable"],
  research: PlanJobPayload["research"],
): string {
  const what =
    deliverable === "DOCUMENT_REVIEW"
      ? "I'm going through your documents now: the facts they state, where they contradict each other, and what needs your confirmation before your record changes. I'll set it out as steps for you."
      : "I'm on it: gathering where things stand for you now, then drafting a plan and having it reviewed twice before you see it.";
  const reading =
    research === "NONE" ? "" : " I'll check public sources alongside.";
  return `${what}${reading} It usually takes a minute or two; you can follow it here.`;
}

/** The deck as Q read it, as dossier facts (own company, read as them). */
export const DeckReadSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            section: z.string(),
            status: z.enum([
              "PRESENT",
              "NOT_IN_DECK",
              "UNCLEAR",
              "CONTRADICTORY",
            ]),
            summary: z.string().nullable(),
          })
          .passthrough(),
      )
      .max(12),
  })
  .passthrough();

const sectionWords = (code: string) => code.toLowerCase().replace(/_/gu, " ");

type RawFact = Omit<
  QSituationDossier["sections"][number]["facts"][number],
  "ref"
>;

export function deckFacts(data: unknown): readonly RawFact[] {
  const parsed = DeckReadSchema.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.sections.flatMap((section): RawFact[] => {
    const name = sectionWords(section.section);
    const provenance = { tool: "read_company_deck", record: null, url: null };
    if (section.status === "PRESENT" && section.summary !== null) {
      return [
        {
          statement: `Your deck's ${name}: ${section.summary.trim().slice(0, 900)}`,
          truthClass: "USER_CLAIM" as const,
          evidenceStatus: "DOCUMENT_SUPPORTED" as const,
          asOf: null,
          provenance,
          label: "organisation_private" as const,
          category: null,
        },
      ];
    }
    if (
      section.status === "NOT_IN_DECK" ||
      section.status === "CONTRADICTORY"
    ) {
      return [
        {
          statement:
            section.status === "NOT_IN_DECK"
              ? `Q's reading of your deck found no ${name} section.`
              : `Q's reading of your deck found its ${name} contradicts itself${section.summary === null ? "" : `: ${section.summary.trim().slice(0, 700)}`}.`,
          truthClass: "Q_INFERENCE" as const,
          evidenceStatus: "DOCUMENT_SUPPORTED" as const,
          asOf: null,
          provenance,
          label: "organisation_private" as const,
          category: null,
        },
      ];
    }
    return [];
  });
}

/** READING_DOCUMENTS through the chat's own typed tool, as the asker. */
export function createDeckRead(
  tools: Pick<QToolPort, "execute">,
): PlanDocumentRead {
  return async (context, subject) => {
    if (subject.side !== "FOUNDER") return [];
    const outcome = await tools.execute(
      {
        callId: "plan-deck",
        name: "read_company_deck",
        arguments: { companyId: subject.companyId },
      },
      context,
    );
    if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) return [];
    return deckFacts(outcome.result.data);
  };
}
