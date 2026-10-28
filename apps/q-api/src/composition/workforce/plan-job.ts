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
          return `APP_ACTION ${entry.name}: ${entry.does.slice(0, 160)}`;
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
      return {
        owner: byQ,
        action: {
          kind: "WORKFORCE",
          roles: [...new Set(entries.map((entry) => entry.name))],
        },
        needsApproval: entries.some((entry) => entry.outward),
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

/** The person's words: no internal names reach them (addendum 3 rule 4). */
function plainWords(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  // The writer is told never to use these; a slip is softened, not passed.
  const softened = clean.replace(ROLE_WORDS_ROLE_FREE, (word) =>
    /^job$/iu.test(word)
      ? "work"
      : /^dossier$/iu.test(word)
        ? "situation"
        : "Q",
  );
  return softened.length <= max
    ? softened
    : `${softened.slice(0, max - 1).trimEnd()}…`;
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
      why: plainWords(step.why, 300),
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
  for (const section of dossier.sections) {
    if (section.status !== "READ" || section.facts.length === 0) continue;
    if (section.source === "MEMORY" || section.source === "Q_DAILY") continue;
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
    items
      .flatMap((item) => result[item].defects.map((defect) => defect.problem))
      .join(" ")
      .slice(0, 300);
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

/** A reviewer's defects as numbered-able fixes, most important item first. */
export function reviewFixes(result: PlanReviewResult): readonly string[] {
  const order: readonly (keyof typeof PLAN_RUBRIC_V1)[] = [
    "noInventedFacts",
    "citesFacts",
    "asksNothingKnown",
    "specificity",
    "situationCoverage",
    "ownerClassification",
    "feasibility",
    "roleCorrectWording",
  ];
  const fixes = [
    ...result.firewall.defects,
    ...order.flatMap((item) => result[item].defects),
  ].map((defect) =>
    `${defect.stepKey === null ? "" : `[${defect.stepKey}] `}${defect.problem} Fix: ${defect.fix}`.slice(
      0,
      300,
    ),
  );
  return [...new Set(fixes)];
}

// --- the job -----------------------------------------------------------------------

export const PLAN_PROMPT_VERSION = "PLAN_WRITE@1+PLAN_REVIEW@1";
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
  const [deckFacts, withPublic] = await Promise.all([documents, researched]);
  dossier = withFacts(withPublic, "DECK", deckFacts);
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

  const base: Omit<PlanWriteInput, "mode" | "priorPlan" | "fixes"> = {
    side,
    today: todayOf(now()),
    ask: payload.ask,
    situation,
    publicFindings,
    allowedActions,
  };
  modelCalls += 1;
  const first = await writePlan(who, trace, {
    ...base,
    mode: prior === null ? "NEW" : "REDRAFT",
    priorPlan:
      prior === null
        ? ""
        : JSON.stringify(writtenOf(prior.plan)).slice(0, 16_000),
    fixes:
      direction === null
        ? ""
        : `1. The person asked for this change: ${direction}`.slice(0, 6_000),
  });
  if (first === null || first.steps.length === 0) {
    return {
      status: "ANSWERED",
      line: fromWhatQHolds(dossier),
      modelCalls,
    };
  }
  const clarification = first.clarification;
  let grounded = groundPlan({
    written: first,
    dossier,
    roster,
    ...(prior === null ? {} : { priorKeys: keysOf(prior.plan) }),
    eligibleTools,
  });
  if (grounded.steps.length === 0) {
    return { status: "ANSWERED", line: fromWhatQHolds(dossier), modelCalls };
  }

  // --- REVIEWING_PLAN: two in parallel, one redraft at most ------------------
  let reviews: QPlanReview[];
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
    reviews = results.flatMap((result, index) =>
      result === null
        ? []
        : [
            reviewOf(
              result,
              index === 0 ? "R1" : "R2",
              round,
              PLAN_PROMPT_VERSION,
            ),
          ],
    );
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
    // A redraft with the numbered defects (the reviewers' and code's).
    const fixes = [...reviews.flatMap((review) => review.fixes), ...code];
    if (fixes.length === 0) break;
    redrafts += 1;
    progress({
      stage: "PLANNING",
      draft: round + 1,
      drafts: PLAN_JOB_REDRAFTS + 1,
      openPoints: fixes.length,
    });
    modelCalls += 1;
    const again = await writePlan(who, trace, {
      ...base,
      mode: "REDRAFT",
      priorPlan: planJson,
      fixes: [...new Set(fixes)]
        .slice(0, 20)
        .map((fix, index) => `${String(index + 1)}. ${fix}`)
        .join("\n")
        .slice(0, 6_000),
    });
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
    ...reviews.flatMap((review) => (review.passed ? [] : review.fixes)),
    ...remainingCode,
  ];
  const points = [...new Set(openPoints)]
    .map((point) => point.slice(0, 300))
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
  return new Set(
    offered.flatMap((tool) => {
      const name = (tool as { readonly name?: unknown }).name;
      return typeof name === "string" ? [name] : [];
    }),
  );
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
    const open = plan.review?.openPoints[0];
    lines.push(
      `It's a draft I haven't been able to fully review yet${open === undefined ? "." : ` — still open: ${open.replace(/\s*Fix:.*$/u, "")}`}`,
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
