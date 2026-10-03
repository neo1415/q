import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createScheduleService } from "@capital-q/communication";
import {
  createFakeAppEmail,
  createFakeCalendar,
  createInMemoryScheduleStore,
  createRecordingMeetingActivity,
  createStaticMeetingDirectory,
  inlineScheduleTransactions,
} from "@capital-q/communication/testing";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  handleEverythingGrant,
  CorrelationIdSchema,
  isTerminalQRunStatus,
  QActionProposalIdSchema,
  QApprovalIdSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createPostgresQActionRepositories,
  createQActionPort,
  createQActionRegistry,
  createQActionService,
  type AnyQActionDefinition,
  type QActionService,
} from "@capital-q/q-actions";
import { Q_ACTION_EVENTS } from "@capital-q/q-actions/events";
import {
  createPostgresQRuntimeRepositories,
  createQOrchestrationRuntime,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  QRunAlreadyTerminalError,
  runRef,
  type QOrchestrator,
} from "@capital-q/q-runtime";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
import {
  createPostgresAuthorizationPolicySource,
  createPostgresPersonProfileStore,
} from "@capital-q/security/postgres";

import { createApprovedActionSweep } from "../src/composition/approved-action-sweep.js";
import { createApprovedContinuation } from "../src/composition/approved-continuation.js";
import { createChatMessageSendAction } from "../src/composition/chat-actions.js";
import { plainProposalStatus } from "../src/composition/conversation-approvals.js";
import { createEmailSendAction } from "../src/composition/email-action.js";
import { createInstructionActions } from "../src/composition/instructions/actions.js";
import { createPersonProfileUpdateAction } from "../src/composition/person-profile-action.js";
import { createWorkStartActions } from "../src/composition/work/actions.js";
import {
  createMeetingScheduleAction,
  createReminderCreateAction,
} from "../src/composition/schedule-actions.js";

