"use server";

import { z } from "zod";

import {
  appendOnboardingInterviewTurns,
  listOnboardingInterviewTurns,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { OnboardingInterviewTurn } from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The interview thread as the server kept it (CQ-QX-006).
 *
 * A reload used to drop the on-screen conversation: the thread lived only
 * in the browser, so Q opened again as if they had never spoken and the
 * person's "yep" confirmed a value they could no longer see. The
 * interviewer now keeps every exchange server-side; this reads it back so
 * the workspace redraws the conversation before Q says anything new.
 *
 * A display record only: what was recorded is still read from the
 * session, never from this prose. Any failure is an empty thread, never
 * an error on screen — the interview works without it.
 */
export async function onboardingThreadAction(
  rawSessionId: string,
): Promise<readonly OnboardingInterviewTurn[]> {
  const sessionId = z.string().uuid().safeParse(rawSessionId);
  if (!sessionId.success) return [];
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) return [];
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return [];
  try {
    const listed = await listOnboardingInterviewTurns(
      { baseUrl: apiBaseUrl, accessToken },
      sessionId.data,
      50,
    );
    return listed.items;
  } catch {
    return [];
  }
}

/**
 * Keep a line of Q's that the interviewer did not write (adversarial
 * round 2, #7): the answer to a research question comes from a Q run the
 * surface carried, not from the interviewer's reply, so the thread must
 * keep exactly what the person saw. Best effort; nothing on screen
 * depends on it.
 */
export async function onboardingThreadKeepAction(
  rawSessionId: string,
  rawText: string,
): Promise<void> {
  const sessionId = z.string().uuid().safeParse(rawSessionId);
  const text = z.string().trim().min(1).max(4000).safeParse(rawText);
  if (!sessionId.success || !text.success) return;
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) return;
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return;
  try {
    await appendOnboardingInterviewTurns(
      { baseUrl: apiBaseUrl, accessToken },
      sessionId.data,
      {
        turnRef: crypto.randomUUID(),
        turns: [{ role: "Q", text: text.data, channel: "TEXT" }],
      },
    );
  } catch {
    // The thread is a display record; a missed line is a worse reload,
    // never a lost answer.
  }
}

const KeptLineSchema = z
  .object({
    role: z.enum(["PERSON", "Q"]),
    text: z.string().trim().min(1).max(4000),
    stepKey: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)
      .optional(),
  })
  .strict();

/**
 * Keep lines the screen showed that the interviewer did not write, in the
 * order shown, each with the step it was about (live 2026-10-30,
 * Hydrolume): the Skip on "team strengths" and the review question after
 * it were on screen only, so the conversation Q read had Q's team question
 * followed by "Yes, that looks right", and the reading took that yes as
 * agreeing to the examples the question had listed. A skip is kept with
 * its step, which is how the reading knows when it was set aside.
 * Awaited by the caller so the lines come before the next words sent;
 * best effort all the same: a missed line is a worse reading and reload,
 * never a lost answer.
 */
export async function onboardingThreadKeepLinesAction(
  rawSessionId: string,
  rawLines: unknown,
): Promise<void> {
  const sessionId = z.string().uuid().safeParse(rawSessionId);
  const lines = z
    .array(KeptLineSchema)
    .min(1)
    .max(2)
    .refine(
      (all) => new Set(all.map((line) => line.role)).size === all.length,
      "each role at most once",
    )
    .safeParse(rawLines);
  if (!sessionId.success || !lines.success) return;
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) return;
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return;
  try {
    await appendOnboardingInterviewTurns(
      { baseUrl: apiBaseUrl, accessToken },
      sessionId.data,
      {
        turnRef: crypto.randomUUID(),
        turns: lines.data.map((line) => ({
          role: line.role,
          text: line.text,
          channel: "TEXT" as const,
          ...(line.stepKey === undefined ? {} : { stepKey: line.stepKey }),
        })),
      },
    );
  } catch {
    // A display record; a missed line is a worse reload, never a lost answer.
  }
}

/**
 * Keep an exchange the person had by tapping (QA F-129, 25 Oct): their
 * choice and Q's acknowledgement were drawn on screen only, and a reload
 * dropped them, so "Seed" or "Looks right" vanished from the conversation.
 * Both roles in one exchange, in order. Best effort, like every display
 * line: what was answered is read from the session, never from this.
 */
export async function onboardingThreadKeepTapAction(
  rawSessionId: string,
  rawSaid: string,
  rawAcknowledged: string,
): Promise<void> {
  const sessionId = z.string().uuid().safeParse(rawSessionId);
  const said = z.string().trim().min(1).max(4000).safeParse(rawSaid);
  const acknowledged = z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .safeParse(rawAcknowledged);
  if (!sessionId.success || !said.success || !acknowledged.success) return;
  const { apiBaseUrl } = loadWebServerConfig();
  if (apiBaseUrl === undefined) return;
  const accessToken = await getSessionAccessToken();
  if (accessToken === null) return;
  try {
    await appendOnboardingInterviewTurns(
      { baseUrl: apiBaseUrl, accessToken },
      sessionId.data,
      {
        turnRef: crypto.randomUUID(),
        turns: [
          { role: "PERSON", text: said.data, channel: "TEXT" },
          { role: "Q", text: acknowledged.data, channel: "TEXT" },
        ],
      },
    );
  } catch {
    // A display record; a missed exchange is a worse reload, never a lost answer.
  }
}
