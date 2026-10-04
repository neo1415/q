import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  isCalendarBlock,
  QActionProposalIdSchema,
  QRunIdSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { QActionPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

/**
 * Approved actions nobody carried out (live 2026-10-01, action 6b04d028: a
 * reminder approved by a typed yes stayed APPROVED after its run failed on
 * resume, and only a second approve would have moved it).
 *
 * Every two minutes this finds actions whose approval is at least two
 * minutes old and that are still APPROVED -- no execution claimed, and the
 * continuation that follows an approval (a bounded wait of seconds) long
 * over -- and puts each through the execution gate, the same call the
 * continuation makes. The gate is what makes this safe:
 *
 * - its claim lets exactly one caller execute; a second sweep, a repeated
 *   tap or a late continuation gets ALREADY_EXECUTED or IN_PROGRESS;
 * - it acts only as the approver: the actor is the person recorded on the
 *   approval, in the action's own tenant and organisation, through their
 *   active membership there, and the gate re-checks that they may still
 *   approve this action now (a revoked role is BLOCKED, never broadened);
 * - it honours expiry: a lapsed approval is marked EXPIRED, nothing runs.
 *
 * Anything that does not end EXECUTED is logged, and the approver gets one
 * notice (deduplicated per action and outcome). Batches are capped.
 */

export const APPROVED_ACTION_SWEEP_INTERVAL_MS = 2 * 60_000;
const OLDER_THAN_MS = 2 * 60_000;
const BATCH_SIZE = 10;
/** An approval older than this is left for people to look at, not retried forever. */
const LOOKBACK_DAYS = 7;

export type ApprovedActionSweepResult = {
  readonly examined: number;
  readonly executed: number;
  readonly notExecuted: number;
};

type StuckRow = {
  readonly action_id: string;
  readonly run_id: string;
  readonly tenant_id: string;
  readonly organisation_id: string | null;
  readonly summary: string;
  readonly approver_user_id: string;
  readonly membership_id: string | null;
};

function noticeFor(
  kind: string,
  summary: string,
): { readonly title: string; readonly body: string } {
  const what = summary.trim().replace(/[.\s]+$/u, "");
  switch (kind) {
    case "NOT_APPROVED":
      return {
        title: "A change you approved has lapsed",
        body: `Your approval expired before it could be applied, so nothing changed: ${what}. Ask Q to prepare it again.`,
      };
    case "BLOCKED":
      return {
        title: "A change you approved wasn't applied",
        body: `You no longer have the access it needs, so nothing changed: ${what}.`,
      };
    default:
      return {
        title: "A change you approved didn't go through",
        body: `Q tried to apply it and it failed: ${what}. Ask Q to try again.`,
      };
  }
}

export function createApprovedActionSweep(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly actions: Pick<QActionPort, "executeApproved">;
  readonly logger?: Logger | undefined;
}): {
  readonly sweep: (options?: {
    readonly olderThanMs?: number | undefined;
    readonly batchSize?: number | undefined;
  }) => Promise<ApprovedActionSweepResult>;
} {
  const { sql, actions, logger } = dependencies;

  const notify = async (row: StuckRow, kind: string): Promise<void> => {
    const { title, body } = noticeFor(kind, row.summary);
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      values (${row.tenant_id}, ${row.approver_user_id}, 'Q_WORK', ${title},
              ${body.slice(0, 1000)}, null, null, null,
              ${`approved-action:${row.action_id}:${kind}`})
      on conflict (user_id, dedupe_key) do nothing`;
  };

  return {
    sweep: async (options) => {
      const olderThanMs = options?.olderThanMs ?? OLDER_THAN_MS;
      const batchSize = Math.min(
        Math.max(options?.batchSize ?? BATCH_SIZE, 1),
        50,
      );
      const rows = await sql<StuckRow[]>`
        select a.id as action_id, a.run_id, a.tenant_id, a.organisation_id,
               a.summary, p.approved_by_user_id as approver_user_id,
               (select m.id from identity.organisation_memberships m
                 where m.user_id = p.approved_by_user_id
                   and m.organisation_id = a.organisation_id
                   and m.membership_status = 'active'
                   and m.left_at is null
                 order by m.joined_at desc nulls last
                 limit 1) as membership_id
          from q_runtime.actions a
          join q_runtime.approvals p
            on p.action_id = a.id and p.tenant_id = a.tenant_id
         where a.status = 'APPROVED'
           and a.executed_at is null
           and p.status = 'APPROVED'
           and p.approved_by_user_id is not null
           and p.approved_at < now() - make_interval(secs => ${olderThanMs / 1000})
           and p.approved_at > now() - make_interval(days => ${LOOKBACK_DAYS})
         order by p.approved_at
         limit ${batchSize}`;
      let executed = 0;
      let notExecuted = 0;
      for (const row of rows) {
        const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
        // Only the approver, in the action's own context; no membership
        // means no organisation context, which the gate refuses.
        const actor = ActorContextSchema.parse({
          userId: row.approver_user_id,
          tenantId: row.tenant_id,
          ...(row.organisation_id !== null && row.membership_id !== null
            ? {
                organisationId: row.organisation_id,
                membershipId: row.membership_id,
              }
            : {}),
          actorType: "HUMAN",
        });
        try {
          const outcome = await actions.executeApproved({
            actor,
            runId: QRunIdSchema.parse(row.run_id),
            tenantId: actor.tenantId,
            correlationId,
            actionId: QActionProposalIdSchema.parse(row.action_id),
          });
          if (
            outcome.kind === "EXECUTED" ||
            outcome.kind === "ALREADY_EXECUTED" ||
            outcome.kind === "IN_PROGRESS"
          ) {
            if (outcome.kind === "EXECUTED") executed += 1;
            logger?.info(
              {
                actionId: row.action_id,
                qRunId: row.run_id,
                outcome: outcome.kind,
                correlationId,
              },
              "approved action carried out by the sweep",
            );
            continue;
          }
          notExecuted += 1;
          logger?.warn(
            {
              actionId: row.action_id,
              qRunId: row.run_id,
              outcome: outcome.kind,
              reason:
                "reason" in outcome ? outcome.reason : outcome.failureCode,
              correlationId,
            },
            "approved action not carried out by the sweep",
          );
          // meetfix-57: a call refused for a missing calendar already told
          // the approver how to fix it, once; a second, vaguer notice
          // would contradict it.
          if (
            outcome.kind === "FAILED" &&
            isCalendarBlock(outcome.failureCode)
          ) {
            continue;
          }
          await notify(row, outcome.kind).catch((error: unknown) => {
            logger?.warn(
              { err: error, actionId: row.action_id },
              "approved-action notice not recorded",
            );
          });
        } catch (error: unknown) {
          notExecuted += 1;
          logger?.error(
            { err: error, actionId: row.action_id, qRunId: row.run_id },
            "approved action sweep failed for one action",
          );
        }
      }
      return { examined: rows.length, executed, notExecuted };
    },
  };
}
