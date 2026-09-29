"use server";

import { z } from "zod";

import {
  ApiProblemError,
  bringMeetingAssistant,
  dismissMeetingAssistant,
  getMeetingAssistant,
} from "@capital-q/api-client";
import type { QMeetingAssistantDto } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * Q in a meeting, server side (founder direction 2026-09-29). Server
 * actions so the session token never reaches the browser; the meeting id
 * is input, and the Q API answers only the meeting's organiser.
 */
export type MeetingQResult =
  | { readonly ok: true; readonly value: QMeetingAssistantDto }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

async function run(
  work: (session: {
    readonly baseUrl: string;
    readonly accessToken: string;
  }) => Promise<QMeetingAssistantDto>,
): Promise<MeetingQResult> {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    return {
      ok: true,
      value: await work({ baseUrl: qApiBaseUrl, accessToken }),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't reach Q just now. Please try again.",
    };
  }
}

export async function readMeetingQAction(
  meetingId: string,
): Promise<MeetingQResult> {
  const id = Id.safeParse(meetingId);
  if (!id.success) return { ok: false, message: "That isn't available." };
  return run((session) => getMeetingAssistant(session, id.data));
}

export async function bringMeetingQAction(
  meetingId: string,
  idempotencyKey: string,
): Promise<MeetingQResult> {
  const id = Id.safeParse(meetingId);
  const key = Key.safeParse(idempotencyKey);
  if (!id.success || !key.success) {
    return { ok: false, message: "That isn't available." };
  }
  return run((session) => bringMeetingAssistant(session, id.data, key.data));
}

export async function dismissMeetingQAction(
  meetingId: string,
): Promise<MeetingQResult> {
  const id = Id.safeParse(meetingId);
  if (!id.success) return { ok: false, message: "That isn't available." };
  return run((session) => dismissMeetingAssistant(session, id.data));
}
