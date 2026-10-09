import {
  DELEGATION_LIMITS,
  type InstructionWorkingHours,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { workingDaysBetween } from "./engine.js";
import { threadPace, type ThreadPace } from "./quarantine.js";

/**
 * Recovery (founder, 2026-10-09: "they keep sending messages without a
 * response from the receiver"). The hard rule for anything Q sends on its
 * own in a conversation, enforced where the message is sent -- not only in
 * the planner, which can be wrong, stale or out of date:
 *
 *   - they wrote last (or nobody has written): Q may write;
 *   - Q's side wrote last and they haven't answered: ONE follow-up, and
 *     only after `followUpAfterWorkingDays` of their working days;
 *   - after that follow-up, nothing more: the thread waits on them.
 *
 * A thread Q could not read is never written to: unknown is not "they
 * replied". The person's own sends (their screen, or a card they approve)
 * are theirs and never go through this.
 */

export type SendGuardPolicy = {
  /** Their working days Q waits before its one follow-up. */
  readonly followUpAfterWorkingDays: number;
  /** Our messages in a row with no answer, at most (the first + one follow-up). */
  readonly maxUnanswered: number;
};

export const DEFAULT_SEND_GUARD_POLICY: SendGuardPolicy = {
  followUpAfterWorkingDays: DELEGATION_LIMITS.followUpAfterWorkingDays,
  maxUnanswered: 2,
};

/** Monday to Friday in UTC: the default when a job has no working hours. */
export const BUSINESS_DAYS_UTC: InstructionWorkingHours = {
  timeZone: "UTC",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
};

export type SendGuardVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** WAITING_ON_THEM: no more until they reply. TOO_SOON: wait for the follow-up. NOT_READ: the thread could not be read. */
      readonly code: "WAITING_ON_THEM" | "TOO_SOON_TO_FOLLOW_UP" | "NOT_READ";
      readonly reason: string;
    };

export function sendAllowed(
  pace: ThreadPace | null,
  now: Date,
  hours: InstructionWorkingHours = BUSINESS_DAYS_UTC,
  policy: SendGuardPolicy = DEFAULT_SEND_GUARD_POLICY,
): SendGuardVerdict {
  if (pace === null) {
    return {
      ok: false,
      code: "NOT_READ",
      reason:
        "I couldn't read the conversation just now, so I don't know whether they've replied; nothing was sent",
    };
  }
  if (pace.lastFrom !== "US" || pace.unansweredFromUs === 0) {
    return { ok: true };
  }
  if (pace.unansweredFromUs >= policy.maxUnanswered) {
    return {
      ok: false,
      code: "WAITING_ON_THEM",
      reason:
        "waiting on them: your side has written and followed up once, so nothing more goes until they reply",
    };
  }
  if (
    pace.lastFromUsAt === null ||
    workingDaysBetween(pace.lastFromUsAt, now, hours) <
      policy.followUpAfterWorkingDays
  ) {
    return {
      ok: false,
      code: "TOO_SOON_TO_FOLLOW_UP",
      reason: `your side wrote last and they haven't replied; one gentle follow-up can go after ${String(policy.followUpAfterWorkingDays)} of their working days`,
    };
  }
  return { ok: true };
}

/**
 * The guard over the live conversation: reads the thread now (as the
 * person, through the chat's own read) and applies `sendAllowed`.
 */
export function createSendGuard(dependencies: {
  readonly readThread: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
  }) => Promise<
    readonly {
      readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
      readonly sentAt: string;
    }[]
  >;
  readonly now?: (() => Date) | undefined;
  readonly policy?: SendGuardPolicy | undefined;
}) {
  const now = dependencies.now ?? (() => new Date());
  return async (
    actor: ActorContext,
    relationshipId: string,
    hours?: InstructionWorkingHours,
  ): Promise<SendGuardVerdict> => {
    const messages = await dependencies
      .readThread({ actor, relationshipId })
      .catch(() => null);
    return sendAllowed(
      messages === null ? null : threadPace(messages),
      now(),
      hours,
      dependencies.policy,
    );
  };
}

export type SendGuard = ReturnType<typeof createSendGuard>;
