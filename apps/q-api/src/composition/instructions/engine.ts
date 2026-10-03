import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  delegableOnItsOwn,
  type AnyAppAction,
  type AppActionPorts,
} from "@capital-q/app-actions";
import {
  CorrelationIdSchema,
  InstructionGrantSchema,
  Q_INSTRUCTION_GRANT,
  type InstructionGrant,
  type InstructionWorkingHours,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type {
  InstructionPlanResult,
  InstructionThreadFacts,
} from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import { PLAN_MAX_COST_USD, type InstructionPlanner } from "./planner.js";
import { needsYouNotice } from "./digest.js";
import { factsLine, type QuarantinedThreadReader } from "./quarantine.js";
import type { InstructionRow, InstructionStore } from "./store.js";

/**
 * The standing-instruction engine (ADR 0043 §4): Q plans; code decides.
 *
 * One firing: a large model writes a typed plan naming declared actions
 * (ADR 0040). Code validates every step against the APPROVED grant version
 * -- unknown, not granted, out of scope, not delegable, over the message
 * cap, off topic, outside working hours, or touching terms or money is
 * refused or turned into a card. A plan with refusals is re-planned at most
 * twice with the reasons. AUTO steps run the declaration's own authorize and
 * run as the person, with a step idempotency key; ASK steps become the same
 * `app.<name>` card the person's own request would. Every step is recorded,
 * and what Q cannot do is said at once with something it can do instead.
 */

export const MAX_REPLANS = 2;
/** S8: at most this many people are acted for in one firing. */
export const FANOUT_MAX = 5;
/** S6: at most this many threads read per firing. */
export const THREADS_PER_FIRING = 8;

export type InstructionPerson = {
  /** Null for a candidate with no relationship yet (a saved company). */
  readonly relationshipId: string | null;
  readonly counterpartKind: "COMPANY" | "INVESTOR_ORGANISATION";
  readonly counterpartId: string;
  readonly name: string;
  readonly state: string | null;
};

export type InstructionPlanStep = InstructionPlanResult["steps"][number];

export type StepVerdict =
  | {
      readonly verdict: "AUTO" | "ASK";
      readonly action: AnyAppAction;
      readonly input: unknown;
      readonly relationshipId: string | null;
      /** Why an AUTO-granted step is asked instead; null when as granted. */
      readonly code: string | null;
    }
  | {
      readonly verdict: "REFUSED";
      readonly code: RefusalCode;
      readonly relationshipId: string | null;
    };

export const REFUSAL_CODES = [
  "UNKNOWN_ACTION",
  "NOT_IN_GRANT",
  "BAD_ARGUMENTS",
  "OUT_OF_SCOPE",
  "OUTSIDE_HOURS",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** Plain words for a refusal, each with what Q can do instead. */
export const REFUSAL_WORDS: Readonly<
  Record<RefusalCode, { reason: string; instead: string }>
> = {
  UNKNOWN_ACTION: {
    reason: "that isn't something Capital Q can do",
    instead: "I can tell you what I found so you can do it yourself",
  },
  NOT_IN_GRANT: {
    reason: "you didn't allow that under this instruction",
    instead: "say so and I'll prepare a change to it for your approval",
  },
  BAD_ARGUMENTS: {
    reason: "I couldn't put that step together correctly",
    instead: "I'll try again next time, or you can ask me directly",
  },
  OUT_OF_SCOPE: {
    reason: "that person isn't among the people this instruction covers",
    instead: "name them and I'll prepare a change to cover them",
  },
  OUTSIDE_HOURS: {
    reason: "it's outside the working hours you set",
    instead: "I'll pick it up in your working hours",
  },
};

/** Why a granted AUTO step is asked instead, in plain words. */
export const ASK_WORDS: Readonly<Record<string, string>> = {
  NOT_DELEGABLE: "it needs your yes",
  TERMS_OR_MONEY: "it touches terms or money",
  OFF_TOPIC: "it goes beyond the topics you approved",
  OVER_MESSAGE_CAP: "I've sent them as many messages as you allowed",
  ATTACHMENT: "it shares a document",
  MEETING_OUTSIDE_HOURS: "the time is outside your working hours",
  AUTONOMY_OFF: "I ask for each step until autonomy is switched on",
  THEY_RAISED_TERMS: "they raised terms or money",
  THEY_DECLINED: "they said no or not now",
};

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

const WEEKDAY: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function local(
  at: Date,
  timeZone: string,
): { readonly day: number; readonly hm: string; readonly date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    day: WEEKDAY[part("weekday")] ?? 0,
    hm: `${part("hour")}:${part("minute")}`,
    date: `${part("year")}-${part("month")}-${part("day")}`,
  };
}

/** Whether an instant falls inside the person's working hours. */
export function withinWorkingHours(
  at: Date,
  hours: InstructionWorkingHours,
): boolean {
  try {
    const here = local(at, hours.timeZone);
    return (
      hours.days.includes(here.day) &&
      here.hm >= hours.start &&
      here.hm < hours.end
    );
  } catch {
    // An unknown zone: never "inside" -- AUTO waits, nothing runs blind.
    return false;
  }
}

/** A meeting wholly inside one working day's hours. */
export function meetingWithinWorkingHours(
  startsAt: Date,
  minutes: number,
  hours: InstructionWorkingHours,
): boolean {
  const ends = new Date(startsAt.getTime() + minutes * 60_000);
  if (!withinWorkingHours(startsAt, hours)) return false;
  try {
    const start = local(startsAt, hours.timeZone);
    const end = local(ends, hours.timeZone);
    return start.date === end.date && end.hm <= hours.end;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The validator: code decides
// ---------------------------------------------------------------------------

export type ValidationContext = {
  readonly grant: InstructionGrant;
  readonly actions: readonly AnyAppAction[];
  readonly people: readonly InstructionPerson[];
  /** Q's sent messages per relationship so far (updated as steps pass). */
  readonly sent: Map<string, number>;
  readonly now: Date;
  /** The idempotency key this step runs under. */
  readonly stepKey: string;
  /** S6: what the quarantined reader found in each thread. */
  readonly facts?: ReadonlyMap<string, InstructionThreadFacts> | undefined;
};

const Args = z.record(z.string(), z.unknown());

function withKey(
  action: AnyAppAction,
  args: Record<string, unknown>,
  stepKey: string,
): Record<string, unknown> {
  // The step's own key, never one the model wrote: a replay is the same
  // command, a new step a new one.
  const shape =
    action.input instanceof z.ZodObject
      ? (action.input.shape as Record<string, unknown>)
      : {};
  return "idempotencyKey" in shape
    ? { ...args, idempotencyKey: stepKey }
    : args;
}

/** The people this grant covers. */
export function inScope(
  grant: InstructionGrant,
  people: readonly InstructionPerson[],
): readonly InstructionPerson[] {
  // A company they are not in touch with only when the grant says so.
  if (grant.counterparts.scope === "ALL_MY_RELATIONSHIPS") {
    return grant.counterparts.includeNewCompanies
      ? people
      : people.filter((person) => person.relationshipId !== null);
  }
  const listed = new Set(grant.counterparts.relationshipIds);
  return people.filter(
    (person) =>
      person.relationshipId !== null && listed.has(person.relationshipId),
  );
}

export function validateStep(
  step: InstructionPlanStep,
  context: ValidationContext,
): StepVerdict {
  const action = context.actions.find(
    (candidate) =>
      candidate.name === step.action &&
      candidate.classification === "CONSEQUENTIAL",
  );
  if (action === undefined) {
    return { verdict: "REFUSED", code: "UNKNOWN_ACTION", relationshipId: null };
  }
  const granted = context.grant.actions.find(
    (entry) => entry.action === action.name,
  );
  if (granted === undefined) {
    return { verdict: "REFUSED", code: "NOT_IN_GRANT", relationshipId: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(step.argumentsJson);
  } catch {
    return { verdict: "REFUSED", code: "BAD_ARGUMENTS", relationshipId: null };
  }
  const args = Args.safeParse(raw);
  if (!args.success) {
    return { verdict: "REFUSED", code: "BAD_ARGUMENTS", relationshipId: null };
  }
  const parsed = action.input.safeParse(
    withKey(action, args.data, context.stepKey),
  );
  if (!parsed.success) {
    return { verdict: "REFUSED", code: "BAD_ARGUMENTS", relationshipId: null };
  }

  // Who it concerns: only people this grant covers.
  const relationshipId =
    typeof args.data["relationshipId"] === "string"
      ? args.data["relationshipId"]
      : null;
  const companyId =
    typeof args.data["companyId"] === "string" ? args.data["companyId"] : null;
  const covered = inScope(context.grant, context.people);
  if (
    relationshipId !== null &&
    !covered.some((person) => person.relationshipId === relationshipId)
  ) {
    return { verdict: "REFUSED", code: "OUT_OF_SCOPE", relationshipId };
  }
  if (
    companyId !== null &&
    !covered.some(
      (person) =>
        person.counterpartKind === "COMPANY" &&
        person.counterpartId === companyId,
    )
  ) {
    return { verdict: "REFUSED", code: "OUT_OF_SCOPE", relationshipId };
  }
  const subject =
    relationshipId ??
    covered.find(
      (person) =>
        person.counterpartKind === "COMPANY" &&
        person.counterpartId === companyId,
    )?.relationshipId ??
    null;

  const ask = (code: string): StepVerdict => ({
    verdict: "ASK",
    action,
    input: parsed.data,
    relationshipId: subject,
    code,
  });
  if (granted.mode === "ASK") {
    return {
      verdict: "ASK",
      action,
      input: parsed.data,
      relationshipId: subject,
      code: null,
    };
  }
  // AUTO as granted -- but what Q may do alone is fixed in code.
  if (!delegableOnItsOwn(action)) return ask("NOT_DELEGABLE");
  if (step.touchesTermsOrMoney) return ask("TERMS_OR_MONEY");
  // Code, not the planner, reads the thread's facts: where they raised
  // terms or money, or said no, Q does not act alone.
  const thread = subject === null ? undefined : context.facts?.get(subject);
  if (thread?.mentionsTermsOrMoney === true) return ask("THEY_RAISED_TERMS");
  if (thread?.declined === true) return ask("THEY_DECLINED");
  if (!withinWorkingHours(context.now, context.grant.workingHours)) {
    return {
      verdict: "REFUSED",
      code: "OUTSIDE_HOURS",
      relationshipId: subject,
    };
  }
  if (action.name === "chat.message.send") {
    const body = (parsed.data as { input?: { kind?: unknown } }).input;
    if (body?.kind !== "TEXT") return ask("ATTACHMENT");
    if (step.topic === null || !context.grant.topics.includes(step.topic)) {
      return ask("OFF_TOPIC");
    }
    const sent = subject === null ? 0 : (context.sent.get(subject) ?? 0);
    if (sent >= context.grant.maxMessagesPerCounterpart) {
      return ask("OVER_MESSAGE_CAP");
    }
    if (subject !== null) context.sent.set(subject, sent + 1);
  }
  if (action.name === "schedule.meeting.book") {
    const meeting = (
      parsed.data as {
        input?: { startsAt?: unknown; durationMinutes?: unknown };
      }
    ).input;
    const startsAt =
      typeof meeting?.startsAt === "string" ? new Date(meeting.startsAt) : null;
    const minutes =
      typeof meeting?.durationMinutes === "number"
        ? meeting.durationMinutes
        : 0;
    if (
      startsAt === null ||
      Number.isNaN(startsAt.getTime()) ||
      !meetingWithinWorkingHours(startsAt, minutes, context.grant.workingHours)
    ) {
      return ask("MEETING_OUTSIDE_HOURS");
    }
  }
  return {
    verdict: "AUTO",
    action,
    input: parsed.data,
    relationshipId: subject,
    code: null,
  };
}

// ---------------------------------------------------------------------------
// One firing
// ---------------------------------------------------------------------------

export type InstructionFiringResult = {
  readonly outcome:
    | "RAN"
    | "NOT_ACTIVE"
    | "EXPIRED"
    | "NO_ACTOR"
    | "OUTSIDE_HOURS"
    | "OVER_BUDGET"
    | "PLANNER_UNAVAILABLE";
  readonly done: number;
  readonly asked: number;
  readonly refused: number;
  /** S8: steps left for the next firing by the fan-out cap. */
  readonly deferred?: number | undefined;
  /** What Q cannot do, each with the reason and something it can do instead. */
  readonly cannot: readonly {
    readonly what: string;
    readonly reason: string;
    readonly instead: string;
  }[];
};

export type InstructionEngineDependencies = {
  readonly store: Pick<
    InstructionStore,
    | "instruction"
    | "expire"
    | "recordStep"
    | "stepDone"
    | "messagesSent"
    | "history"
    | "addSpend"
    | "pause"
    | "notify"
  >;
  readonly actions: readonly AnyAppAction[];
  readonly ports: AppActionPorts;
  /** The person, resolved now; null when they can no longer act. */
  readonly actorFor: (row: InstructionRow) => Promise<ActorContext | null>;
  readonly people: (
    actor: ActorContext,
  ) => Promise<readonly InstructionPerson[]>;
  readonly principalName?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /** The planner: one structured call through the Q Model Gateway. */
  /** The planner: one structured call through the Q Model Gateway (S5: budgeted). */
  readonly plan: InstructionPlanner;
  /** S6: the quarantined extractor; absent, the planner sees no thread facts. */
  readonly readThread?: QuarantinedThreadReader | undefined;
  /** An ASK step: the `app.<name>` card, as the person. */
  readonly ask: (
    actor: ActorContext,
    card: {
      readonly instructionId: string;
      readonly actionType: string;
      readonly payload: unknown;
      readonly words: string;
      readonly key: string;
    },
  ) => Promise<{ readonly qActionId: string } | null>;
  /**
   * CQ_INSTRUCTIONS_AUTO (lead 2026-10-03): off until the budget (S5) and
   * the quarantine (S6) are live. Off, every AUTO step is asked instead.
   */
  readonly autoEnabled: boolean;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

function grantLines(grant: InstructionGrant): string {
  return [
    ...grant.actions.map((entry) => `- ${entry.action}: ${entry.mode}`),
    `Working hours: days ${grant.workingHours.days.join(",")} ${grant.workingHours.start}-${grant.workingHours.end} ${grant.workingHours.timeZone}`,
    `Tone: ${grant.tone}`,
    `Topics: ${grant.topics.join("; ") || "none"}`,
    `At most ${String(grant.maxMessagesPerCounterpart)} messages per person, then ask.`,
    `At most ${String(FANOUT_MAX)} people per run; the rest wait for the next run.`,
    "Terms, money and commitments: always theirs to approve.",
  ].join("\n");
}

function actionLines(
  grant: InstructionGrant,
  actions: readonly AnyAppAction[],
): string {
  return grant.actions
    .map((entry) => actions.find((action) => action.name === entry.action))
    .filter((action): action is AnyAppAction => action !== undefined)
    .map((action) => {
      let schema: string;
      try {
        schema = JSON.stringify(z.toJSONSchema(action.input)).slice(0, 1_500);
      } catch {
        schema = "{}";
      }
      return `${action.name}: ${action.does}\n  arguments: ${schema}`;
    })
    .join("\n")
    .slice(0, 12_000);
}

function peopleLines(
  people: readonly InstructionPerson[],
  sent: ReadonlyMap<string, number>,
  facts: ReadonlyMap<string, InstructionThreadFacts>,
  topics: readonly string[],
): string {
  if (people.length === 0) return "No one yet.";
  return people
    .slice(0, 60)
    .map((person) =>
      [
        person.name.slice(0, 120),
        person.relationshipId === null
          ? `${person.counterpartKind === "COMPANY" ? "companyId" : "investorOrganisationId"} ${person.counterpartId} (no relationship yet)`
          : `relationshipId ${person.relationshipId}, ${person.counterpartKind === "COMPANY" ? "companyId" : "investorOrganisationId"} ${person.counterpartId}`,
        person.state === null ? null : `state ${person.state}`,
        person.relationshipId === null
          ? null
          : `Q messages sent ${String(sent.get(person.relationshipId) ?? 0)}`,
        // Their messages only as typed facts from the quarantined reader.
        person.relationshipId === null
          ? null
          : ((read) =>
              read === undefined ? null : `chat: ${factsLine(read, topics)}`)(
              facts.get(person.relationshipId),
            ),
      ]
        .filter((part): part is string => part !== null)
        .join(" | "),
    )
    .join("\n")
    .slice(0, 12_000);
}

export function createInstructionEngine(
  dependencies: InstructionEngineDependencies,
): {
  readonly fire: (
    instructionId: string,
    runKey: string,
  ) => Promise<InstructionFiringResult>;
} {
  const { store, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const empty = (
    outcome: InstructionFiringResult["outcome"],
  ): InstructionFiringResult => ({
    outcome,
    done: 0,
    asked: 0,
    refused: 0,
    cannot: [],
  });

  /**
   * The month's budget is used: the instruction pauses and Q asks, on a
   * card, whether to continue at a higher monthly budget (a new grant
   * version the person approves; nothing continues without it).
   */
  const pauseForBudget = async (
    row: InstructionRow,
    grant: InstructionGrant,
    actor: ActorContext,
  ): Promise<void> => {
    if (!(await store.pause(row.id, "BUDGET_EXHAUSTED"))) return;
    const raised = Math.min(
      9_999.99,
      Math.max(Number(grant.budgetUsdMonth) * 2, 1),
    ).toFixed(2);
    const month = now().toISOString().slice(0, 7);
    await dependencies
      .ask(actor, {
        instructionId: row.id,
        actionType: Q_INSTRUCTION_GRANT,
        payload: {
          ownerUserId: row.user_id,
          instructionId: row.id,
          goal: row.goal_text,
          grant: { ...grant, budgetUsdMonth: raised },
          continuation: "BUDGET",
        },
        words: `This month's budget ($${grant.budgetUsdMonth}) is used. Continue at $${raised} a month?`,
        key: `instr:${row.id}:budget-${month}:0`,
      })
      .catch((error: unknown) => {
        logger?.warn(
          { err: error, instructionId: row.id },
          "instruction budget card not prepared",
        );
      });
    const notice = needsYouNotice({
      goal: row.goal_text,
      asked: [],
      overBudget: true,
    });
    if (notice !== null) {
      await store
        .notify({
          instruction: row,
          key: `budget-${month}`,
          priority: "NEEDS_YOU",
          ...notice,
        })
        .catch(() => false);
    }
    logger?.info(
      { instructionId: row.id, budgetUsdMonth: grant.budgetUsdMonth },
      "standing instruction paused: budget used",
    );
  };

  /** A NOTED step: what Q tells them about its own work, once a day per kind. */
  const note = async (
    row: InstructionRow,
    kind: string,
    words: string,
    reasonCode: string,
  ): Promise<void> => {
    const day = now().toISOString().slice(0, 10);
    await store
      .recordStep({
        instruction: row,
        runKey: `note-${kind}-${day}`,
        stepIndex: 0,
        action: "q.note",
        mode: "ASK",
        status: "NOTED",
        relationshipId: null,
        words,
        reasonCode,
        qActionId: null,
        idempotencyKey: `instr:${row.id}:note-${kind}:${day}`,
      })
      .catch(() => false);
  };

  return {
    fire: async (instructionId, runKey) => {
      // A run key the steps table accepts, before anything acts.
      if (runKey.length < 8 || runKey.length > 80) {
        throw new Error("instruction run key must be 8-80 characters");
      }
      const row = await store.instruction(instructionId);
      if (row === null || row.status !== "ACTIVE") return empty("NOT_ACTIVE");
      const at = now();
      if (row.expires_at !== null && row.expires_at.getTime() <= at.getTime()) {
        await store.expire(row.id);
        return empty("EXPIRED");
      }
      const grant = InstructionGrantSchema.safeParse(row.grant_payload);
      if (!grant.success) return empty("NOT_ACTIVE");
      // Q works in their working hours: no planning (and no spend) outside,
      // and it says so once a day on their work page (QA 2026-10-03: two
      // approved instructions sat ACTIVE with nothing to show on a Saturday).
      if (!withinWorkingHours(at, grant.data.workingHours)) {
        const hours = grant.data.workingHours;
        await note(
          row,
          "hours",
          `Waiting for your working hours (${dayRange(hours.days)} ${hours.start}-${hours.end}, ${hours.timeZone}) before I start.`,
          "OUTSIDE_HOURS",
        );
        return empty("OUTSIDE_HOURS");
      }
      const actor = await dependencies.actorFor(row);
      if (actor === null || actor.userId !== row.user_id) {
        return empty("NO_ACTOR");
      }
      const people = await dependencies.people(actor).catch(() => []);
      const sentBefore = await store.messagesSent(row.id);
      const history = await store.history(row.id);
      const keyOf = (index: number) =>
        `instr:${row.id}:${runKey}:${String(index)}`;

      // S5: what is left of this month's budget. Below one planning call,
      // the instruction pauses and asks to continue (no call is made).
      // Whole micro-dollars: money is never compared as floats.
      const micros = (usd: number) => Math.round(usd * 1_000_000);
      let left =
        micros(Number(row.budget_usd_month)) -
        micros(Number(row.spent_this_month));

      // S6: their messages, read only through the quarantined extractor,
      // keeping one planning call in reserve.
      const facts = new Map<string, InstructionThreadFacts>();
      if (dependencies.readThread !== undefined) {
        const threads = inScope(grant.data, people)
          .map((person) => person.relationshipId)
          .filter((id): id is string => id !== null)
          .slice(0, THREADS_PER_FIRING);
        for (const relationshipId of threads) {
          const spare = left - micros(PLAN_MAX_COST_USD);
          const read = await dependencies.readThread({
            actor,
            instructionId: row.id,
            relationshipId,
            topics: grant.data.topics,
            now: at,
            maxCostUsd: Math.max(0, spare) / 1_000_000,
          });
          if (read.costUsd > 0) {
            left -= micros(read.costUsd);
            await store.addSpend(row.id, read.costUsd);
          }
          if (read.facts !== null) facts.set(relationshipId, read.facts);
        }
      }

      // Plan; validate; re-plan with the reasons at most twice.
      let refusals = "None.";
      let plan: InstructionPlanResult | null = null;
      let verdicts: StepVerdict[] = [];
      for (let attempt = 0; attempt <= MAX_REPLANS; attempt += 1) {
        if (!(left >= micros(PLAN_MAX_COST_USD))) {
          await pauseForBudget(row, grant.data, actor);
          return empty("OVER_BUDGET");
        }
        const planned = await dependencies.plan(
          {
            tenantId: row.tenant_id,
            userId: row.user_id,
            instructionId: row.id,
          },
          {
            principalName:
              (await dependencies.principalName?.(actor).catch(() => null)) ??
              "the person",
            goal: row.goal_text,
            grant: grantLines(grant.data),
            actions: actionLines(grant.data, dependencies.actions),
            now: `${at.toISOString()} (their zone ${grant.data.workingHours.timeZone})`,
            people: peopleLines(
              inScope(grant.data, people),
              sentBefore,
              facts,
              grant.data.topics,
            ),
            history:
              history.length === 0
                ? "Nothing yet."
                : history
                    .map(
                      (step) =>
                        `${step.created_at.toISOString()} ${step.status} ${step.action}: ${step.words}`,
                    )
                    .join("\n")
                    .slice(-6_000),
            refusals,
          },
          { maxCostUsd: left / 1_000_000 },
        );
        if (planned.costUsd > 0) {
          left -= micros(planned.costUsd);
          await store.addSpend(row.id, planned.costUsd);
        }
        plan = planned.plan;
        if (plan === null) return empty("PLANNER_UNAVAILABLE");
        const sent = new Map(sentBefore);
        const current = plan;
        verdicts = current.steps.map((step, index) =>
          validateStep(step, {
            grant: grant.data,
            actions: dependencies.actions,
            people,
            sent,
            now: at,
            stepKey: keyOf(index),
            facts,
          }),
        );
        const refused = verdicts
          .map((verdict, index) => ({ verdict, step: current.steps[index] }))
          .filter(
            (entry) =>
              entry.verdict.verdict === "REFUSED" &&
              entry.verdict.code !== "OUTSIDE_HOURS",
          );
        if (refused.length === 0 || attempt === MAX_REPLANS) break;
        refusals = refused
          .map(
            ({ verdict, step }) =>
              `${step?.action ?? "?"}: ${verdict.verdict === "REFUSED" ? verdict.code : ""}`,
          )
          .join("\n")
          .slice(0, 3_000);
      }
      if (plan === null) return empty("PLANNER_UNAVAILABLE");
      if (plan.steps.length === 0 && plan.cannot.length === 0) {
        const covered = inScope(grant.data, people).length;
        await note(
          row,
          "idle",
          covered === 0
            ? "Nothing to work on yet: no one is in reach of this instruction. I'll look again later."
            : `Looked at ${String(covered)} ${covered === 1 ? "person" : "people"}: nothing to do right now. I'll look again later.`,
          "NOTHING_TO_DO",
        );
      }

      let done = 0;
      let asked = 0;
      const askedWords: string[] = [];
      let refusedCount = 0;
      // S8 fan-out: at most FANOUT_MAX people are acted for in one firing;
      // steps for anyone beyond are left for the next firing (not recorded,
      // so they can be planned again). Each person's steps run in order;
      // different people's run side by side.
      const steps = plan.steps;
      const whoOf = (index: number): string => {
        const verdict = verdicts[index];
        if (
          verdict?.relationshipId !== null &&
          verdict?.relationshipId !== undefined
        ) {
          return verdict.relationshipId;
        }
        const raw = steps[index]?.argumentsJson ?? "";
        const company = /"companyId"\s*:\s*"([^"]+)"/u.exec(raw)?.[1];
        return company === undefined ? "" : `company:${company}`;
      };
      const groups = new Map<string, number[]>();
      for (const index of verdicts.keys()) {
        const who = whoOf(index);
        groups.set(who, [...(groups.get(who) ?? []), index]);
      }
      const acting = [...groups.keys()].filter((who) => who !== "");
      const allowed = new Set(acting.slice(0, FANOUT_MAX));
      const deferred = acting
        .slice(FANOUT_MAX)
        .reduce((sum, who) => sum + (groups.get(who)?.length ?? 0), 0);
      if (deferred > 0) {
        logger?.info(
          { instructionId: row.id, people: acting.length, deferred },
          "standing instruction fan-out capped; the rest waits for the next firing",
        );
      }
      const runStep = async (index: number): Promise<void> => {
        const verdict = verdicts[index];
        if (verdict === undefined) return;
        const step = steps[index];
        if (step === undefined) return;
        const key = keyOf(index);
        if (await store.stepDone(key)) return;
        const record = (input: {
          readonly status: "DONE" | "ASKED" | "REFUSED" | "FAILED";
          readonly mode: "AUTO" | "ASK";
          readonly words: string;
          readonly reasonCode: string | null;
          readonly qActionId: string | null;
        }) =>
          store.recordStep({
            instruction: row,
            runKey,
            stepIndex: index,
            action: step.action,
            relationshipId: verdict.relationshipId,
            idempotencyKey: key,
            ...input,
          });

        if (verdict.verdict === "REFUSED") {
          refusedCount += 1;
          const words = REFUSAL_WORDS[verdict.code];
          await record({
            status: "REFUSED",
            mode: "ASK",
            words: `Didn't: ${step.words} -- ${words.reason}; ${words.instead}.`,
            reasonCode: verdict.code,
            qActionId: null,
          });
          return;
        }
        if (verdict.verdict === "AUTO" && !dependencies.autoEnabled) {
          logger?.info(
            { instructionId: row.id, action: step.action },
            "instruction AUTO step asked: autonomy is off",
          );
        }
        if (verdict.verdict === "AUTO" && dependencies.autoEnabled) {
          const context = {
            actor,
            idempotencyKey: key,
            correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
            surface: "Q" as const,
          };
          try {
            // The declaration's own authorize step, then its one service
            // call: the same command the person's own button runs.
            const allowed = await verdict.action.authorize(
              dependencies.ports,
              context,
              verdict.input,
            );
            if (!allowed.ok) {
              refusedCount += 1;
              await record({
                status: "REFUSED",
                mode: "AUTO",
                words: `Didn't: ${step.words} -- it isn't available to you right now.`,
                reasonCode: "NOT_AUTHORIZED",
                qActionId: null,
              });
              return;
            }
            await verdict.action.run(
              dependencies.ports,
              context,
              verdict.input,
            );
            done += 1;
            await record({
              status: "DONE",
              mode: "AUTO",
              words: step.words,
              reasonCode: null,
              qActionId: null,
            });
          } catch (error: unknown) {
            logger?.warn(
              { err: error, instructionId: row.id, action: step.action },
              "instruction step not applied",
            );
            await record({
              status: "FAILED",
              mode: "AUTO",
              words: `Couldn't: ${step.words}`,
              reasonCode: "NOT_APPLIED",
              qActionId: null,
            });
          }
          return;
        }
        // ASK: the card the person's own request would prepare.
        const card = await dependencies
          .ask(actor, {
            instructionId: row.id,
            actionType: `app.${verdict.action.name}`,
            payload: verdict.input,
            words: step.words,
            key,
          })
          .catch((error: unknown) => {
            logger?.warn(
              { err: error, instructionId: row.id, action: step.action },
              "instruction card not prepared",
            );
            return null;
          });
        if (card === null) {
          await record({
            status: "FAILED",
            mode: "ASK",
            words: `Couldn't prepare for your approval: ${step.words}`,
            reasonCode: "CARD_NOT_PREPARED",
            qActionId: null,
          });
          return;
        }
        asked += 1;
        askedWords.push(step.words);
        const code = verdict.verdict === "AUTO" ? "AUTONOMY_OFF" : verdict.code;
        const why = code === null ? null : (ASK_WORDS[code] ?? null);
        await record({
          status: "ASKED",
          mode: "ASK",
          words: `Waiting for your yes${why === null ? "" : ` (${why})`}: ${step.words}`,
          reasonCode: code,
          qActionId: card.qActionId,
        });
      };
      await Promise.all(
        [...groups.entries()]
          .filter(([who]) => who === "" || allowed.has(who))
          .map(async ([, indexes]) => {
            for (const index of indexes) await runStep(index);
          }),
      );

      // S7: what waits on them is a NEEDS_YOU notice at once.
      const waiting = needsYouNotice({
        goal: row.goal_text,
        asked: askedWords,
        overBudget: false,
      });
      if (waiting !== null) {
        await store
          .notify({
            instruction: row,
            key: `${runKey}:needs`,
            priority: "NEEDS_YOU",
            ...waiting,
          })
          .catch(() => false);
      }

      // What no declared action can do: said now, with an alternative.
      for (const [offset, entry] of plan.cannot.entries()) {
        const index = 100 + offset;
        await store.recordStep({
          instruction: row,
          runKey,
          stepIndex: index,
          action: "q.cannot",
          mode: "ASK",
          status: "REFUSED",
          relationshipId: null,
          words: `Can't ${entry.what}: ${entry.reason}. Instead: ${entry.instead}`,
          reasonCode: "CANNOT",
          qActionId: null,
          idempotencyKey: keyOf(index),
        });
      }
      return {
        outcome: "RAN",
        done,
        asked,
        refused: refusedCount,
        deferred,
        cannot: plan.cannot.map((entry) => ({ ...entry })),
      };
    },
  };
}

export type InstructionEngine = ReturnType<typeof createInstructionEngine>;

/**
 * Who an instruction may concern (S4): their own relationships (declined
 * ones left out), then -- as candidates with no relationship yet -- the
 * companies in their own feed and the ones they saved. A company they
 * passed is never a candidate; one already in a relationship appears once.
 * Everything here is what the person may already see on their own pages.
 */
export async function instructionPeople(
  actor: ActorContext,
  reads: {
    readonly relationships: (actor: ActorContext) => Promise<{
      readonly items: readonly {
        readonly relationshipId: string;
        readonly counterpart: {
          readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
          readonly id: string;
          readonly name: string;
        };
        readonly state: string;
      }[];
    } | null>;
    readonly feed: (
      actor: ActorContext,
    ) => Promise<
      readonly { readonly companyId: string; readonly name: string }[]
    >;
    readonly decisions: (actor: ActorContext) => Promise<
      readonly {
        readonly companyId: string;
        readonly name: string;
        readonly decision: "SAVED" | "PASSED";
      }[]
    >;
  },
): Promise<readonly InstructionPerson[]> {
  const [own, feed, decisions] = await Promise.all([
    reads.relationships(actor).catch(() => null),
    reads.feed(actor).catch(() => []),
    reads.decisions(actor).catch(() => []),
  ]);
  const people: InstructionPerson[] = (own?.items ?? [])
    .filter((item) => item.state !== "DECLINED")
    .map((item) => ({
      relationshipId: item.relationshipId,
      counterpartKind: item.counterpart.kind,
      counterpartId: item.counterpart.id,
      name: item.counterpart.name,
      state: item.state,
    }));
  const known = new Set(
    (own?.items ?? [])
      .filter((item) => item.counterpart.kind === "COMPANY")
      .map((item) => item.counterpart.id),
  );
  const passed = new Set(
    decisions
      .filter((entry) => entry.decision === "PASSED")
      .map((entry) => entry.companyId),
  );
  const candidate = (companyId: string, name: string, state: string) => {
    if (known.has(companyId) || passed.has(companyId)) return;
    known.add(companyId);
    people.push({
      relationshipId: null,
      counterpartKind: "COMPANY",
      counterpartId: companyId,
      name,
      state,
    });
  };
  for (const entry of decisions) {
    if (entry.decision === "SAVED") {
      candidate(entry.companyId, entry.name, "SAVED_NOT_CONTACTED");
    }
  }
  for (const item of feed) {
    candidate(item.companyId, item.name, "IN_FEED_NOT_CONTACTED");
  }
  return people;
}

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon-Fri" for consecutive ISO days, else a list. */
export function dayRange(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const name = (day: number) => DAY_SHORT[day - 1] ?? "";
  const consecutive = sorted.every(
    (day, index) => index === 0 || day === (sorted[index - 1] ?? 0) + 1,
  );
  return consecutive && sorted.length > 2
    ? `${name(sorted[0] ?? 1)}-${name(sorted[sorted.length - 1] ?? 1)}`
    : sorted.map(name).join(", ");
}
