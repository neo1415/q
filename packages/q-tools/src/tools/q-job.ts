import { z } from "zod";

import {
  Q_TASK_CLASSES,
  type PermittedContextPlan,
  type QSubjectRef,
  type RelationshipBrief,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { OwnRelationships, QToolPorts } from "../ports.js";
import { matchCounterpart, nameableRecords } from "./client-actions.js";

/** The ports a goal's names are resolved through (the open_page rule). */
export type QJobNamePorts = Pick<
  QToolPorts,
  "companies" | "relationships" | "disclosure" | "discovery" | "investorFeed"
>;

/** Words that start a request, never a name. */
const NOT_NAMES: ReadonlySet<string> = new Set([
  "i",
  "the",
  "and",
  "can",
  "could",
  "please",
  "follow",
  "send",
  "draft",
  "book",
  "set",
  "introduce",
  "reply",
  "write",
  "ask",
  "find",
  "get",
  "make",
  "email",
  "message",
  "schedule",
  "then",
  "also",
  "q",
]);
const SPANS_MAX = 3;

/** The name-like spans of a goal: runs of capitalised words, request words dropped. */
export function nameSpans(goal: string): readonly string[] {
  const spans: string[] = [];
  for (const match of goal.matchAll(
    /\p{Lu}[\p{L}\p{N}'’&.-]*(?:\s+\p{Lu}[\p{L}\p{N}'’&.-]*)*/gu,
  )) {
    const words = match[0]
      .split(/\s+/u)
      .map((word) => word.replace(/['’]s$/u, "").replace(/[.]+$/u, ""));
    while (words.length > 0 && NOT_NAMES.has((words[0] ?? "").toLowerCase())) {
      words.shift();
    }
    const span = words.join(" ").trim();
    if (span.length >= 3 && !spans.includes(span)) spans.push(span);
    if (spans.length >= SPANS_MAX) break;
  }
  return spans;
}

/**
 * W4b: the records a goal names, by the person's own reach -- their
 * relationships, their feed, what the network shows them -- matched the
 * way open_page matches a spoken name. A name nobody they can see carries
 * resolves to nothing; nothing private to anyone else is a candidate.
 */
export async function goalSubjects(
  ports: QJobNamePorts,
  actor: ActorContext,
  goal: string,
): Promise<readonly QSubjectRef[]> {
  const spans = nameSpans(goal);
  if (spans.length === 0) return [];
  const subjects: QSubjectRef[] = [];
  const seen = new Set<string>();
  const add = (subject: QSubjectRef, id: string) => {
    const key = `${subject.kind}:${id.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    subjects.push(subject);
  };
  const investors = await nameableRecords(
    ports,
    actor,
    "INVESTOR_ORGANISATION",
    null,
  ).catch(() => []);
  for (const span of spans) {
    const companies = await nameableRecords(
      ports,
      actor,
      "COMPANY",
      span,
    ).catch(() => []);
    const companyId = matchCounterpart(span, companies);
    if (companyId !== null) add({ kind: "COMPANY", companyId }, companyId);
    const investorId = matchCounterpart(span, investors);
    if (investorId !== null) {
      add(
        { kind: "INVESTOR_ORGANISATION", investorOrganisationId: investorId },
        investorId,
      );
    }
  }
  // Their own relationship with what was named is the same people too.
  const own = await ports.relationships
    ?.ownRelationships?.(actor)
    .catch(() => null);
  for (const item of own?.items ?? []) {
    const counterpart = `${item.counterpart.kind}:${item.counterpart.id.toLowerCase()}`;
    if (seen.has(counterpart)) {
      add(
        { kind: "RELATIONSHIP", relationshipId: item.relationshipId },
        item.relationshipId,
      );
    }
  }
  return subjects;
}

/**
 * A job for Q's team (founder brief J1, J4): the person asks for something
 * that takes several steps ("introduce me to Kestrel and book a call"),
 * and the lead Q plans it into steps, each owned by a specialist -- or by a
 * helper it spawns with only the tools that step needs.
 *
 * Prepare -> Recommend -> Approve: this tool plans and prepares the card;
 * the plan is the card's exact payload. Nothing runs until the person
 * approves that plan; once approved it runs as planned, under the plan's
 * tools and budget, and every message to the other side still passes the
 * reviewer first. A different plan is a new card.
 */

export const PROPOSE_Q_JOB = "q.workforce.job.propose" as const;

export type QJobPlanView = {
  readonly summary: string;
  /** Each step in plain words: who does it, and what. */
  readonly steps: readonly { readonly who: string; readonly does: string }[];
  readonly cannot: readonly string[];
  readonly budgetUsd: string;
  /**
   * Q room R5: what will need the person, in plain words (their approval,
   * a calendar to connect), decided by code from the plan, never a model.
   */
  readonly needsYou: readonly string[];
  /** wf: the outcome the plan works towards. Absent on an older plan. */
  readonly outcome?: string | undefined;
  /** What is missing or not known, and whether it blocks the outcome. */
  readonly missing?: readonly string[] | undefined;
  /** What should come next, each with why and whether it needs approval. */
  readonly next?: readonly string[] | undefined;
};

/**
 * wf 2026-10-16: what Q read about the records a goal names before the lead
 * plans, each read as the person through the Network context's own
 * authorised brief. UNAVAILABLE is "not known", never "none".
 */
export type QJobSituationReads = {
  readonly briefs: readonly RelationshipBrief[];
  /** Named relationships whose brief could not be read (their names, or null). */
  readonly unreadable: readonly (string | null)[];
  /** Their own relationships, read only when the goal names none; null: unreadable. */
  readonly overview?: OwnRelationships | null | undefined;
};

/** Briefs read per job: the goal's named relationships, at most this many. */
export const JOB_BRIEFS_MAX = 3;

/** What Q reads before the lead plans (authorised reads only, bounded). */
export async function situationReads(
  ports: QJobNamePorts,
  actor: ActorContext,
  subjects: readonly QSubjectRef[],
): Promise<QJobSituationReads> {
  const relationships = subjects
    .flatMap((subject) =>
      subject.kind === "RELATIONSHIP" ? [subject.relationshipId] : [],
    )
    .slice(0, JOB_BRIEFS_MAX);
  const brief = ports.relationships?.brief;
  if (relationships.length === 0 || brief === undefined) {
    const own = ports.relationships?.ownRelationships;
    return {
      briefs: [],
      unreadable: [],
      overview:
        own === undefined ? undefined : await own(actor).catch(() => null),
    };
  }
  const read = await Promise.all(
    relationships.map((id) => brief(actor, id).catch(() => undefined)),
  );
  return {
    briefs: read.filter((one): one is RelationshipBrief => one != null),
    // A brief that failed is unknown; null (not a party) is simply absent.
    unreadable: read.flatMap((one) => (one === undefined ? [null] : [])),
  };
}

export type QJobPort = {
  /**
   * The lead Q's plan for the goal, prepared as this run's card. NOT_PLANNED:
   * nothing could be planned within what Q's team can do.
   */
  readonly prepare: (
    actor: ActorContext,
    runId: string,
    goal: string,
    options?: {
      /** They already heard what is waiting and said go ahead (R5). */
      readonly proceed: boolean;
      /**
       * W4b: the records the goal names, resolved by the person's own
       * reach (goalSubjects); empty when it names nobody they can see.
       */
      readonly subjects?: readonly QSubjectRef[] | undefined;
      /** wf: what was read about them, as the person, before planning. */
      readonly reads?: QJobSituationReads | undefined;
    },
  ) => Promise<
    | {
        readonly status: "PREPARED" | "ONE_PER_TURN";
        readonly plan: QJobPlanView;
      }
    | {
        /**
         * Q room R5: like a colleague, Q checks what already exists first.
         * Work of theirs on the same people is already waiting for them;
         * nothing was planned. Each line is a waiting item's own summary.
         */
        readonly status: "ALREADY_WAITING";
        readonly waiting: readonly string[];
        /**
         * W4b: SAME_PEOPLE -- waiting work is about who the goal names;
         * SAME_KIND -- the goal names nobody, and jobs of this kind wait.
         */
        readonly about: "SAME_PEOPLE" | "SAME_KIND";
      }
    /**
     * Owner 2026-10-23: the person's own deep work (research and a document
     * for themselves) started at once, with no card: it is not an outward
     * or consequential action. firstRead: Q's initial view, said meanwhile.
     */
    | {
        readonly status: "STARTED";
        readonly plan: QJobPlanView;
        readonly firstRead: string | null;
      }
    | { readonly status: "NOT_PLANNED" }
    | { readonly status: "LIMIT_REACHED" }
    /**
     * Planning broke on Q's side (a model provider refused, a store was
     * unreachable): never NOT_PLANNED, which would blame their wording.
     */
    | { readonly status: "FAILED" }
  >;
};

const ProposeQJobInputSchema = z
  .object({
    goal: z
      .string()
      .trim()
      .min(3)
      .max(1_000)
      .describe(
        "The job in the person's own words, with the names and details they gave.",
      ),
    proceed: z
      .boolean()
      .default(false)
      .describe(
        "True only after you told them what was already waiting (ALREADY_WAITING) and they said to go ahead anyway.",
      ),
  })
  .strict();
type ProposeQJobInput = z.output<typeof ProposeQJobInputSchema>;

const ProposeQJobOutputSchema = z
  .object({
    status: z.enum([
      "PREPARED",
      "STARTED",
      "ONE_PER_TURN",
      "NOT_PLANNED",
      "LIMIT_REACHED",
      "ALREADY_WAITING",
      "FAILED",
    ]),
    /** STARTED: Q's first read of the question, from what it knows. */
    firstRead: z.string().max(700).nullable().optional(),
    plan: z
      .object({
        summary: z.string(),
        steps: z.array(z.object({ who: z.string(), does: z.string() })),
        cannot: z.array(z.string()),
        budgetUsd: z.string(),
        needsYou: z.array(z.string()),
        outcome: z.string().optional(),
        missing: z.array(z.string()).max(8).optional(),
        next: z.array(z.string()).max(6).optional(),
      })
      .nullable(),
    /** ALREADY_WAITING: what is waiting for them already, in its own words. */
    waiting: z.array(z.string()).max(5).optional(),
    /** ALREADY_WAITING: about the same people, or the same kind of job. */
    about: z.enum(["SAME_PEOPLE", "SAME_KIND"]).optional(),
  })
  .strict();
type ProposeQJobOutput = z.infer<typeof ProposeQJobOutputSchema>;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export function createQJobTools(
  port: QJobPort,
  names?: QJobNamePorts,
): readonly AnyQToolDefinition[] {
  return [
    defineQTool<ProposeQJobInput, ProposeQJobOutput, null>({
      id: PROPOSE_Q_JOB,
      // v2 (W4b): waiting work matched by the records the goal names, or
      // by the same kind of job when it names nobody (`about`).
      // v3 (wf): the lead reads the named relationships' briefs first, and
      // the plan says its outcome, what is missing and what comes next.
      version: 3,
      status: "ACTIVE",
      requiredCapabilities: [],
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION"],
      idempotency: "SAFE_TO_REPEAT",
      owner: "q-tools",
      providerName: "propose_q_job",
      description:
        "A one-off job of several steps for Q's team ('introduce me to Kestrel Heat and book a call', 'reply to everyone who wrote and set up calls'): the lead Q plans it into steps, each by a specialist or a helper with only its step's tools, as ONE card. Nothing happens until they approve that exact plan; the reviewer checks every message. Work only for themselves (research and a document they asked for, nothing sent to anyone) starts at once with no card: STARTED, say it is under way and when it will be ready, and give firstRead as your first view. Call it with their words; say the plan back in a sentence (its outcome), what is missing or not known (missing), then what will need them (needsYou); next is what should come after, for when they ask. ALREADY_WAITING: something already waits for them. SAME_PEOPLE: say what, like a colleague ('two drafts are waiting for Priya and Jonas'); SAME_KIND (they named nobody): say which jobs of this kind wait. Then ask whether to go ahead; call again with proceed true only if they say yes. For a goal that should keep running over time use propose_standing_instruction instead.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      approval: "NONE",
      visibleStage: "WAITING_FOR_APPROVAL",
      input: ProposeQJobInputSchema,
      output: ProposeQJobOutputSchema,
      authorize: (_input, { actor, plan }) =>
        Promise.resolve(
          ownConversation(actor, plan)
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        ),
      execute: async (input, context) => {
        // Resolved here, as the person, so the check matches records,
        // not only words. A go-ahead skips the waiting check, not the
        // look-up: the plan binds the company the goal names from it.
        const subjects =
          names === undefined
            ? []
            : await goalSubjects(names, context.actor, input.goal).catch(
                () => [],
              );
        // What Q knows about them, read as the person before any model
        // sees it (Context Firewall); a failed read is unknown, never none.
        const reads =
          names === undefined
            ? undefined
            : await situationReads(names, context.actor, subjects).catch(
                () => undefined,
              );
        const prepared = await port.prepare(
          context.actor,
          context.runId,
          input.goal,
          {
            proceed: input.proceed,
            subjects,
            ...(reads === undefined ? {} : { reads }),
          },
        );
        if (prepared.status === "ALREADY_WAITING") {
          return {
            status: prepared.status,
            plan: null,
            waiting: prepared.waiting.slice(0, 5),
            about: prepared.about,
          };
        }
        return {
          status: prepared.status,
          ...(prepared.status === "STARTED"
            ? { firstRead: prepared.firstRead }
            : {}),
          plan:
            prepared.status === "PREPARED" ||
            prepared.status === "ONE_PER_TURN" ||
            prepared.status === "STARTED"
              ? {
                  summary: prepared.plan.summary,
                  steps: prepared.plan.steps.map((step) => ({
                    who: step.who,
                    does: step.does,
                  })),
                  cannot: [...prepared.plan.cannot],
                  budgetUsd: prepared.plan.budgetUsd,
                  needsYou: [...prepared.plan.needsYou],
                  ...(prepared.plan.outcome === undefined
                    ? {}
                    : { outcome: prepared.plan.outcome }),
                  ...(prepared.plan.missing === undefined
                    ? {}
                    : { missing: [...prepared.plan.missing].slice(0, 8) }),
                  ...(prepared.plan.next === undefined
                    ? {}
                    : { next: [...prepared.plan.next].slice(0, 6) }),
                }
              : null,
        };
      },
    }),
  ];
}
