"use server";

import { z } from "zod";

import {
  answerQWork,
  ApiProblemError,
  getNotificationSettings,
  getPushKey,
  getQWork,
  listNotifications,
  listQWork,
  markNotificationsRead,
  saveNotificationSettings,
  setQPresence,
  stopQWork,
  subscribePush,
  unsubscribePush,
  type ApiSession,
} from "@capital-q/api-client";
import {
  PushSubscriptionRequestSchema,
  UtcTimestampSchema,
  type NotificationList,
  type NotificationSettingsDto,
  type QWorkDetailDto,
  type QWorkDto,
} from "@capital-q/contracts";

import { apiSession, qApiSession } from "@/features/q/context";

/**
 * Q's delegated work, notices and pushes, server side (AUTO, ADR 0029).
 * Server actions so the session token never reaches the browser. Ids are
 * input, exactly as they are to the APIs, which answer only for the
 * person's own work, notices and devices.
 */

export type WorkResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const NOT_FOUND = { ok: false, message: "That isn't available." } as const;

async function run<T>(
  session: ApiSession | null,
  work: (session: ApiSession) => Promise<T>,
  failed: string,
): Promise<WorkResult<T>> {
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : failed,
    };
  }
}

// --- Q's work ------------------------------------------------------------

export async function listWorkAction(): Promise<
  WorkResult<readonly QWorkDto[]>
> {
  return run(
    await qApiSession(),
    async (session) => (await listQWork(session)).items,
    "Q's work couldn't load. Try again in a moment.",
  );
}

export async function readWorkAction(
  delegationId: string,
): Promise<WorkResult<QWorkDetailDto>> {
  const id = Id.safeParse(delegationId);
  if (!id.success) return NOT_FOUND;
  return run(
    await qApiSession(),
    (session) => getQWork(session, id.data),
    "This couldn't load. Try again in a moment.",
  );
}

export async function stopWorkAction(
  delegationId: string,
  laneId: string | null,
): Promise<WorkResult<null>> {
  const id = Id.safeParse(delegationId);
  const lane = laneId === null ? null : Id.safeParse(laneId);
  if (!id.success || (lane !== null && !lane.success)) return NOT_FOUND;
  return run(
    await qApiSession(),
    async (session) => {
      await stopQWork(session, id.data, lane?.data ?? null);
      return null;
    },
    "Q couldn't stop that just now. Try again.",
  );
}

export async function answerWorkAction(
  delegationId: string,
  laneId: string,
  answer:
    | { readonly kind: "BOOK_AT"; readonly at: string }
    | {
        readonly kind: "PASS";
      },
): Promise<WorkResult<null>> {
  const id = Id.safeParse(delegationId);
  const lane = Id.safeParse(laneId);
  if (!id.success || !lane.success) return NOT_FOUND;
  if (
    answer.kind === "BOOK_AT" &&
    !UtcTimestampSchema.safeParse(answer.at).success
  ) {
    return { ok: false, message: "Choose a time." };
  }
  return run(
    await qApiSession(),
    async (session) => {
      await answerQWork(
        session,
        id.data,
        lane.data,
        answer.kind === "PASS"
          ? { kind: "PASS" }
          : { kind: "BOOK_AT", at: answer.at },
      );
      return null;
    },
    "Q couldn't take that just now. Try again.",
  );
}

export async function setAwayAction(away: boolean): Promise<WorkResult<null>> {
  return run(
    await qApiSession(),
    async (session) => {
      await setQPresence(session, away === true);
      return null;
    },
    "That didn't save. Try again.",
  );
}

// --- notices and pushes --------------------------------------------------------

export async function listNoticesAction(): Promise<
  WorkResult<NotificationList>
> {
  return run(
    await apiSession(),
    (session) => listNotifications(session),
    "Notifications couldn't load. Try again in a moment.",
  );
}

export async function markReadAction(
  ids: readonly string[],
): Promise<WorkResult<null>> {
  const parsed = z.array(Id).min(1).max(50).safeParse(ids);
  if (!parsed.success) return NOT_FOUND;
  return run(
    await apiSession(),
    async (session) => {
      await markNotificationsRead(session, parsed.data);
      return null;
    },
    "That didn't save.",
  );
}

export async function pushKeyAction(): Promise<WorkResult<string | null>> {
  return run(
    await apiSession(),
    async (session) => (await getPushKey(session)).publicKey,
    "Push isn't available just now.",
  );
}

export async function subscribePushAction(
  subscription: unknown,
): Promise<WorkResult<null>> {
  const parsed = PushSubscriptionRequestSchema.safeParse(subscription);
  if (!parsed.success) {
    return {
      ok: false,
      message: "This browser's push subscription isn't usable.",
    };
  }
  return run(
    await apiSession(),
    async (session) => {
      await subscribePush(session, parsed.data);
      return null;
    },
    "Pushes couldn't be turned on. Try again.",
  );
}

export async function unsubscribePushAction(
  endpoint: string,
): Promise<WorkResult<null>> {
  const parsed = z.string().url().max(1_000).safeParse(endpoint);
  if (!parsed.success) return NOT_FOUND;
  return run(
    await apiSession(),
    async (session) => {
      await unsubscribePush(session, parsed.data);
      return null;
    },
    "Pushes couldn't be turned off. Try again.",
  );
}

export async function noticeSettingsAction(): Promise<
  WorkResult<NotificationSettingsDto>
> {
  return run(
    await apiSession(),
    (session) => getNotificationSettings(session),
    "Settings couldn't load.",
  );
}

export async function saveNoticeSettingsAction(settings: {
  readonly push: boolean;
  readonly email: boolean;
}): Promise<WorkResult<NotificationSettingsDto>> {
  return run(
    await apiSession(),
    (session) =>
      saveNotificationSettings(session, {
        push: settings.push === true,
        email: settings.email === true,
      }),
    "That didn't save. Try again.",
  );
}
