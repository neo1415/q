import { z } from "zod";

import { QActionTypeSchema, UuidSchema } from "@capital-q/contracts";
import { capability } from "@capital-q/security";

import { defineQAction, type AnyQActionDefinition } from "../definition.js";

/**
 * TEST-ONLY consequential action (CQ-Q-008 §54-§55). Proves the Approval
 * Engine — proposal, exact-payload binding, approval, reauthorization,
 * idempotent execution, failure handling — without sending, booking,
 * sharing or granting anything. It must never appear in a production
 * registry: it lives under the `./testing` subpath and is composed only
 * by tests and the developer smoke.
 *
 * The executor counts executions in memory; that counter is the "side
 * effect" every duplicate-execution test measures.
 */

export const TEST_CONFIRM_REQUIRED = QActionTypeSchema.parse(
  "test.confirm_required",
);

export const TestConfirmRequiredPayloadSchema = z
  .object({
    /** The company the test action is about; part of the binding as a target. */
    companyId: UuidSchema,
    /** Material content a person reviews. May carry a private marker in tests. */
    note: z.string().trim().min(1).max(2_000),
    /** Optional second target, to prove target binding. */
    recipientUserId: UuidSchema.optional(),
    /** Test control: a definite retryable failure, or an unknown outcome. */
    behaviour: z
      .enum(["SUCCEED", "FAIL_RETRYABLE", "FAIL_PERMANENT", "UNKNOWN", "THROW"])
      .default("SUCCEED"),
  })
  .strict();
export type TestConfirmRequiredPayload = z.infer<
  typeof TestConfirmRequiredPayloadSchema
>;

export const TestConfirmRequiredResultSchema = z
  .object({
    executionNumber: z.number().int().min(1),
    noteLength: z.number().int().min(0),
  })
  .strict();
export type TestConfirmRequiredResult = z.infer<
  typeof TestConfirmRequiredResultSchema
>;

export type TestActionExecutorState = {
  /** How many times the executor actually ran: the measured side effect. */
  readonly executions: () => number;
  readonly executedActionIds: () => readonly string[];
  /** Pause the next execution until released, to stage concurrent claims in tests. */
  readonly holdNext: () => () => void;
};

/**
 * Builds the definition plus a handle on its side-effect counter. The
 * required capability is `organisation.view` on the actor's organisation:
 * every member holds it, and revoking the membership revokes it — which is
 * exactly what the execution-time reauthorization tests need to observe.
 */
export function createTestConfirmRequiredAction(): {
  readonly definition: AnyQActionDefinition;
  readonly state: TestActionExecutorState;
} {
  let executions = 0;
  const executedActionIds: string[] = [];
  let hold: Promise<void> | null = null;
  let release: (() => void) | null = null;

  const definition = defineQAction<
    TestConfirmRequiredPayload,
    TestConfirmRequiredResult
  >({
    actionType: TEST_CONFIRM_REQUIRED,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-actions (test only)",
    description:
      "Records a test note about a company. Test composition only; never registered in production.",
    payload: TestConfirmRequiredPayloadSchema,
    result: TestConfirmRequiredResultSchema,
    targets: (payload) => [
      { kind: "COMPANY", companyId: payload.companyId },
      ...(payload.recipientUserId === undefined
        ? []
        : [{ kind: "USER" as const, userId: payload.recipientUserId }]),
    ],
    describe: (payload) => ({
      summary: "Q wants to record a test note about this company.",
      preview: payload.note,
    }),
    // A note beginning FORBIDDEN stands for an action the person may not
    // take: proposal refuses it, and approval could never create the right.
    authorize: (payload) =>
      Promise.resolve(
        payload.note.startsWith("FORBIDDEN")
          ? { outcome: "DENY", code: "TEST_FORBIDDEN_NOTE" }
          : { outcome: "ALLOW" },
      ),
    executor: {
      execute: async (action) => {
        if (hold !== null) {
          const pending = hold;
          hold = null;
          await pending;
        }
        switch (action.payload.behaviour) {
          case "THROW":
            throw new Error(
              "executor exploded APPROVAL-INTERNAL-ERROR-DO-NOT-LEAK",
            );
          case "FAIL_RETRYABLE":
            return {
              outcome: "FAILED",
              failureCode: "TEST_TRANSIENT_FAILURE",
              retryable: true,
            };
          case "FAIL_PERMANENT":
            return {
              outcome: "FAILED",
              failureCode: "TEST_PERMANENT_FAILURE",
              retryable: false,
            };
          case "UNKNOWN":
            return { outcome: "UNKNOWN", failureCode: "TEST_OUTCOME_UNKNOWN" };
          case "SUCCEED":
            executions += 1;
            executedActionIds.push(action.actionId);
            return {
              outcome: "EXECUTED",
              result: {
                executionNumber: executions,
                noteLength: action.payload.note.length,
              },
            };
        }
      },
    },
  });

  return {
    definition,
    state: {
      executions: () => executions,
      executedActionIds: () => [...executedActionIds],
      holdNext: () => {
        hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => {
          release?.();
          release = null;
        };
      },
    },
  };
}

/** The capability the test action's authorize step relies on, for tests that revoke it. */
export const TEST_ACTION_CAPABILITY = capability("organisation.view");
