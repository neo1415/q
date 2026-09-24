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
