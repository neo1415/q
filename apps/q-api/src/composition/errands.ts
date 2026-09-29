import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ChatMessageBodySchema,
  QActionTypeSchema,
  UuidSchema,
  type ModelDataPosture,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ChatService, ScheduleService } from "@capital-q/communication";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { InterestService } from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  ErrandReplyResultSchema,
  renderPrompt,
  type ErrandReplyResult,
  type ErrandReplyVariables,
} from "@capital-q/q-core";
import {
  ERRAND_START as ERRAND_START_NAME,
  type RelationshipIntelligencePort,
} from "@capital-q/q-tools";
import {
  AuthUserIdSchema,
  OrganisationIdSchema,
  resolveHumanActorContext,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

/**
 * Errands (founder direction 2026-09-29): "express interest; when they
 * accept, chat with them, answer their questions, book a call, send me the
 * link, notify me".
 *
 * `q.errand.start` is approved once, against the exact plan: the opening
 * message and the brief word for word, the call's purpose and length. Its
 * execution expresses interest (when asked) and files the errand; the
 * runner then carries the plan forward as the relationship moves.
 *
 * Authority stays the person's. Each step re-resolves their own context
 * (a revoked membership stops it) and runs the command their own button
 * runs, with its own party, connection, block and calendar checks, under a
 * step-scoped idempotency key. Q's messages carry the approved action's id,
 * so the other side sees them marked as sent by Q. What Q may say in a
 * reply is the approved brief and nothing else: the brief is the Context
 * Firewall for this conversation. The person can stop it at any time.
 */

export const ERRAND_START = QActionTypeSchema.parse(ERRAND_START_NAME);

/** An errand ends on its own after this long. */
const ERRAND_TTL_MS = 14 * 24 * 3_600_000;
/** Replies Q sends in one errand before handing the thread back. */
const MAX_REPLIES = 8;
/** A call is booked no sooner than this, so nobody is surprised. */
const CALL_LEAD_MS = 18 * 3_600_000;

export const ErrandStartPayloadSchema = z
  .object({
    relationshipId: UuidSchema.optional(),
    companyId: UuidSchema.optional(),
    counterpartName: z.string().trim().min(1).max(200),
    expressInterest: z.boolean(),
    openingMessage: ChatMessageBodySchema.nullable(),
    brief: z.string().trim().min(20).max(2_000).nullable(),
    bookCall: z
      .object({
        purpose: z.string().trim().min(3).max(200),
        durationMinutes: z.number().int().min(15).max(120),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine(
    (plan) =>
      (plan.relationshipId === undefined) !== (plan.companyId === undefined),
    { message: "exactly one of relationshipId or companyId" },
  )
  .refine((plan) => plan.companyId === undefined || plan.expressInterest, {
    message: "a company without a relationship starts with Express Interest",
  });
export type ErrandStartPayload = z.infer<typeof ErrandStartPayloadSchema>;

const ErrandStartResultSchema = z
  .object({ errandId: UuidSchema, relationshipId: UuidSchema })
  .strict();

function steps(plan: ErrandStartPayload): string[] {
  const lines: string[] = [];
  if (plan.expressInterest) {
    lines.push(
      `Express your interest in ${plan.counterpartName} now (not a commitment to invest).`,
    );
  }
  if (plan.openingMessage !== null) {
    lines.push(
      `${plan.expressInterest ? "When they accept, send" : "Send"} this, marked as from Q:\n"${plan.openingMessage}"`,
    );
  }
  if (plan.bookCall !== null) {
    lines.push(
      `Book "${plan.bookCall.purpose}" (${String(plan.bookCall.durationMinutes)} min) at the first free time on your calendar, with a Google Meet invite to their people.`,
    );
  }
  if (plan.brief !== null) {
    lines.push(
      `Answer their questions for up to two weeks, saying only:\n"${plan.brief}"\nAnything else comes back to you.`,
    );
  }
  lines.push("Tell you at each step, with the call's time and link.");
  return lines;
}

async function filed(
  sql: DatabaseExecutor,
  qActionId: string,
): Promise<{ id: string; relationship_id: string } | null> {
  const rows = await sql<{ id: string; relationship_id: string }[]>`
    select id, relationship_id from q_runtime.errands
     where q_action_id = ${qActionId} and relationship_id is not null`;
  return rows[0] ?? null;
}

export function createErrandStartAction(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly interests: InterestService;
  readonly relationships: RelationshipIntelligencePort;
  readonly chat: ChatService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { sql, interests, relationships, chat, logger } = dependencies;
  return defineQAction<
    ErrandStartPayload,
    z.infer<typeof ErrandStartResultSchema>
  >({
    actionType: ERRAND_START,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Starts an errand: Q carries out the exact approved plan on one relationship as it moves (express interest, opening message, replies from the approved brief, a call on the approver's calendar), as the approver, until done, stopped or two weeks pass.",
    payload: ErrandStartPayloadSchema,
    result: ErrandStartResultSchema,
    targets: (payload): readonly QSubjectRef[] =>
      payload.relationshipId === undefined
        ? [{ kind: "COMPANY", companyId: UuidSchema.parse(payload.companyId) }]
        : [{ kind: "RELATIONSHIP", relationshipId: payload.relationshipId }],
    describe: (payload) => ({
      summary: `Q looks after ${payload.counterpartName} for you`,
      preview: steps(payload)
        .map((line, index) => `${String(index + 1)}. ${line}`)
        .join("\n"),
    }),
    confirm: (payload) =>
      `On it. I'll look after ${payload.counterpartName} and tell you as things happen.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      if (payload.relationshipId === undefined) {
        const companyId = UuidSchema.parse(payload.companyId);
        return (await interests.mayExpressInterest({ actor, companyId }))
          ? { outcome: "ALLOW" }
          : { outcome: "DENY", code: "NOT_AVAILABLE" };
      }
      const party = await chat
        .readForQ({ actor, relationshipId: payload.relationshipId, limit: 1 })
        .catch(() => null);
      if (party === null) return { outcome: "DENY", code: "NOT_A_PARTY" };
      if (party.blocked) return { outcome: "DENY", code: "BLOCKED" };
      if (payload.expressInterest && !party.connected) {
        const status = await relationships.byRelationship(
          actor,
          payload.relationshipId,
        );
        if (status?.counterpart.kind !== "COMPANY") {
          return { outcome: "DENY", code: "NOT_AVAILABLE" };
        }
      }
      return { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) => {
        const approver = context.approver;
        // A retried execution of one approval is one errand.
        const existing = await filed(sql, action.actionId);
        if (existing !== null) {
          return {
            outcome: "EXECUTED",
            result: {
              errandId: existing.id,
              relationshipId: existing.relationship_id,
            },
          };
        }
        let relationshipId = action.payload.relationshipId ?? null;
        let companyId = action.payload.companyId ?? null;
        try {
          if (action.payload.expressInterest) {
            const target =
              companyId ??
              (relationshipId === null
                ? null
                : await relationships
                    .byRelationship(approver, relationshipId)
                    .then((found) =>
                      found?.counterpart.kind === "COMPANY"
                        ? found.counterpart.id
                        : null,
                    ));
            if (target !== null) {
              const expressed = await interests.expressInterest({
                actor: approver,
                companyId: target,
                surface: "Q_CONVERSATION",
                idempotencyKey: `q-action:${action.idempotencyKey}:interest`,
                correlationId: context.correlationId,
              });
              relationshipId = expressed.interest.relationshipId;
              companyId = target;
            }
          }
          if (relationshipId === null) {
            return {
              outcome: "FAILED",
              failureCode: "NO_RELATIONSHIP",
              retryable: false,
            };
          }
          const rows = await sql<{ id: string }[]>`
            insert into q_runtime.errands
              (tenant_id, user_id, organisation_id, q_action_id, company_id,
               relationship_id, counterpart_name, plan, last_step, expires_at)
            values (${approver.tenantId}, ${approver.userId},
                    ${approver.organisationId ?? null}, ${action.actionId},
                    ${companyId}, ${relationshipId},
                    ${action.payload.counterpartName},
                    ${JSON.stringify(action.payload)}::jsonb,
                    ${action.payload.expressInterest ? "Interest expressed; waiting for them to accept." : "Started."},
                    ${new Date(Date.now() + ERRAND_TTL_MS)})
            on conflict (q_action_id) do update set updated_at = q_runtime.errands.updated_at
            returning id`;
          const errandId = rows[0]?.id;
          if (errandId === undefined) {
            return {
              outcome: "FAILED",
              failureCode: "NOT_FILED",
              retryable: true,
            };
          }
          return { outcome: "EXECUTED", result: { errandId, relationshipId } };
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId },
            "errand not started",
          );
          return {
            outcome: "FAILED",
            failureCode: "ERRAND_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export type ErrandRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  organisation_id: string | null;
  q_action_id: string;
  relationship_id: string;
  counterpart_name: string;
  plan: unknown;
  stage: "WAITING_CONNECTION" | "CONVERSING" | "CALL_BOOKED" | "FINISHED";
  seen_until: Date | null;
  replies_sent: number;
  meeting_id: string | null;
  expires_at: Date;
};

export type ErrandReplyComposer = {
  readonly compose: (input: {
    readonly actor: ActorContext;
    readonly principalName: string;
    readonly counterpartName: string;
    readonly brief: string;
    readonly callComing: boolean;
    readonly thread: string;
  }) => Promise<ErrandReplyResult | null>;
};

const REPLY_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 700,
  attemptTimeoutMs: 30_000,
} as const;

export function createErrandReplyComposer(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): ErrandReplyComposer {
  const registry = createDefaultPromptRegistry();
  return {
    compose: async (input) => {
      const rendered = renderPrompt<ErrandReplyVariables>(registry, {
        task: "ERRAND_REPLY",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "Your reply is posted in a relationship chat on Capital Q, marked as sent by Q.",
        variables: {
          principalName: input.principalName,
          counterpartName: input.counterpartName,
          brief: input.brief,
          callComing: input.callComing,
          thread: input.thread,
        },
      });
      try {
        const response = await dependencies.gateway.execute<ErrandReplyResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: REPLY_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: input.actor.tenantId,
              userId: input.actor.userId,
              correlationId: `cor_${randomUUID()}`,
            },
          },
          { schema: ErrandReplyResultSchema },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = ErrandReplyResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return parsed.success ? parsed.data : null;
      } catch (error: unknown) {
        dependencies.logger?.warn({ err: error }, "errand reply not written");
        return null;
      }
    },
  };
}

function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(at);
}

export type ErrandPatch = {
  readonly status?: "DONE" | "STOPPED" | "FAILED" | "EXPIRED";
  readonly stage?: ErrandRow["stage"];
  readonly lastStep?: string;
  readonly failure?: string;
  readonly seenUntil?: Date;
  readonly repliesSent?: number;
  readonly meetingId?: string;
};

export type ErrandListRow = {
  readonly id: string;
  readonly counterpart_name: string;
  readonly status: string;
  readonly last_step: string | null;
  readonly failure: string | null;
  readonly created_at: Date;
};

/** Everything the runner keeps, behind one port. */
export type ErrandStore = {
  readonly due: (limit: number) => Promise<readonly ErrandRow[]>;
  readonly authUserOf: (userId: string) => Promise<string | null>;
  /** Only an ACTIVE errand changes; a stopped one stays stopped. */
  readonly update: (id: string, patch: ErrandPatch) => Promise<void>;
  readonly meetingOf: (id: string) => Promise<string | null>;
  readonly notify: (notice: {
    readonly row: ErrandRow;
    readonly step: string;
    readonly title: string;
    readonly body: string | null;
    readonly link: string | null;
  }) => Promise<void>;
  readonly list: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<readonly ErrandListRow[]>;
  readonly stop: (actor: ActorContext, errandId: string) => Promise<boolean>;
};

export function createPostgresErrandStore(sql: DatabaseExecutor): ErrandStore {
  return {
    due: async (limit) =>
      sql<ErrandRow[]>`
        select id, tenant_id, user_id, organisation_id, q_action_id,
               relationship_id, counterpart_name, plan, stage, seen_until,
               replies_sent, meeting_id, expires_at
          from q_runtime.errands
         where status = 'ACTIVE' and relationship_id is not null
         order by updated_at
         limit ${limit}`,
    authUserOf: async (userId) => {
      const rows = await sql<{ auth_user_id: string | null }[]>`
        select auth_user_id from identity.user_profiles where id = ${userId}`;
      return rows[0]?.auth_user_id ?? null;
    },
    update: async (id, patch) => {
      await sql`
        update q_runtime.errands
           set status = coalesce(${patch.status ?? null}, status),
               stage = coalesce(${patch.stage ?? null}, stage),
               last_step = coalesce(${patch.lastStep?.slice(0, 300) ?? null}, last_step),
               failure = coalesce(${patch.failure?.slice(0, 200) ?? null}, failure),
               seen_until = coalesce(${patch.seenUntil ?? null}, seen_until),
               replies_sent = coalesce(${patch.repliesSent ?? null}, replies_sent),
               meeting_id = coalesce(${patch.meetingId ?? null}, meeting_id),
               updated_at = clock_timestamp()
         where id = ${id} and status = 'ACTIVE'`;
    },
    meetingOf: async (id) => {
      const rows = await sql<{ meeting_id: string | null }[]>`
        select meeting_id from q_runtime.errands where id = ${id}`;
      return rows[0]?.meeting_id ?? null;
    },
    notify: async ({ row, step, title, body, link }) => {
      await sql`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
        values (${row.tenant_id}, ${row.user_id}, 'Q_ERRAND', ${title.slice(0, 200)},
                ${body === null ? null : body.slice(0, 1000)}, ${link}, null, null,
                ${`errand:${row.id}:${step}`.slice(0, 200)})
        on conflict (user_id, dedupe_key) do nothing`;
    },
    list: async (actor, relationshipId) =>
      sql<ErrandListRow[]>`
        select id, counterpart_name, status, last_step, failure, created_at
          from q_runtime.errands
         where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
           and relationship_id = ${relationshipId}
         order by created_at desc
         limit 5`,
    stop: async (actor, errandId) => {
      const rows = await sql<{ id: string }[]>`
        update q_runtime.errands
           set status = 'STOPPED', last_step = 'You stopped this.',
               updated_at = clock_timestamp()
         where id = ${errandId} and user_id = ${actor.userId}
           and tenant_id = ${actor.tenantId} and status = 'ACTIVE'
        returning id`;
      return rows.length > 0;
    },
  };
}

export function createErrandRunner(dependencies: {
  readonly store: ErrandStore;
  readonly resolver: ActorContextResolver;
  readonly chat: {
    readonly readForQ: ChatService["readForQ"];
    readonly send: (
      input: Parameters<ChatService["send"]>[0],
    ) => Promise<unknown>;
  };
  readonly schedule: Pick<ScheduleService, "findSlots" | "schedule">;
  readonly relationships: Pick<RelationshipIntelligencePort, "byRelationship">;
  readonly composer: ErrandReplyComposer;
  readonly nameOf: (userId: string) => Promise<string | null>;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { store, chat, schedule, composer, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  async function actorFor(row: ErrandRow): Promise<ActorContext | null> {
    const authUserId = AuthUserIdSchema.safeParse(
      await store.authUserOf(row.user_id),
    );
    if (!authUserId.success) return null;
    const organisationId =
      row.organisation_id === null
        ? undefined
        : OrganisationIdSchema.parse(row.organisation_id);
    const resolution = await resolveHumanActorContext(dependencies.resolver, {
      principal: { authUserId: authUserId.data },
      selection: organisationId === undefined ? {} : { organisationId },
    });
    return resolution.status === "RESOLVED" &&
      resolution.context.userId === row.user_id
      ? resolution.context
      : null;
  }

  async function linkFor(
    actor: ActorContext,
    relationshipId: string,
  ): Promise<string | null> {
    const found = await dependencies.relationships
      .byRelationship(actor, relationshipId)
      .catch(() => null);
    if (found === null) return null;
    return found.counterpart.kind === "COMPANY"
      ? `/relationships/company/${found.counterpart.id}`
      : `/relationships/investor/${found.counterpart.id}`;
  }

  async function tell(
    row: ErrandRow,
    link: string | null,
    step: string,
    title: string,
    body: string | null,
  ): Promise<void> {
    await store.notify({ row, step, title, body, link });
  }

  const update = (id: string, patch: ErrandPatch): Promise<void> =>
    store.update(id, patch);

  async function post(
    actor: ActorContext,
    row: ErrandRow,
    step: string,
    body: string,
  ): Promise<boolean> {
    const parsed = ChatMessageBodySchema.safeParse(body);
    if (!parsed.success) return false;
    await chat.send({
      actor,
      relationshipId: row.relationship_id,
      request: { kind: "TEXT", body: parsed.data },
      // Marks the message as Q's (viaQ) under the approved errand.
      qActionId: row.q_action_id,
      idempotencyKey: `errand:${row.id}:${step}`,
    });
    return true;
  }

  async function bookCall(
    actor: ActorContext,
    row: ErrandRow,
    plan: ErrandStartPayload,
    link: string | null,
  ): Promise<void> {
    const call = plan.bookCall;
    if (call === null || row.meeting_id !== null) return;
    const current = now();
    const found = await schedule.findSlots({
      actor,
      relationshipId: row.relationship_id,
      from: new Date(current.getTime() + CALL_LEAD_MS),
      durationMinutes: call.durationMinutes,
    });
    if (found.outcome !== "OK") {
      const code = found.outcome === "REFUSED" ? found.code : "UNAVAILABLE";
      await tell(
        row,
        link,
        `call-blocked:${code}`,
        `Q couldn't book the call with ${row.counterpart_name}`,
        code === "CALENDAR_NOT_CONNECTED"
          ? "Connect Google Calendar in Settings and Q will book it."
          : "Q will try again shortly.",
      );
      await update(row.id, { lastStep: "Waiting to book the call." });
      return;
    }
    const slot = found.slots[0];
    if (slot === undefined) {
      await update(row.id, {
        lastStep: "No free time found for the call yet.",
      });
      return;
    }
    const booked = await schedule.schedule({
      actor,
      relationshipId: row.relationship_id,
      purpose: call.purpose,
      startsAt: slot.start,
      durationMinutes: call.durationMinutes,
      timeZone: found.timeZone,
      idempotencyKey: `errand:${row.id}:call`,
      qActionId: row.q_action_id,
      correlationId: `cor_${randomUUID()}`,
    });
    if (booked.outcome !== "OK") {
      await update(row.id, { lastStep: "The call could not be booked yet." });
      return;
    }
    const when = localTime(slot.start, found.timeZone);
    await post(
      actor,
      row,
      "call-note",
      `I've sent a calendar invite for ${when} with a Google Meet link. If that time doesn't work, say so here and it can move.`,
    ).catch(() => false);
    await update(row.id, {
      stage: "CALL_BOOKED",
      meetingId: booked.meeting.id,
      lastStep: `Call booked for ${when}.`,
    });
    await tell(
      row,
      link,
      "call",
      `Call with ${row.counterpart_name} booked: ${when}`,
      booked.meeting.meetLink === null
        ? "The invite is in your calendar."
        : `Meet link: ${booked.meeting.meetLink}`,
    );
  }

  async function advance(row: ErrandRow): Promise<void> {
    const plan = ErrandStartPayloadSchema.safeParse(row.plan);
    if (!plan.success) {
      await update(row.id, { status: "FAILED", failure: "Plan unreadable." });
      return;
    }
    const actor = await actorFor(row);
    if (actor === null) {
      await update(row.id, {
        status: "STOPPED",
        failure: "Your access changed, so Q stopped.",
      });
      return;
    }
    const link = await linkFor(actor, row.relationship_id);
    if (now() > row.expires_at) {
      await update(row.id, {
        status: row.stage === "WAITING_CONNECTION" ? "EXPIRED" : "DONE",
        stage: "FINISHED",
        lastStep: "Two weeks passed; Q handed this back to you.",
      });
      await tell(
        row,
        link,
        "expired",
        `Q finished looking after ${row.counterpart_name}`,
        null,
      );
      return;
    }
    const read = await chat
      .readForQ({ actor, relationshipId: row.relationship_id, limit: 40 })
      .catch(() => null);
    if (read === null) {
      await update(row.id, {
        status: "STOPPED",
        failure: "Q can no longer reach this relationship.",
      });
      return;
    }
    if (read.blocked) {
      await update(row.id, {
        status: "STOPPED",
        failure: "Messaging is blocked on this relationship.",
      });
      return;
    }
    if (!read.connected) {
      await update(row.id, {});
      return;
    }

    let current = row;
    if (row.stage === "WAITING_CONNECTION") {
      if (plan.data.openingMessage !== null) {
        await post(actor, row, "open", plan.data.openingMessage);
      }
      const opened = now();
      await update(row.id, {
        stage: "CONVERSING",
        seenUntil: opened,
        lastStep:
          plan.data.openingMessage === null
            ? "They're connected."
            : "They're connected; Q sent your opening message.",
      });
      await tell(
        row,
        link,
        "connected",
        `${row.counterpart_name} is connected`,
        plan.data.openingMessage === null
          ? null
          : "Q sent your opening message.",
      );
      current = { ...row, stage: "CONVERSING", seen_until: opened };
    }

    await bookCall(actor, current, plan.data, link);

    // Their new words since Q last read.
    const since = current.seen_until?.getTime() ?? 0;
    const fresh = read.messages.filter(
      (message) =>
        message.from === "OTHER_SIDE" && Date.parse(message.sentAt) > since,
    );
    if (fresh.length > 0) {
      const newest = new Date(
        Math.max(...fresh.map((message) => Date.parse(message.sentAt))),
      );
      const brief = plan.data.brief;
      if (brief !== null && current.replies_sent < MAX_REPLIES) {
        const principalName =
          (await dependencies.nameOf(row.user_id)) ?? "the person";
        const thread = read.messages
          .slice(-20)
          .map(
            (message) =>
              `${message.from === "OTHER_SIDE" ? message.senderName : `${message.senderName} (${principalName}'s side)`}: ${message.text ?? `[${message.attachmentTitle ?? message.kind}]`}`,
          )
          .join("\n");
        const answer = await composer.compose({
          actor,
          principalName,
          counterpartName: row.counterpart_name,
          brief,
          callComing:
            plan.data.bookCall !== null && current.meeting_id === null,
          thread,
        });
        if (answer?.reply != null) {
          await post(
            actor,
            row,
            `reply:${newest.toISOString()}`,
            answer.reply,
          ).catch(() => false);
        }
        await update(row.id, {
          seenUntil: newest,
          repliesSent: current.replies_sent + (answer?.reply == null ? 0 : 1),
          lastStep:
            answer?.reply == null
              ? `${row.counterpart_name} wrote.`
              : `Q answered ${row.counterpart_name}.`,
        });
        if (answer !== null && answer.forPerson.length > 0) {
          await tell(
            row,
            link,
            `ask:${newest.toISOString()}`,
            `${row.counterpart_name} asked something only you can answer`,
            answer.forPerson.join("\n"),
          );
        }
      } else {
        await update(row.id, {
          seenUntil: newest,
          lastStep: `${row.counterpart_name} wrote.`,
        });
        await tell(
          row,
          link,
          `wrote:${newest.toISOString()}`,
          `${row.counterpart_name} wrote to you`,
          fresh.at(-1)?.text ?? null,
        );
      }
    }

    // Nothing left for Q: no brief to answer from, and any call is booked.
    if (
      plan.data.brief === null &&
      (plan.data.bookCall === null || (await store.meetingOf(row.id)) !== null)
    ) {
      await update(row.id, { status: "DONE", stage: "FINISHED" });
    }
  }

  return {
    tick: async (limit = 20): Promise<number> => {
      const rows = await store.due(limit);
      for (const row of rows) {
        try {
          await advance(row);
        } catch (error: unknown) {
          logger?.warn({ err: error, errandId: row.id }, "errand step failed");
        }
      }
      return rows.length;
    },
    /** The person's own errands on one relationship, newest first. */
    list: store.list,
    /** The person stops their own errand; nothing further runs. */
    stop: store.stop,
  };
}

export type ErrandRunner = ReturnType<typeof createErrandRunner>;
