import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ChatMessageBodySchema,
  QActionTypeSchema,
  UtcTimestampSchema,
  UuidSchema,
  type ModelDataPosture,
  type QSubjectRef,
} from "@capital-q/contracts";
import type {
  ChatService,
  CounterpartNotices,
  ScheduleService,
} from "@capital-q/communication";
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
  type WorkSlotReaderResult,
  type ErrandReplyVariables,
} from "@capital-q/q-core";
import {
  ERRAND_START as ERRAND_START_NAME,
  type RelationshipIntelligencePort,
} from "@capital-q/q-tools";
import {
  insideWindows,
  DEFAULT_WORKING_HOURS,
  isKnownZone,
  slotLabel,
  workingHourSlots,
} from "./slots.js";
import {
  TELL_OWNER_AFTER_DAYS,
  waitingDecision,
  type CounterpartNudger,
} from "./waiting.js";
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
        /** The window they asked for, as instants (live 2026-10-02). */
        notBefore: UtcTimestampSchema.optional(),
        notAfter: UtcTimestampSchema.optional(),
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
                    ${sql.json(JSON.parse(JSON.stringify(action.payload)) as Parameters<typeof sql.json>[0])},
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

/**
 * The first moment a call may be booked: never sooner than the lead time,
 * and never before the start of the window they asked for.
 */
export function earliestCall(
  current: Date,
  call: { readonly notBefore?: string | undefined },
): Date {
  const lead = current.getTime() + CALL_LEAD_MS;
  const asked =
    call.notBefore === undefined ? lead : new Date(call.notBefore).getTime();
  return new Date(Math.max(lead, asked));
}

/**
 * Where an errand stands, in one plain sentence from its own record (live
 * 2026-10-02, Zino: "have you booked?" got "Q looks after Nixo for you is
 * saved"). Never the card's title as a status.
 */
export function errandProgress(errand: {
  readonly counterpart_name: string;
  readonly status: string;
  readonly stage: string;
  readonly last_step: string | null;
}): string {
  const name = errand.counterpart_name;
  const last =
    errand.last_step === null || errand.last_step.trim().length === 0
      ? ""
      : ` Latest: ${errand.last_step.trim().replace(/[.\s]+$/u, "")}.`;
  if (errand.status !== "ACTIVE") {
    switch (errand.status) {
      case "DONE":
        return `Q has finished looking after ${name}.${last}`;
      case "STOPPED":
        return `Q stopped looking after ${name}.${last}`;
      case "EXPIRED":
        return `Q's errand with ${name} lapsed before they answered.${last}`;
      default:
        return `Q's errand with ${name} didn't go through.${last}`;
    }
  }
  switch (errand.stage) {
    case "WAITING_CONNECTION":
      return `Q is looking after ${name} for you: waiting for them to accept, so nothing is booked yet.${last}`;
    case "CONVERSING":
      return `Q is looking after ${name} for you: messaging them to agree a time; nothing is booked yet.${last}`;
    case "CALL_BOOKED":
      return `Q is looking after ${name} for you: the call is booked.${last}`;
    default:
      return `Q is looking after ${name} for you.${last}`;
  }
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
  /** When the errand was filed: how long Q has been waiting. */
  created_at?: Date | undefined;
  /** Times Q offered in the chat (no calendar), as ISO instants. */
  proposed_slots?: unknown;
};

