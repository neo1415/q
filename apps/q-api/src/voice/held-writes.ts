import type { DatabaseExecutor } from "@capital-q/database";
import {
  drainPendingWrites,
  failureCode,
  isTransientOnboardingFailure,
  waitsForContext,
  waitsForStep,
  WAITING_CODE_PREFIX,
  type DrainResult,
  type PendingWrite,
  type PendingWriteRepository,
} from "@capital-q/onboarding";

import type { HeldOnboardingWrites } from "./onboarding-port.js";

/**
 * Held onboarding writes for the interview (lane ob1).
 *
 * A confirmed answer whose save failed because the onboarding API was
 * briefly down is held in `onboarding.pending_writes` (its own durable
 * store, not the API it was trying to reach), and every later turn first
 * replays what is held through the ordinary validated submit, under the
 * person's own credentials. Nothing here writes canonical data itself.
 */

export type HeldWritesStore = {
  readonly bind: (input: {
    readonly userId: string;
    readonly sessionId: string;
  }) => HeldOnboardingWrites & {
    /**
     * Replays what is held, oldest first. `currentValue` reads the step's
     * answer on the record now; `submit` writes through the ordinary path.
     * Never throws for a replay failure.
     */
    readonly drain: (ports: {
      readonly currentValue: (stepKey: string) => Promise<unknown>;
      readonly answeredAt?: (stepKey: string) => Promise<Date | null>;
      readonly submit: (write: PendingWrite) => Promise<void>;
    }) => Promise<DrainResult>;
  };
};

export function createHeldWritesStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly repository: PendingWriteRepository;
  readonly newKey: () => string;
}): HeldWritesStore {
  const { sql, repository } = dependencies;
  return {
    bind: ({ userId, sessionId }) => ({
      hold: async (stepKey, response) => {
        await repository.hold(sql, {
          sessionId,
          userId,
          stepKey,
          response,
          origin: "CONVERSATION",
          idempotencyKey: dependencies.newKey(),
        });
      },
      pendingSteps: async () =>
        new Set(
          (await repository.listPending(sql, sessionId, userId)).map(
            (w) => w.stepKey,
          ),
        ),
      pendingValues: async () =>
        (await repository.listPending(sql, sessionId, userId)).map((w) => ({
          stepKey: w.stepKey,
          value: w.response.value,
          ...(w.response.note === undefined ? {} : { note: w.response.note }),
        })),
      drain: (ports) =>
        drainPendingWrites({
          pending: () => repository.listPending(sql, sessionId, userId),
          currentValue: ports.currentValue,
          ...(ports.answeredAt === undefined
            ? {}
            : { answeredAt: ports.answeredAt }),
          submit: ports.submit,
          classify: (error) =>
            waitsForContext(error) || waitsForStep(error)
              ? {
                  kind: "WAITING",
                  // Marked as waiting, so its retries are not backed off.
                  code: `${WAITING_CODE_PREFIX}${failureCode(error)}`,
                }
              : isTransientOnboardingFailure(error)
                ? { kind: "TRANSIENT", code: failureCode(error) }
                : { kind: "REFUSED", code: failureCode(error) },
          settle: (id, status, code) =>
            repository.settle(sql, id, status, code),
          recordAttempt: (id, code) => repository.recordAttempt(sql, id, code),
        }),
    }),
  };
}