/**
 * Live test 2026-09-28 #4: "I approve, and it stays approval needed".
 *
 * For every action type Q prepares in conversation, against the real
 * local database (runs, actions, approvals, authorization, audit, outbox)
 * and the real action definitions over fake providers: approve, then the
 * one continuation the card, a spoken yes and a typed yes all use. Once
 * with the run still paused (resume executes it), once with the run ended
 * while the card waited (it used to stay APPROVED forever; now the same
 * execution gate runs it). Either way the person reads SAVED.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CORRELATION = (): CorrelationId =>
  CorrelationIdSchema.parse(`cor_${randomUUID()}`);
const RELATIONSHIP = randomUUID();

type World = {
  readonly tenantId: string;
  readonly authUserId: string;
  readonly actor: ActorContext;
  readonly service: QActionService;
  readonly continueApproved: ReturnType<typeof createApprovedContinuation>;
  readonly orchestration: ReturnType<typeof createQOrchestrationRuntime>;
  readonly runtime: ReturnType<typeof createQRuntimeService>;
  readonly sent: string[];
  readonly port: ReturnType<typeof createQActionPort>;
};

describe("approve → continue → execute, per action type (local PostgreSQL)", () => {
  let db: RequestDatabase;
  let world: World;

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    const tenantId = randomUUID();
    const organisationId = randomUUID();
    const authUserId = randomUUID();
    const actor = await db.transactions.run(async (tx) => {
      await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Continuation Tenant')`;
      await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${organisationId}, ${tenantId}, 'company', 'Continuation Co', ${`qc-${organisationId.slice(0, 8)}`})`;
      await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
      await tx.sql`insert into auth.users (id) values (${authUserId})`;
      const [profile] = await tx.sql<{ id: string }[]>`
        select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      if (profile === undefined) throw new Error("profile trigger did not run");
      const membershipId = randomUUID();
      await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
        values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
      await tx.sql`insert into identity.membership_roles (membership_id, role_id)
        select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
      return ActorContextSchema.parse({
        userId: profile.id,
        tenantId,
        organisationId,
        membershipId,
        actorType: "HUMAN",
      });
    });

    // Providers are fakes; everything between them and the person is real.
    const schedule = createScheduleService({
      store: createInMemoryScheduleStore(),
      transactions: inlineScheduleTransactions,
      parties: (who, relationshipId) =>
        Promise.resolve(
          relationshipId === RELATIONSHIP && who.userId === actor.userId
            ? { side: "INVESTOR" as const, connected: true }
            : null,
        ),
      directory: createStaticMeetingDirectory({
        relationshipTenant: tenantId,
        people: {
          COMPANY: [
            {
              userId: randomUUID(),
              tenantId: randomUUID(),
              name: "Ada",
              email: "ada@co.example.invalid",
            },
          ],
          INVESTOR_ORGANISATION: [],
        },
        persons: {
          [actor.userId]: { name: "Ben", email: "ben@vc.example.invalid" },
        },
      }),
      calendars: (userId) =>
        Promise.resolve(
          userId === actor.userId
            ? createFakeCalendar("ben@vc.example.invalid")
            : null,
        ),
      activity: createRecordingMeetingActivity(),
      email: createFakeAppEmail(),
    });
    const sent: string[] = [];
    const definitions: AnyQActionDefinition[] = [
      createReminderCreateAction({ schedule }),
      createMeetingScheduleAction({ schedule }),
      createChatMessageSendAction({
        chat: {
          readForQ: () =>
            Promise.resolve({ connected: true, blocked: false, messages: [] }),
          send: (input: { idempotencyKey: string }) => {
            sent.push(`chat:${input.idempotencyKey}`);
            return Promise.resolve({
              message: { messageId: randomUUID() },
              deduplicated: false,
            });
          },
        } as never,
      }),
      createEmailSendAction({
        integrations: {
          mailboxOf: () => Promise.resolve({ email: "ben@vc.example.invalid" }),
          sendApprovedEmail: (input: { idempotencyKey: string }) => {
            sent.push(`email:${input.idempotencyKey}`);
            return Promise.resolve({
              outcome: "SENT",
              emailMessageId: randomUUID(),
              alreadySent: false,
            });
          },
        } as never,
        counterparts: {
          of: () =>
            Promise.resolve({
              contacts: [{ email: "ada@co.example.invalid", name: "Ada" }],
            }),
        } as never,
      }),
      createPersonProfileUpdateAction({
        people: createPostgresPersonProfileStore({ sql: db.sql }),
      }),
      // Delegated work and standing instructions: proposing only.
      ...createWorkStartActions({
        store: {} as never,
        isInvestor: () => Promise.resolve(true),
        ownCompany: () => Promise.resolve(randomUUID()),
      }),
      ...createInstructionActions({ store: {} as never }),
    ];
    const repositories = createPostgresQRuntimeRepositories();
    const runtime = createQRuntimeService({
      sql: db.sql,
      transactions: db.transactions,
      subjects: createQSubjectResolverRegistry([]),
      securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
      repositories,
    });
    const service = createQActionService({
      sql: db.sql,
      transactions: db.transactions,
      repositories: createPostgresQActionRepositories(),
      runtime: repositories,
      registry: createQActionRegistry(definitions),
      authorization: createAuthorizationService(
        createPostgresAuthorizationPolicySource({ sql: db.sql }),
      ),
      audit: createPostgresMaterialActionAuditWriter(),
      securityEvents: createPostgresSecurityEventWriter({ sql: db.sql }),
      outbox: createOutboxWriter({
        registry: createEventRegistry(Q_ACTION_EVENTS),
      }),
    });
    const port = createQActionPort({ service });
    const orchestration = createQOrchestrationRuntime({
      sql: db.sql,
      transactions: db.transactions,
      subjects: createQSubjectResolverRegistry([]),
      repositories,
    });
    // The orchestrator's resume contract, over the real lifecycle: a
    // terminal run is refused exactly as the LangGraph orchestrator
    // refuses it; a paused one moves to ACTION_EXECUTION and its approval
    // gate executes through the port, as the graph's node does.
    const orchestrator: QOrchestrator = {
      start: () => Promise.reject(new Error("unused")),
      cancel: () => Promise.reject(new Error("unused")),
      resume: async (input) => {
        const run = await orchestration.loadOwnedRun(
          input.actor,
          input.runId,
          input.correlationId,
        );
        if (isTerminalQRunStatus(run.status)) {
          throw new QRunAlreadyTerminalError(run.status);
        }
        await orchestration.resumeFromApproval(runRef(run));
        const [action] = await db.sql<{ id: string }[]>`
          select id from q_runtime.actions where run_id = ${input.runId}`;
        if (action === undefined) throw new Error("no action on the run");
        await port.executeApproved({
          actor: input.actor,
          runId: input.runId,
          tenantId: input.actor.tenantId,
          correlationId: input.correlationId,
          actionId: QActionProposalIdSchema.parse(action.id),
        });
        return {
          runId: input.runId,
        } as never;
      },
    };
    world = {
      tenantId,
      authUserId,
      actor,
      service,
      runtime,
      orchestration,
      sent,
      port,
      continueApproved: createApprovedContinuation({
        orchestrator: () => orchestrator,
        actions: port,
      }),
    };
  });

  afterAll(async () => {
    const tenants = [world.tenantId];
    await db.transactions.run(async (tx) => {
      await tx.sql`delete from communication.notifications where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from q_runtime.approvals where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from q_runtime.actions where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`alter table q_runtime.run_events disable trigger run_events_append_only`;
      await tx.sql`delete from q_runtime.run_events where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`alter table q_runtime.run_events enable trigger run_events_append_only`;
      await tx.sql`delete from q_runtime.conversation_messages where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from q_runtime.run_creation_requests where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from q_runtime.runs where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from q_runtime.conversations where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from events.outbox where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from audit.material_actions where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from audit.security_events where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from identity.membership_roles where membership_id in (select id from identity.organisation_memberships where tenant_id = any(${tenants}::uuid[]))`;
      await tx.sql`delete from identity.organisation_memberships where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from identity.tenant_organisations where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from identity.organisations where tenant_id = any(${tenants}::uuid[])`;
      await tx.sql`delete from identity.tenants where id = any(${tenants}::uuid[])`;
      await tx.sql`delete from identity.user_profiles where auth_user_id = ${world.authUserId}`;
      await tx.sql`delete from auth.users where id = ${world.authUserId}`;
    });
    await db.close();
  });

  /** A run paused at SYNTHESIS, where Q's proposal makes it wait. */
  async function pausedRun() {
    const created = await world.runtime.createRun({
      actor: world.actor,
      input: {
        capability: "PREPARE_ACTION",
        message: { text: "Prepare it." },
        modality: "TEXT",
      },
      idempotencyKey: `continuation-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    const ref = runRef(created.run);
    await world.orchestration.begin(ref, "q-orchestrator-v5");
    for (const status of [
      "CONTEXT_RESOLUTION",
      "POLICY_CHECK",
      "PLANNING",
      "SYNTHESIS",
    ] as const) {
      await world.orchestration.advance(ref, status);
    }
    return ref;
  }

  const payloads: readonly [string, () => Record<string, unknown>][] = [
    [
      "reminder.create",
      () => ({
        ownerUserId: world.actor.userId,
        title: "Call the bank",
        remindAt: "2030-10-09T08:00:00.000Z",
        timeZone: "Europe/London",
        channel: "EMAIL",
      }),
    ],
    [
      "meeting.schedule",
      () => ({
        relationshipId: RELATIONSHIP,
        counterpartName: "Acme",
        purpose: "Intro call",
        startsAt: "2030-10-06T13:00:00.000Z",
        durationMinutes: 30,
        timeZone: "Europe/London",
      }),
    ],
    [
      "chat.message.send",
      () => ({
        relationshipId: RELATIONSHIP,
        counterpartName: "Acme",
        body: "Thanks for the call.",
      }),
    ],
    [
      "email.send",
      () => ({
        relationshipId: RELATIONSHIP,
        to: "ada@co.example.invalid",
        toName: "Ada",
        counterpartName: "Acme",
        subject: "Following up",
        body: "Thanks for the call.",
      }),
    ],
    [
      "person.profile.update",
      () => ({
        userId: world.actor.userId,
        headline: `Angel investor ${randomUUID().slice(0, 6)}`,
      }),
    ],
  ];

  // QA 2026-10-03: the start cards declared no target, and the engine
  // refuses a card without one -- each must reach the person as a card.
  it.each([
    [
      "q.work.outreach.start",
      () => ({
        ownerUserId: world.actor.userId,
        grant: {
          maxCompanies: 3,
          openingMessage: "Hello from Ben's Q.",
          brief: null,
          topics: [],
          interview: null,
          call: null,
        },
        expiresInDays: 7,
      }),
    ],
    [
      "q.work.standin.start",
      () => ({
        ownerUserId: world.actor.userId,
        grant: { brief: "We are raising a seed round.", awayAfterMinutes: 30 },
        expiresInDays: 7,
      }),
    ],
    [
      "q.instruction.grant",
      () => ({
        ownerUserId: world.actor.userId,
        goal: "Handle all the work for me",
        grant: handleEverythingGrant({ timeZone: "Europe/London" }),
      }),
    ],
  ] as const)(
    "%s is proposed as a card for its owner",
    async (actionType, payload) => {
      const ref = await pausedRun();
      const { approval } = await world.service.propose({
        actor: world.actor,
        runId: ref.runId,
        correlationId: CORRELATION(),
        actionType,
        payload: payload(),
      });
      expect(approval.status).toBe("PENDING");
      // Someone else's work is never proposed on their behalf.
      await expect(
        world.service.propose({
          actor: world.actor,
          runId: (await pausedRun()).runId,
          correlationId: CORRELATION(),
          actionType,
          payload: { ...payload(), ownerUserId: randomUUID() },
        }),
      ).rejects.toThrow();
    },
  );

  async function approveAndContinue(
    actionType: string,
    payload: Record<string, unknown>,
    lostContinuation: boolean,
  ) {
    const ref = await pausedRun();
    const { action, approval } = await world.service.propose({
      actor: world.actor,
      runId: ref.runId,
      correlationId: CORRELATION(),
      actionType,
      payload,
    });
    const correlationId = CORRELATION();
    const decided = await world.service.approve({
      actor: world.actor,
      approvalId: QApprovalIdSchema.parse(approval.id),
      correlationId,
    });
    expect(decided.decided).toBe(true);
    if (lostContinuation) {
      // The resume began and the process went away (a redeploy): the
      // orphan sweep ends the run, and the approved action has nothing
      // left to execute it. The person taps Approve again.
      await world.orchestration.resumeFromApproval(ref);
      await world.orchestration.fail(ref, "INTERNAL_ERROR");
      const again = await world.service.approve({
        actor: world.actor,
        approvalId: QApprovalIdSchema.parse(approval.id),
        correlationId,
      });
      expect(again.decided).toBe(false);
      // What the routes check before continuing a repeated approve.
      expect(again.action.status).toBe("APPROVED");
    }
    await world.continueApproved({
      actor: world.actor,
      runId: action.runId,
      actionId: action.id,
      correlationId,
    });
    const view = await world.service.getApproval({
      actor: world.actor,
      approvalId: QApprovalIdSchema.parse(approval.id),
      correlationId: CORRELATION(),
    });
    return { view, action };
  }

  it.each(payloads)(
    "%s: approved on a paused run executes, and reads SAVED",
    async (actionType, payload) => {
      const { view } = await approveAndContinue(actionType, payload(), false);
      expect(view.action.actionStatus).toBe("EXECUTED");
      expect(plainProposalStatus(view)).toBe("SAVED");
    },
  );

  it.each(payloads)(
    "%s: approved, run lost before executing (redeploy), a repeat approve executes it (was stuck APPROVED)",
    async (actionType, payload) => {
      const { view, action } = await approveAndContinue(
        actionType,
        payload(),
        true,
      );
      expect(view.action.actionStatus).toBe("EXECUTED");
      expect(plainProposalStatus(view)).toBe("SAVED");
      // A second continuation (a repeated tap) never executes twice.
      await world.continueApproved({
        actor: world.actor,
        runId: action.runId,
        actionId: action.id,
        correlationId: CORRELATION(),
      });
      const [count] = await db.sql<{ n: number }[]>`
        select count(*)::int as n from q_runtime.actions
        where id = ${action.id} and status = 'EXECUTED'`;
      expect(count?.n).toBe(1);
    },
  );

  it("sends a chat message and an email once per approved action", () => {
    const chats = world.sent.filter((line) => line.startsWith("chat:"));
    const emails = world.sent.filter((line) => line.startsWith("email:"));
    expect(new Set(chats).size).toBe(chats.length);
    expect(new Set(emails).size).toBe(emails.length);
    expect(chats).toHaveLength(2);
    expect(emails).toHaveLength(2);
  });

  describe("the sweep of approved actions nobody carried out (live 2026-10-01, 6b04d028)", () => {
    const reminder = () => ({
      ownerUserId: world.actor.userId,
      title: `Prepare questions ${randomUUID().slice(0, 6)}`,
      remindAt: "2030-10-09T08:00:00.000Z",
      timeZone: "Europe/London",
      channel: "EMAIL",
    });
    /** Approved, then its run failed on resume: APPROVED with nothing left to run it. */
    async function stuck() {
      const ref = await pausedRun();
      const { action, approval } = await world.service.propose({
        actor: world.actor,
        runId: ref.runId,
        correlationId: CORRELATION(),
        actionType: "reminder.create",
        payload: reminder(),
      });
      await world.service.approve({
        actor: world.actor,
        approvalId: QApprovalIdSchema.parse(approval.id),
        correlationId: CORRELATION(),
      });
      await world.orchestration.resumeFromApproval(ref);
      await world.orchestration.fail(ref, "INTERNAL_ERROR");
      return { actionId: action.id, approvalId: approval.id };
    }
    const statusOf = async (actionId: string) => {
      const [row] = await db.sql<
        { status: string; execution_attempts: number }[]
      >`select status, execution_attempts from q_runtime.actions where id = ${actionId}`;
      return row;
    };
    const sweep = () =>
      createApprovedActionSweep({ sql: db.sql, actions: world.port });

    it("executes a stuck approved action once, as the approver, even when two sweeps run at once", async () => {
      const { actionId } = await stuck();
      const [first, second] = await Promise.all([
        sweep().sweep({ olderThanMs: 0 }),
        sweep().sweep({ olderThanMs: 0 }),
      ]);
      expect(first.executed + second.executed).toBe(1);
      expect(await statusOf(actionId)).toEqual({
        status: "EXECUTED",
        execution_attempts: 1,
      });
      // And a later pass finds nothing left to do.
      const again = await sweep().sweep({ olderThanMs: 0 });
      expect(again.executed).toBe(0);
      expect(await statusOf(actionId)).toMatchObject({ status: "EXECUTED" });
    });

    it("leaves a just-approved action to its own continuation", async () => {
      const { actionId } = await stuck();
      await sweep().sweep();
      expect(await statusOf(actionId)).toMatchObject({ status: "APPROVED" });
      await sweep().sweep({ olderThanMs: 0 });
    });

    it("honours expiry: a lapsed approval runs nothing, and the approver is told once", async () => {
      const { actionId, approvalId } = await stuck();
      await db.sql`update q_runtime.approvals
        set requested_at = now() - interval '3 hours',
            approved_at = now() - interval '2 hours',
            expires_at = now() - interval '1 hour'
        where id = ${approvalId}`;
      const result = await sweep().sweep({ olderThanMs: 0 });
      expect(result.notExecuted).toBeGreaterThanOrEqual(1);
      expect(await statusOf(actionId)).toMatchObject({ status: "EXPIRED" });
      const notices = await db.sql<{ title: string }[]>`
        select title from communication.notifications
         where user_id = ${world.actor.userId}
           and dedupe_key = ${`approved-action:${actionId}:NOT_APPROVED`}`;
      expect(notices).toEqual([{ title: "A change you approved has lapsed" }]);
    });

    it("never acts beyond the approver: without their membership the gate refuses and nothing runs", async () => {
      const { actionId } = await stuck();
      await db.sql`update identity.organisation_memberships
        set membership_status = 'left', left_at = now()
        where id = ${world.actor.membershipId ?? null}`;
      try {
        const result = await sweep().sweep({ olderThanMs: 0 });
        expect(result.executed).toBe(0);
        expect(await statusOf(actionId)).toMatchObject({
          status: "APPROVED",
          execution_attempts: 0,
        });
      } finally {
        await db.sql`update identity.organisation_memberships
          set membership_status = 'active', left_at = null
          where id = ${world.actor.membershipId ?? null}`;
      }
      await sweep().sweep({ olderThanMs: 0 });
      expect(await statusOf(actionId)).toMatchObject({ status: "EXECUTED" });
    });
  });
});