export type ErrandNegotiation = {
  /** The owner's own time zone (calendar, else profile); null: unknown. */
  readonly zoneOf: (userId: string) => Promise<string | null>;
  readonly readSlots: (input: {
    readonly actor: ActorContext;
    readonly principalName: string;
    readonly counterpartName: string;
    readonly offered: string;
    readonly timeZone: string;
    readonly now: string;
    readonly reply: string;
  }) => Promise<WorkSlotReaderResult | null>;
  readonly recordAgreed: ScheduleService["recordAgreed"];
  /** Email the .ics to the organiser and every invitee; throws on failure. */
  readonly sendInvites: (input: {
    readonly meetingId: string;
    readonly start: Date;
    readonly end: Date;
    readonly purpose: string;
    readonly timeZone: string;
    readonly organiser: { readonly name: string; readonly email: string };
    readonly invitees: readonly {
      readonly name: string;
      readonly email: string;
    }[];
  }) => Promise<void>;
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
              purpose: "DELEGATED_WORK",
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
  /** The times Q offered in the chat, ISO instants (no calendar). */
  readonly proposedSlots?: readonly string[];
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
  /** AUTO: the active errands on one relationship, to wake at once. */
  readonly dueFor?:
    ((relationshipId: string) => Promise<readonly ErrandRow[]>) | undefined;
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
  /** The person's own ACTIVE errand for a relationship or company, if any. */
  readonly activeFor?:
    | ((
        actor: ActorContext,
        ref: {
          readonly relationshipId: string | null;
          readonly companyId: string | null;
        },
      ) => Promise<{
        readonly counterpartName: string;
        readonly stage: string;
        readonly lastStep: string | null;
      } | null>)
    | undefined;
  /** AUTO: the person's own errands on every relationship, newest first. */
  readonly own?:
    ((actor: ActorContext) => Promise<readonly ErrandListRow[]>) | undefined;
};

