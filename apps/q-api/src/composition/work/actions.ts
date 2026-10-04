import { z } from "zod";

import { APP_ACTIONS, settleGrant } from "@capital-q/app-actions";
import {
  InstructionGrantPayloadSchema,
  InstructionGrantSchema,
  Q_INSTRUCTION_GRANT,
  Q_WORK_OUTREACH_START,
  Q_WORK_STANDIN_START,
  QActionTypeSchema,
  QWorkOutreachStartPayloadSchema,
  QWorkStandInStartPayloadSchema,
  UuidSchema,
  type QSubjectRef,
  type QWorkDto,
  type QWorkOutreachStartPayload,
  type QWorkStandInStartPayload,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import { closestByName } from "@capital-q/q-runtime";
import type { QWorkIntelligencePort, QWorkProposal } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import type {
  InstructionRow,
  InstructionStore,
} from "../instructions/store.js";
import { TERMINAL_STAGES, type LaneRow, type WorkStore } from "./store.js";

/**
 * Starting Q's delegated work (AUTO, ADR 0030): one approved action whose
 * payload IS the grant. The person sees the exact plan -- the limits, the
 * words Q may say, the questions, the call windows, the expiry -- and
 * nothing happens until they approve exactly that. Its execution files the
 * delegation; the runner then carries it out, as them, within the grant.
 */

export const WORK_OUTREACH_START = QActionTypeSchema.parse(
  Q_WORK_OUTREACH_START,
);
export const WORK_STANDIN_START = QActionTypeSchema.parse(Q_WORK_STANDIN_START);

const StartedSchema = z.object({ delegationId: UuidSchema }).strict();
const DAY_MS = 24 * 3_600_000;

function quoted(text: string): string {
  return `"${text}"`;
}

function outreachPlan(payload: QWorkOutreachStartPayload): string {
  const grant = payload.grant;
  const lines: string[] = [
    `Read your Discover feed (profiles and pitch transcripts you can see) and pick up to ${String(grant.maxCompanies)} founders closest to your mandate, each with the words it rests on.`,
    "Express your interest in each (not a commitment to invest) and tell you who, then wait for them to accept.",
    `When one accepts, send this, marked as from Q:\n${quoted(grant.openingMessage)}`,
  ];
  if (grant.brief !== null) {
    lines.push(
      `Answer their questions saying only:\n${quoted(grant.brief)}\nAnything else comes back to you.`,
    );
  }
  if (grant.topics.length > 0) {
    lines.push(`Learn for you: ${grant.topics.join("; ")}.`);
  }
  if (grant.interview !== null) {
    lines.push(
      `Run a first-stage interview in the chat, these questions word for word:\n${grant.interview.questions
        .map((question, index) => `  ${String(index + 1)}) ${question}`)
        .join(
          "\n",
        )}\nThen send you a report (how it went, Q's view, whether to proceed).`,
    );
  }
  if (grant.call !== null) {
    const windows = grant.call.windows
      .map(
        (window) =>
          `${window.days.map((day) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day - 1]).join("/")} ${String(window.startHour).padStart(2, "0")}:00-${String(window.endHour).padStart(2, "0")}:00`,
      )
      .join(", ");
    lines.push(
      grant.call.mayBookInWindows && grant.interview === null
        ? `Book "${grant.call.purpose}" (${String(grant.call.durationMinutes)} min) at the first free time in ${windows} on your calendar, with a Google Meet invite to them.`
        : `Ask you which time works (${windows}), then book "${grant.call.purpose}" (${String(grant.call.durationMinutes)} min) with a Google Meet invite to them.`,
    );
  }
  lines.push(
    `Tell you at each step; stop on your word, or after ${String(payload.expiresInDays)} days.`,
  );
  return lines.map((line, index) => `${String(index + 1)}. ${line}`).join("\n");
}

function standInPlan(payload: QWorkStandInStartPayload): string {
  return [
    `1. When you've been away ${String(payload.grant.awayAfterMinutes)} minutes (or say you're away), answer investors' new chat messages, marked as Q standing in for you, saying only:\n${quoted(payload.grant.brief)}`,
    "2. Anything else: tell them you'll answer when you're back, and tell you.",
    "3. When you're back, hand every chat back and tell you what happened.",
    `4. Stop on your word, or after ${String(payload.expiresInDays)} days.`,
  ].join("\n");
}

