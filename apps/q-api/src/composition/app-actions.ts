import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  APP_ACTIONS,
  type AnyAppAction,
  type AppActionPorts,
} from "@capital-q/app-actions";
import { CorrelationIdSchema, QActionTypeSchema } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import type { AppApprovalPort } from "@capital-q/q-tools";

/**
 * ADR 0040 (Proposed): the Approval Engine side of the app's action
 * registry. A CONSEQUENTIAL action Q prepared is held on this board for
 * the run's prepare step; once the person approves exactly that payload,
 * the engine runs the SAME declaration -- its authorize step again, then
 * its one service call -- as the approver.
 */

const BOARD_TTL_MS = 10 * 60 * 1000;

/** `app.<name>`: the Approval Engine's type for a declared action. */
export const appActionType = (action: AnyAppAction): string =>
  `app.${action.name}`;

// Only a generated tool prepares an `app.<name>` card. An action still
// served by its hand tool keeps that tool's own approval type until its
// area's second step, so composing a card type for it would be unreachable.
const consequential = (actions: readonly AnyAppAction[]) =>
  actions.filter(
    (action) =>
      action.classification === "CONSEQUENTIAL" && action.tool !== undefined,
  );

/** The Approval Engine types this registry adds (startup checks the set). */
export const APP_ACTION_TYPES: readonly string[] = Object.freeze(
  consequential(APP_ACTIONS).map(appActionType),
);

export type AppActionBoard = AppApprovalPort & {
  readonly proposer: QActionProposer;
};

export function createAppActionBoard(
  options: {
    readonly actions?: readonly AnyAppAction[] | undefined;
    readonly now?: (() => number) | undefined;
    readonly logger?: Logger | undefined;
  } = {},
): AppActionBoard {
  const actions = options.actions ?? APP_ACTIONS;
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<
    string,
    {
      readonly tenantId: string;
      readonly actorUserId: string;
      readonly actionType: string;
      readonly payload: unknown;
      readonly at: number;
    }
  >();
  const sweep = () => {
    const cutoff = now() - BOARD_TTL_MS;
    for (const [runId, entry] of prepared) {
      if (entry.at < cutoff) prepared.delete(runId);
    }
  };
  return {
    prepareForApproval: (entry) => {
      sweep();
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        return existing.actionType === entry.actionType &&
          JSON.stringify(existing.payload) === JSON.stringify(entry.payload)
          ? "PREPARED"
          : "ONE_PER_TURN";
      }
      prepared.set(entry.runId, { ...entry, at: now() });
      return "PREPARED";
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        // Bound to the person and tenant the tool ran for, and re-checked
        // against the action's own input schema on the way out.
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        const action = consequential(actions).find(
          (candidate) => appActionType(candidate) === entry.actionType,
        );
        const parsed = action?.input.safeParse(entry.payload);
        if (action === undefined || parsed === undefined || !parsed.success) {
          options.logger?.warn(
            { qRunId: context.runId, actionType: entry.actionType },
            "a prepared app action did not fit its declaration",
          );
          return Promise.resolve({
            refused: "that isn't something I can prepare from here",
          });
        }
        return Promise.resolve({
          actionType: QActionTypeSchema.parse(entry.actionType),
          payload: parsed.data,
        });
      },
    },
  };
}

const ResultSchema = z.object({ says: z.string().max(600) }).strict();

/** Each CONSEQUENTIAL declaration as an Approval Engine action. */
export function createAppActionDefinitions(
  ports: AppActionPorts,
  options: {
    readonly actions?: readonly AnyAppAction[] | undefined;
    readonly logger?: Logger | undefined;
  } = {},
): readonly AnyQActionDefinition[] {
  return consequential(options.actions ?? APP_ACTIONS).map((action) =>
    defineQAction<unknown, z.infer<typeof ResultSchema>>({
      actionType: QActionTypeSchema.parse(appActionType(action)),
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "app-actions",
      description: action.does,
      payload: action.input,
      result: ResultSchema,
      targets: (payload) => action.targets(payload),
      // A setter's newer card replaces an older one for the same target;
      // an additive action's cards coexist (lead 2026-10-03).
      ...(action.supersedes === true ? { supersedes: true } : {}),
      describe: (payload) => action.card(payload),
      confirm: (_payload, result) => result.says,
      authorize: async (payload, actor) => {
        if (actor.actorType !== "HUMAN") {
          return { outcome: "DENY", code: "NOT_A_PERSON" };
        }
        // The declaration's own authorize step, as the approver.
        const verdict = await action
          .authorize(
            ports,
            {
              actor,
              idempotencyKey: "authorize",
              correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
              surface: "Q",
            },
            payload,
          )
          .catch(() => ({ ok: false as const, reason: "" }));
        return verdict.ok
          ? { outcome: "ALLOW" }
          : { outcome: "DENY", code: "NOT_AVAILABLE" };
      },
      executor: {
        execute: async (approved, context) => {
          try {
            const out = await action.run(
              ports,
              {
                actor: context.approver,
                idempotencyKey: `q-action:${approved.idempotencyKey}`,
                correlationId: context.correlationId,
                surface: "Q",
              },
              approved.payload,
            );
            return {
              outcome: "EXECUTED",
              result: { says: action.done(out, approved.payload, {}) },
            };
          } catch (error: unknown) {
            options.logger?.warn(
              {
                err: error,
                actionId: approved.actionId,
                attempt: context.attempt,
              },
              "an approved app action was not applied",
            );
            return {
              outcome: "FAILED",
              failureCode: "APP_ACTION_REFUSED",
              retryable: false,
            };
          }
        },
      },
    }),
  );
}