export function createPostgresErrandStore(sql: DatabaseExecutor): ErrandStore {
  return {
    due: async (limit) =>
      sql<ErrandRow[]>`
        select id, tenant_id, user_id, organisation_id, q_action_id,
               relationship_id, counterpart_name, plan, stage, seen_until,
               replies_sent, meeting_id, expires_at, created_at, proposed_slots
          from q_runtime.errands
         where status = 'ACTIVE' and relationship_id is not null
         order by updated_at
         limit ${limit}`,
    dueFor: async (relationshipId) =>
      sql<ErrandRow[]>`
        select id, tenant_id, user_id, organisation_id, q_action_id,
               relationship_id, counterpart_name, plan, stage, seen_until,
               replies_sent, meeting_id, expires_at, created_at, proposed_slots
          from q_runtime.errands
         where status = 'ACTIVE' and relationship_id = ${relationshipId}
         limit 20`,
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
               proposed_slots = coalesce(proposed_slots, ${patch.proposedSlots === undefined ? null : sql.json([...patch.proposedSlots])}),
               proposed_at = case when ${patch.proposedSlots !== undefined} and proposed_at is null
                                  then clock_timestamp() else proposed_at end,
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
    activeFor: async (actor, ref) => {
      const rows = await sql<
        { counterpart_name: string; stage: string; last_step: string | null }[]
      >`
        select counterpart_name, stage, last_step
          from q_runtime.errands
         where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
           and status = 'ACTIVE'
           and ((${ref.relationshipId}::uuid is not null and relationship_id = ${ref.relationshipId}::uuid)
             or (${ref.companyId}::uuid is not null and company_id = ${ref.companyId}::uuid))
         order by created_at desc
         limit 1`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            counterpartName: row.counterpart_name,
            stage: row.stage,
            lastStep: row.last_step,
          };
    },
    own: async (actor) =>
      sql<ErrandListRow[]>`
        select id, counterpart_name, status, last_step, failure, created_at
          from q_runtime.errands
         where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
         order by (status = 'ACTIVE') desc, created_at desc
         limit 10`,
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
  /** One gentle reminder to the other side when they stay silent. */
  readonly nudger?: Pick<CounterpartNudger, "nudge"> | undefined;
  /**
   * Booking without Google (2026-10-02): Q offers times in the chat, reads
   * the reply by meaning, records the agreed meeting and emails an invite.
   * Absent: an owner without Google is asked to connect it, as before.
   */
  readonly negotiation?: ErrandNegotiation | undefined;
  /** Notices for the other side (Q's first message, a proposed time). */
  readonly counterpartNotices?: Pick<CounterpartNotices, "notify"> | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { store, chat, schedule, composer, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  // One step at a time: the minute's tick and an acceptance waking the
  // errand never advance it concurrently (a second wake finds it moved on).
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

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
      // Marks the message as Q's (viaQ) under the approved errand. Not the
      // action id: one message per action id is all the chat allows, and
      // an errand posts several (ADR 0030 fixed this).
      qDelegationId: row.id,
      idempotencyKey: `errand:${row.id}:${step}`,
    });
    // The other side hears that Q wrote to them, and for whom: once.
    if (dependencies.counterpartNotices !== undefined) {
      const principal = (await dependencies.nameOf(row.user_id)) ?? "Someone";
      await dependencies.counterpartNotices
        .notify({
          relationshipId: row.relationship_id,
          actingSide: sideOf(row),
          kind: "Q_MESSAGE",
          title: `Q, on behalf of ${principal}, sent you a message`.slice(
            0,
            200,
          ),
          body: parsed.data.slice(0, 200),
          target: "CHAT",
          key: `errand:${row.id}`,
          priority: "UPDATE",
        })
        .catch(() => 0);
    }
    return true;
  }

  /** Which side the errand's owner acts for, from its own plan. */
  const sides = new Map<string, "INVESTOR" | "COMPANY">();
  function sideOf(row: ErrandRow): "INVESTOR" | "COMPANY" {
    return sides.get(row.id) ?? "INVESTOR";
  }

  function offeredOf(row: ErrandRow): Date[] {
    return Array.isArray(row.proposed_slots)
      ? (row.proposed_slots as unknown[])
          .filter((value): value is string => typeof value === "string")
          .map((value) => new Date(value))
          .filter((at) => !Number.isNaN(at.getTime()))
      : [];
  }

  /**
   * No Google calendar: offer 2-3 times from the owner's working hours in
   * their own zone, in the chat, once. The reply is read when it comes.
   */
  async function offerTimes(
    actor: ActorContext,
    row: ErrandRow,
    call: NonNullable<ErrandStartPayload["bookCall"]>,
    link: string | null,
    negotiation: ErrandNegotiation,
  ): Promise<void> {
    if (offeredOf(row).length > 0) {
      await update(row.id, {
        lastStep: `Waiting for ${row.counterpart_name} to pick one of the times Q offered.`,
      });
      return;
    }
    const zone = (await negotiation.zoneOf(row.user_id)) ?? "UTC";
    const current = now();
    const slots = workingHourSlots({
      from: earliestCall(current, call),
      until: new Date(current.getTime() + 14 * 24 * 3_600_000),
      timeZone: zone,
      durationMinutes: call.durationMinutes,
      count: 3,
    });
    if (slots.length === 0) {
      await update(row.id, { lastStep: "No time to offer yet." });
      return;
    }
    const principal = (await dependencies.nameOf(row.user_id)) ?? "They";
    const lines = slots.map(
      (slot, index) => `${String(index + 1)}. ${slotLabel(slot, zone)}`,
    );
    const posted = await post(
      actor,
      row,
      "slots",
      `${principal} would like a ${String(call.durationMinutes)}-minute call (${call.purpose}). Would one of these suit you?\n${lines.join("\n")}\nReply with the one that works, or suggest another time.`,
    ).catch(() => false);
    if (!posted) {
      await update(row.id, {
        lastStep: "Waiting to offer times for the call.",
      });
      return;
    }
    await update(row.id, {
      proposedSlots: slots.map((slot) => slot.toISOString()),
      lastStep: `Q offered ${String(slots.length)} times; waiting for ${row.counterpart_name} to pick one.`,
    });
    await tell(
      row,
      link,
      "slots-offered",
      `Q offered ${row.counterpart_name} times for your call`,
      `${lines.join("\n")}\nNo Google calendar is connected, so Q is arranging it in the chat.`,
    );
    await dependencies.counterpartNotices
      ?.notify({
        relationshipId: row.relationship_id,
        actingSide: sideOf(row),
        kind: "TIME_PROPOSED",
        title: `Q, on behalf of ${principal}, proposed times for a call`.slice(
          0,
          200,
        ),
        body: lines.join("\n"),
        target: "CHAT",
        key: `errand:${row.id}:slots`,
        priority: "NEEDS_YOU",
      })
      .catch(() => 0);
  }

  /**
   * Their reply to the offer, read by meaning. True when it settled a time
   * (booked), so the brief's reply is not also sent.
   */
  async function settleTime(
    actor: ActorContext,
    row: ErrandRow,
    plan: ErrandStartPayload,
    link: string | null,
    reply: string,
    negotiation: ErrandNegotiation,
  ): Promise<boolean> {
    const call = plan.bookCall;
    const offered = offeredOf(row);
    if (call === null || offered.length === 0 || row.meeting_id !== null) {
      return false;
    }
    const zone = (await negotiation.zoneOf(row.user_id)) ?? "UTC";
    const principal = (await dependencies.nameOf(row.user_id)) ?? "the person";
    const read = await negotiation.readSlots({
      actor,
      principalName: principal,
      counterpartName: row.counterpart_name,
      offered: offered
        .map(
          (slot, index) =>
            `${String(index + 1)}. ${slotLabel(slot, zone)} (${slot.toISOString()})`,
        )
        .join("\n"),
      timeZone: zone,
      now: now().toISOString(),
      reply,
    });
    if (read === null || read.answer === "NONE") return false;
    if (read.answer === "DECLINED") {
      await update(row.id, {
        lastStep: `${row.counterpart_name} doesn't want a call for now.`,
      });
      await tell(
        row,
        link,
        "call-declined",
        `${row.counterpart_name} doesn't want a call for now`,
        read.quote,
      );
      return false;
    }
    let at: Date | null = null;
    if (read.answer === "PICKED" && read.pick !== null) {
      at = offered[read.pick - 1] ?? null;
    } else if (read.answer === "OTHER_TIME" && read.otherTime !== null) {
      const named = new Date(read.otherTime);
      // Their own time is taken when it is ahead, and inside the owner's
      // working hours (the availability the plan allows); otherwise the
      // owner decides.
      if (
        !Number.isNaN(named.getTime()) &&
        named.getTime() > now().getTime() + 2 * 3_600_000 &&
        insideWindows(named, call.durationMinutes, DEFAULT_WORKING_HOURS, zone)
      ) {
        at = named;
      } else if (!Number.isNaN(named.getTime())) {
        await update(row.id, {
          lastStep: `${row.counterpart_name} suggested ${slotLabel(named, zone)}; waiting for you to agree.`,
        });
        await tell(
          row,
          link,
          `call-suggested:${named.toISOString()}`,
          `${row.counterpart_name} suggested ${slotLabel(named, zone)} for the call`,
          "That's outside your usual hours, so Q didn't accept it. Reply in the chat if it works.",
        );
        return false;
      }
    }
    if (at === null) return false;
    const recorded = await negotiation.recordAgreed({
      actor,
      relationshipId: row.relationship_id,
      purpose: call.purpose,
      startsAt: at,
      durationMinutes: call.durationMinutes,
      timeZone: isKnownZone(zone) ? zone : "UTC",
      idempotencyKey: `errand:${row.id}:agreed:${at.toISOString()}`,
      qActionId: row.q_action_id,
      correlationId: `cor_${randomUUID()}`,
    });
    if (recorded.outcome !== "OK") {
      await update(row.id, {
        lastStep: "The agreed time could not be recorded yet.",
      });
      return false;
    }
    const when = slotLabel(at, zone);
    let invited = true;
    if (!recorded.alreadyScheduled) {
      await negotiation
        .sendInvites({
          meetingId: recorded.meeting.id,
          start: at,
          end: new Date(at.getTime() + call.durationMinutes * 60_000),
          purpose: call.purpose,
          timeZone: zone,
          organiser: recorded.organiser,
          invitees: recorded.invitees,
        })
        .catch(() => {
          invited = false;
        });
    }
    await post(
      actor,
      row,
      `agreed:${at.toISOString()}`,
      `Booked for ${when}. ${invited ? "A calendar invite is in your email. " : ""}A video link will follow.`,
    ).catch(() => false);
    await update(row.id, {
      stage: "CALL_BOOKED",
      meetingId: recorded.meeting.id,
      lastStep: `Call agreed for ${when}; waiting for a video link.`,
    });
    await tell(
      row,
      link,
      "call",
      `Call with ${row.counterpart_name} agreed: ${when}`,
      "Add a video link: connect Google Calendar in Settings so Q can add a Meet link, or paste a link in the chat.",
    );
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
      from: earliestCall(current, call),
      durationMinutes: call.durationMinutes,
    });
    if (
      found.outcome === "REFUSED" &&
      found.code === "CALENDAR_NOT_CONNECTED" &&
      dependencies.negotiation !== undefined
    ) {
      await offerTimes(actor, row, call, link, dependencies.negotiation);
      return;
    }
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

  /**
   * Not connected yet (founder direction 2026-10-01): a declined interest
   * or request ends the errand; otherwise Q says what it waits for, and if
   * the other side stays silent, reminds them once after a few days and
   * then tells the person plainly. Acceptance wakes the errand at once.
   */
  async function waiting(
    actor: ActorContext,
    row: ErrandRow,
    link: string | null,
  ): Promise<void> {
    const found = await dependencies.relationships
      .byRelationship(actor, row.relationship_id)
      .catch(() => null);
    if (found?.status?.state === "DECLINED") {
      await update(row.id, {
        status: "STOPPED",
        stage: "FINISHED",
        lastStep: `${row.counterpart_name} declined, so Q stopped.`,
      });
      await tell(
        row,
        link,
        "declined",
        `${row.counterpart_name} declined`,
        "Q won't contact them for this.",
      );
      return;
    }
    const waitingFor = `Waiting for ${row.counterpart_name} to accept${found?.side === "COMPANY" ? " your request to connect" : " your interest"}.`;
    const decision =
      row.created_at === undefined
        ? "WAIT"
        : waitingDecision(row.created_at, now());
    if (
      decision !== "WAIT" &&
      found !== null &&
      dependencies.nudger !== undefined
    ) {
      const reminded = await dependencies.nudger
        .nudge({
          relationshipId: row.relationship_id,
          waitingSide: found.side,
          waitingName: (await dependencies.nameOf(row.user_id)) ?? "Someone",
          key: `errand:${row.id}`,
        })
        .catch(() => 0);
      if (reminded > 0) {
        await update(row.id, {
          lastStep: `Q reminded ${row.counterpart_name} gently. ${waitingFor}`,
        });
        return;
      }
    }
    if (decision === "TELL_OWNER") {
      await tell(
        row,
        link,
        "waiting-long",
        `${row.counterpart_name} hasn't accepted yet`,
        `It's been ${String(TELL_OWNER_AFTER_DAYS)} days and Q reminded them once. Q keeps waiting and will carry on the moment they accept; you can stop this any time.`,
      );
    }
    await update(row.id, { lastStep: waitingFor });
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
    const party = await dependencies.relationships
      .byRelationship(actor, row.relationship_id)
      .catch(() => null);
    if (party !== null) sides.set(row.id, party.side);
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
      await waiting(actor, row, link);
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
      if (
        dependencies.negotiation !== undefined &&
        (await settleTime(
          actor,
          current,
          plan.data,
          link,
          fresh
            .map((message) => message.text ?? "")
            .join("\n")
            .slice(0, 6_000),
          dependencies.negotiation,
        ))
      ) {
        await update(row.id, { seenUntil: newest });
        return;
      }
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
    tick: (limit = 20): Promise<number> =>
      serial(async () => {
        const rows = await store.due(limit);
        for (const row of rows) {
          try {
            await advance(row);
          } catch (error: unknown) {
            logger?.warn(
              { err: error, errandId: row.id },
              "errand step failed",
            );
          }
        }
        return rows.length;
      }),
    /**
     * The relationship moved (accepted, declined): its errands continue
     * now, not at the next tick. Idempotent -- each step is keyed, and an
     * errand that already moved on does nothing again.
     */
    wake: (relationshipId: string): Promise<number> =>
      serial(async () => {
        const rows = (await store.dueFor?.(relationshipId)) ?? [];
        for (const row of rows) {
          try {
            await advance(row);
          } catch (error: unknown) {
            logger?.warn(
              { err: error, errandId: row.id },
              "errand wake failed",
            );
          }
        }
        return rows.length;
      }),
    /** The person's own errands on one relationship, newest first. */
    list: store.list,
    /** The person stops their own errand; nothing further runs. */
    stop: store.stop,
    /** The person's own errands everywhere, as their work list shows them. */
    own: async (actor: ActorContext) => (await store.own?.(actor)) ?? [],
  };
}

export type ErrandRunner = ReturnType<typeof createErrandRunner>;