export function createWorkStartActions(dependencies: {
  readonly store: WorkStore;
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly ownCompany: (actor: ActorContext) => Promise<string | null>;
  readonly logger?: Logger | undefined;
}): readonly AnyQActionDefinition[] {
  const { store, logger } = dependencies;
  const owner = (actor: ActorContext) => ({
    tenantId: actor.tenantId,
    userId: actor.userId,
    organisationId: actor.organisationId ?? null,
  });

  return [
    defineQAction<QWorkOutreachStartPayload, z.infer<typeof StartedSchema>>({
      actionType: WORK_OUTREACH_START,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description:
        "Starts an investor's delegated outreach: Q picks founders from their own feed up to the approved number, expresses interest, chats within the approved brief and topics, optionally interviews and reports, and books calls in the approved windows, as the approver, until done, stopped or expired.",
      payload: QWorkOutreachStartPayloadSchema,
      result: StartedSchema,
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "USER", userId: payload.ownerUserId },
      ],
      describe: (payload) => ({
        summary: `Q handles outreach to up to ${String(payload.grant.maxCompanies)} founders for you`,
        preview: outreachPlan(payload),
      }),
      confirm: () =>
        "On it. I'll go through your feed and tell you who I picked.",
      authorize: async (payload, actor) => {
        if (actor.actorType !== "HUMAN") {
          return { outcome: "DENY", code: "NOT_A_PERSON" };
        }
        if (payload.ownerUserId !== actor.userId) {
          return { outcome: "DENY", code: "NOT_YOURS" };
        }
        return (await dependencies.isInvestor(actor))
          ? { outcome: "ALLOW" }
          : { outcome: "DENY", code: "NOT_AN_INVESTOR" };
      },
      executor: {
        execute: async (action, context) => {
          try {
            const delegationId = await store.insertDelegation({
              owner: owner(context.approver),
              kind: "INVESTOR_OUTREACH",
              qActionId: action.actionId,
              grant: action.payload.grant,
              expiresAt: new Date(
                Date.now() + action.payload.expiresInDays * DAY_MS,
              ),
              summary: "Starting: reading your feed.",
            });
            return { outcome: "EXECUTED", result: { delegationId } };
          } catch (error: unknown) {
            logger?.warn(
              { err: error, actionId: action.actionId },
              "q work not started",
            );
            return {
              outcome: "FAILED",
              failureCode: "NOT_FILED",
              retryable: true,
            };
          }
        },
      },
    }),
    defineQAction<QWorkStandInStartPayload, z.infer<typeof StartedSchema>>({
      actionType: WORK_STANDIN_START,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description:
        "Starts a founder's stand-in: while they are away Q answers investors' chat messages only from the approved brief, marked as Q, defers the rest, and hands the chats back when they return, until stopped or expired.",
      payload: QWorkStandInStartPayloadSchema,
      result: StartedSchema,
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "USER", userId: payload.ownerUserId },
      ],
      describe: (payload) => ({
        summary: "Q stands in for you while you're away",
        preview: standInPlan(payload),
      }),
      confirm: () =>
        "Done. When you're away, I'll answer investors from your brief and hand the chats back when you return.",
      authorize: async (payload, actor) => {
        if (actor.actorType !== "HUMAN") {
          return { outcome: "DENY", code: "NOT_A_PERSON" };
        }
        if (payload.ownerUserId !== actor.userId) {
          return { outcome: "DENY", code: "NOT_YOURS" };
        }
        return (await dependencies.ownCompany(actor)) !== null
          ? { outcome: "ALLOW" }
          : { outcome: "DENY", code: "NO_COMPANY" };
      },
      executor: {
        execute: async (action, context) => {
          try {
            const delegationId = await store.insertDelegation({
              owner: owner(context.approver),
              kind: "FOUNDER_STAND_IN",
              qActionId: action.actionId,
              grant: action.payload.grant,
              expiresAt: new Date(
                Date.now() + action.payload.expiresInDays * DAY_MS,
              ),
              summary: "Ready to step in when you're away.",
            });
            await store.stopOtherStandIns(
              owner(context.approver),
              delegationId,
            );
            return { outcome: "EXECUTED", result: { delegationId } };
          } catch (error: unknown) {
            logger?.warn(
              { err: error, actionId: action.actionId },
              "stand-in not started",
            );
            return {
              outcome: "FAILED",
              failureCode: "NOT_FILED",
              retryable: true,
            };
          }
        },
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// The board: one work proposal per run, waiting for the run's prepare step
// ---------------------------------------------------------------------------

const READING_TTL_MS = 10 * 60_000;

export function createWorkActionBoard(
  options: { readonly now?: (() => number) | undefined } = {},
): {
  readonly prepareForApproval: QWorkIntelligencePort["prepareForApproval"];
  readonly proposer: QActionProposer;
} {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<
    string,
    {
      tenantId: string;
      actorUserId: string;
      proposal: QWorkProposal;
      at: number;
    }
  >();
  return {
    prepareForApproval: (entry) => {
      const cutoff = now() - READING_TTL_MS;
      for (const [runId, value] of prepared) {
        if (value.at < cutoff) prepared.delete(runId);
      }
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        return JSON.stringify(existing.proposal) ===
          JSON.stringify(entry.proposal)
          ? "PREPARED"
          : "ONE_PER_TURN";
      }
      prepared.set(entry.runId, {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        proposal: entry.proposal,
        at: now(),
      });
      return "PREPARED";
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        const actionType = QActionTypeSchema.parse(entry.proposal.actionType);
        if (entry.proposal.actionType === Q_INSTRUCTION_GRANT) {
          // ADR 0043: the card shows what code will really allow -- unknown
          // actions dropped, AUTO on anything not delegable shown as ASK.
          const instruction = InstructionGrantPayloadSchema.safeParse(
            entry.proposal.payload,
          );
          if (
            !instruction.success ||
            instruction.data.ownerUserId !== context.actor.userId
          ) {
            return Promise.resolve({
              refused:
                "that instruction isn't something I can prepare as written",
            });
          }
          const settled = settleGrant(instruction.data.grant, APP_ACTIONS);
          return Promise.resolve({
            actionType,
            payload: { ...instruction.data, grant: settled.grant },
          });
        }
        const parsed = (
          entry.proposal.actionType === Q_WORK_OUTREACH_START
            ? QWorkOutreachStartPayloadSchema
            : QWorkStandInStartPayloadSchema
        ).safeParse(entry.proposal.payload);
        return Promise.resolve(
          parsed.success
            ? { actionType, payload: parsed.data }
            : { refused: "that plan isn't something I can prepare as written" },
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// What the person sees: their own work as DTOs
// ---------------------------------------------------------------------------

type Reason = { reason: string; quote: string };

function laneDto(lane: LaneRow): QWorkDto["lanes"][number] {
  const needs = lane.needs as { offered?: unknown } | null;
  const offered = Array.isArray(needs?.offered)
    ? (needs.offered as { start: string; label: string }[]).slice(0, 3)
    : [];
  const report = lane.report as {
    headline?: unknown;
    recommendation?: unknown;
  } | null;
  const chatPath =
    lane.relationship_id === null
      ? null
      : lane.company_id !== null
        ? `/relationships/company/${lane.company_id}/messages`
        : lane.investor_organisation_id !== null
          ? `/relationships/investor/${lane.investor_organisation_id}/messages`
          : null;
  return {
    id: lane.id,
    counterpartName: lane.counterpart_name,
    stage: lane.stage,
    lastStep: lane.last_step,
    reasons: (Array.isArray(lane.match_reasons)
      ? (lane.match_reasons as Reason[])
      : []
    )
      .slice(0, 5)
      .map((item) => ({
        reason: String(item.reason).slice(0, 300),
        quote: String(item.quote).slice(0, 400),
      })),
    offered: TERMINAL_STAGES.includes(lane.stage) ? [] : offered,
    report:
      report !== null &&
      typeof report.headline === "string" &&
      (report.recommendation === "PROCEED" ||
        report.recommendation === "MAYBE" ||
        report.recommendation === "PASS")
        ? {
            headline: report.headline.slice(0, 200),
            recommendation: report.recommendation,
          }
        : null,
    chatPath,
    updatedAt: lane.updated_at.toISOString(),
  };
}

/** A standing instruction (ADR 0043) on the same list as delegated work. */
function instructionWorkDto(row: InstructionRow): QWorkDto | null {
  if (row.status === "DRAFT") return null;
  const grant = InstructionGrantSchema.safeParse(row.grant_payload);
  const auto = grant.success
    ? grant.data.actions.filter((entry) => entry.mode === "AUTO").length
    : 0;
  const summary =
    row.status === "PAUSED"
      ? `Paused (${row.pause_reason ?? "waiting for you"}): ${row.goal_text}`
      : `${row.goal_text} -- ${String(auto)} things on my own, the rest I ask; $${row.spent_this_month.replace(/(\.\d{2})\d*$/u, "$1")} of $${row.budget_usd_month} this month.`;
  const live = row.status === "ACTIVE" || row.status === "PAUSED";
  return {
    id: row.id,
    kind: "STANDING_INSTRUCTION",
    status: row.status === "PAUSED" ? "ACTIVE" : row.status,
    summary: summary.slice(0, 300),
    createdAt: row.created_at.toISOString(),
    expiresAt: (row.expires_at ?? row.created_at).toISOString(),
    lanes: [],
    goal: row.goal_text.slice(0, 300),
    run: !live
      ? null
      : row.status === "PAUSED"
        ? {
            state: "PAUSED",
            pauseReason: row.pause_reason ?? "WAITING_FOR_YOU",
          }
        : { state: "WORKING", pauseReason: null },
    lastStep:
      row.last_step_words === undefined ||
      row.last_step_words === null ||
      row.last_step_at === undefined ||
      row.last_step_at === null
        ? null
        : {
            words: row.last_step_words.slice(0, 500),
            at: row.last_step_at.toISOString(),
          },
    // Money stays a decimal string end to end (never a float on the wire).
    spend: {
      spentUsdMonth: cents(row.spent_this_month),
      budgetUsdMonth: cents(row.budget_usd_month),
    },
  };
}

/** "1.843210" -> "1.84": truncated, never rounded up past what was spent. */
function cents(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/**
 * WORK-58: where delegated work stands. WAITING while every open founder
 * waits on the other side (or on the person's choice of time); WORKING
 * while Q has something to do itself. Null once it has ended.
 */
export function delegationRun(
  status: QWorkDto["status"],
  lanes: readonly QWorkDto["lanes"][number][],
): QWorkDto["run"] {
  if (status !== "ACTIVE") return null;
  const open = lanes.filter((lane) => !TERMINAL_STAGES.includes(lane.stage));
  const waiting =
    open.length > 0 &&
    open.every(
      (lane) =>
        lane.stage === "WAITING_ACCEPTANCE" || lane.stage === "NEEDS_TIMES",
    );
  return { state: waiting ? "WAITING" : "WORKING", pauseReason: null };
}

/** The most recent lane step, as the row's "last thing done". */
export function latestLaneStep(
  lanes: readonly QWorkDto["lanes"][number][],
): QWorkDto["lastStep"] {
  let latest: QWorkDto["lastStep"] = null;
  for (const lane of lanes) {
    if (lane.lastStep === null) continue;
    if (latest === null || lane.updatedAt > latest.at) {
      latest = {
        words: `${lane.counterpartName}: ${lane.lastStep}`.slice(0, 500),
        at: lane.updatedAt,
      };
    }
  }
  return latest;
}

export function createWorkPort(dependencies: {
  readonly store: WorkStore;
  /** ADR 0043 standing instructions, listed and stopped beside work. */
  readonly instructions?: InstructionStore | undefined;
  readonly board: ReturnType<typeof createWorkActionBoard>;
  /**
   * Who a standing instruction could reach (relationships, feed, saved):
   * what a name they said to leave out is matched against.
   */
  readonly reachable?:
    | ((
        actor: ActorContext,
      ) => Promise<
        readonly { readonly counterpartId: string; readonly name: string }[]
      >)
    | undefined;
  readonly isInvestor: (actor: ActorContext) => Promise<boolean>;
  readonly ownCompany: (actor: ActorContext) => Promise<string | null>;
  /** ADR 0028 errands, read and stopped beside delegated work. */
  readonly errands?:
    | {
        readonly own: (actor: ActorContext) => Promise<
          readonly {
            readonly id: string;
            readonly counterpart_name: string;
            readonly status: string;
            readonly last_step: string | null;
            readonly failure: string | null;
          }[]
        >;
        readonly stop: (
          actor: ActorContext,
          errandId: string,
        ) => Promise<boolean>;
      }
    | undefined;
}): QWorkIntelligencePort & {
  readonly detail: (
    actor: ActorContext,
    delegationId: string,
  ) => Promise<{
    work: QWorkDto;
    steps: { words: string; at: string }[];
  } | null>;
  readonly report: (
    actor: ActorContext,
    delegationId: string,
    laneId: string,
  ) => Promise<unknown>;
  readonly seen: (actor: ActorContext) => Promise<void>;
  /** WORK-58: the person pauses or resumes their own standing instruction. */
  readonly pause: (actor: ActorContext, id: string) => Promise<boolean>;
  readonly resume: (actor: ActorContext, id: string) => Promise<boolean>;
} {
  const { store } = dependencies;
  const toDto = async (
    row: Awaited<ReturnType<WorkStore["own"]>>[number],
  ): Promise<QWorkDto> => {
    const lanes = (await store.lanes(row.id)).slice(0, 30).map(laneDto);
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      lanes,
      goal: null,
      run: delegationRun(row.status, lanes),
      lastStep: latestLaneStep(lanes),
      spend: null,
    };
  };
  return {
    isInvestor: dependencies.isInvestor,
    hasCompany: async (actor) =>
      (await dependencies.ownCompany(actor)) !== null,
    list: async (actor) => {
      const work = await Promise.all(
        (await store.own(actor)).map((row) => toDto(row)),
      );
      const instructions = (
        (await dependencies.instructions?.list(actor)) ?? []
      )
        .map(instructionWorkDto)
        .filter((item): item is QWorkDto => item !== null);
      // Live first, then the most recent; the list stays one list.
      return [...instructions, ...work].sort(
        (a, b) =>
          Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") ||
          b.createdAt.localeCompare(a.createdAt),
      );
    },
    timeZoneOf: async (actor) =>
      (await dependencies.instructions?.timeZoneOf(actor)) ?? null,
    counterpartsNamed:
      dependencies.reachable === undefined
        ? undefined
        : async (actor, names) => {
            const people = (await dependencies.reachable?.(actor)) ?? [];
            const found: { counterpartId: string; name: string }[] = [];
            const unknown: string[] = [];
            for (const said of names) {
              // The same matcher every name a person says goes through.
              const matches = closestByName(people, said, (p) => p.name);
              const [only] = matches;
              if (matches.length === 1 && only !== undefined) {
                found.push({
                  counterpartId: only.counterpartId,
                  name: only.name,
                });
              } else {
                unknown.push(said);
              }
            }
            return { found, unknown };
          },
    stop: async (actor, delegationId, laneId) =>
      (await store.stop(actor, delegationId, laneId)) ||
      (laneId === null &&
        dependencies.instructions !== undefined &&
        (await dependencies.instructions.stop(actor, delegationId))) ||
      (laneId === null &&
        dependencies.errands !== undefined &&
        (await dependencies.errands.stop(actor, delegationId))),
    errands:
      dependencies.errands === undefined
        ? undefined
        : async (actor) =>
            ((await dependencies.errands?.own(actor)) ?? []).map((row) => ({
              errandId: row.id,
              counterpartName: row.counterpart_name,
              status: row.status,
              lastStep: row.failure ?? row.last_step,
            })),
    answer: (actor, delegationId, laneId, answer) =>
      store.answer(actor, delegationId, laneId, answer),
    setAway: (actor, away) => store.setAway(actor, away),
    prepareForApproval: dependencies.board.prepareForApproval,
    seen: (actor) => store.seen(actor),
    pause: async (actor, id) =>
      (await dependencies.instructions?.pauseByOwner(actor, id)) ?? false,
    resume: async (actor, id) =>
      (await dependencies.instructions?.resumeByOwner(actor, id)) ?? false,
    detail: async (actor, delegationId) => {
      const row = await store.ownDelegation(actor, delegationId);
      if (row === null) {
        const instruction = await dependencies.instructions?.own(
          actor,
          delegationId,
        );
        const work =
          instruction === undefined || instruction === null
            ? null
            : instructionWorkDto(instruction);
        if (work === null || dependencies.instructions === undefined) {
          return null;
        }
        const steps = await dependencies.instructions.steps(
          actor,
          delegationId,
        );
        return {
          work,
          steps: steps.map((step) => ({
            words: step.words,
            at: step.created_at.toISOString(),
          })),
        };
      }
      const steps = await store.steps(actor, delegationId);
      return {
        work: await toDto(row),
        steps: steps.map((step) => ({
          words: step.words,
          at: step.created_at.toISOString(),
        })),
      };
    },
    report: async (actor, delegationId, laneId) => {
      const row = await store.ownDelegation(actor, delegationId);
      if (row === null) return null;
      const lane = await store.lane(laneId);
      if (
        lane === null ||
        lane.delegation_id !== row.id ||
        lane.report === null
      ) {
        return null;
      }
      return {
        ...(lane.report as Record<string, unknown>),
        writtenAt: lane.report_at?.toISOString() ?? null,
      };
    },
  };
}

export type WorkPort = ReturnType<typeof createWorkPort>;
