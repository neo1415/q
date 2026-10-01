"use server";

import { z } from "zod";

import {
  ApiProblemError,
  entitlementOf,
  finishRehearsal,
  getRehearsal,
  getRehearsalPersona,
  sayInRehearsal,
  sendRehearsalScreen,
  startRehearsal,
} from "@capital-q/api-client";
import {
  RehearsalCounterpartKindSchema,
  RehearsalDifficultySchema,
  REHEARSAL_SCREEN_MAX_CHARS,
  type EntitlementProblemExtension,
  type QRehearsalDto,
  type QRehearsalPersonaDto,
} from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * Rehearsals, server side (C12, generalised by REHEARSE 2026-10-01).
 * Server actions so the session token never reaches the browser; the Q API
 * answers only for the rehearsal's own person, and every id here is input.
 */
export type RehearsalResult<T = QRehearsalDto> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly message: string;
      // BILLING (ADR 0034): the plan's own words when it does not cover this.
      readonly entitlement?: EntitlementProblemExtension | undefined;
    };

const Id = z.string().uuid();

async function run<T>(
  work: (session: {
    readonly baseUrl: string;
    readonly accessToken: string;
  }) => Promise<T>,
): Promise<RehearsalResult<T>> {
  const session = await qApiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error: unknown) {
    const entitlement = entitlementOf(error);
    if (entitlement !== null) {
      return { ok: false, message: entitlement.message, entitlement };
    }
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't reach Q just now. Please try again.",
    };
  }
}

/** Q's reading of the person it will play; built or refreshed on demand. */
export async function rehearsalPersonaAction(
  kind: unknown,
  counterpartId: unknown,
): Promise<RehearsalResult<QRehearsalPersonaDto>> {
  const parsedKind = RehearsalCounterpartKindSchema.safeParse(kind);
  const id = Id.safeParse(counterpartId);
  if (!parsedKind.success || !id.success) {
    return { ok: false, message: "Not found." };
  }
  return run((session) =>
    getRehearsalPersona(session, parsedKind.data, id.data),
  );
}

export async function startRehearsalAction(input: {
  readonly kind: unknown;
  readonly counterpartId: unknown;
  readonly meetingId?: unknown;
  readonly voice?: unknown;
  readonly difficulty?: unknown;
}): Promise<RehearsalResult> {
  const kind = RehearsalCounterpartKindSchema.safeParse(input.kind);
  const id = Id.safeParse(input.counterpartId);
  const meeting = Id.optional().safeParse(input.meetingId ?? undefined);
  const voice = z.enum(["FEMALE", "MALE"]).safeParse(input.voice);
  const difficulty = RehearsalDifficultySchema.safeParse(input.difficulty);
  if (!kind.success || !id.success || !meeting.success) {
    return { ok: false, message: "Not found." };
  }
  return run((session) =>
    startRehearsal(session, {
      counterpart: { kind: kind.data, id: id.data },
      ...(meeting.data === undefined ? {} : { meetingId: meeting.data }),
      ...(voice.success ? { voice: voice.data } : {}),
      ...(difficulty.success ? { difficulty: difficulty.data } : {}),
    }),
  );
}

export async function readRehearsalAction(
  rehearsalId: unknown,
): Promise<RehearsalResult> {
  const id = Id.safeParse(rehearsalId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => getRehearsal(session, id.data));
}

export async function sayInRehearsalAction(
  rehearsalId: unknown,
  text: unknown,
): Promise<RehearsalResult> {
  const id = Id.safeParse(rehearsalId);
  const said = z.string().trim().min(1).max(4_000).safeParse(text);
  if (!id.success || !said.success) {
    return { ok: false, message: "Say something first." };
  }
  return run((session) => sayInRehearsal(session, id.data, said.data));
}

export async function raiseHandAction(
  rehearsalId: unknown,
): Promise<RehearsalResult> {
  const id = Id.safeParse(rehearsalId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) =>
    sayInRehearsal(session, id.data, { cue: "HAND_RAISED" }),
  );
}

/** One frame of the shared screen (a downscaled JPEG data URL). */
export async function shareScreenFrameAction(
  rehearsalId: unknown,
  image: unknown,
): Promise<RehearsalResult<true>> {
  const id = Id.safeParse(rehearsalId);
  const frame = z
    .string()
    .max(REHEARSAL_SCREEN_MAX_CHARS)
    .startsWith("data:image/jpeg;base64,")
    .safeParse(image);
  if (!id.success || !frame.success) {
    return { ok: false, message: "That frame was too large to share." };
  }
  return run(async (session) => {
    await sendRehearsalScreen(session, id.data, frame.data);
    return true as const;
  });
}

export async function finishRehearsalAction(
  rehearsalId: unknown,
): Promise<RehearsalResult> {
  const id = Id.safeParse(rehearsalId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => finishRehearsal(session, id.data));
}
