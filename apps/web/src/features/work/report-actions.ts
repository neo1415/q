"use server";

import { z } from "zod";

import {
  ApiProblemError,
  getQWorkReport,
  sendChatMessage,
  stopQWork,
} from "@capital-q/api-client";
import { ChatMessageBodySchema } from "@capital-q/contracts";

import { apiSession, qApiSession } from "@/features/q/context";

import { stepBlocked, type ReportStep } from "./report-steps";

/**
 * Sends one of the first-stage report's prepared next steps on the
 * person's yes (Prepare, Recommend, your yes, Execute). The browser sends
 * the words exactly as shown and a key made once for those words; the
 * relationship is read again here from the person's own report, never
 * taken from the browser, and the chat API decides whether they are a
 * party. A pass also stops Q's work on that founder, so Q does not
 * contact them again.
 */

export type ReportStepResult =
  | { readonly ok: true; readonly stopped: boolean }
  | { readonly ok: false; readonly message: string };

const Input = z.object({
  delegationId: z.string().uuid(),
  laneId: z.string().uuid(),
  step: z.enum(["CALL", "QUESTIONS", "PASS"]),
  body: ChatMessageBodySchema,
  key: z
    .string()
    .min(8)
    .max(120)
    .regex(/^[A-Za-z0-9:_-]+$/),
});

export async function sendReportStepAction(
  raw: unknown,
): Promise<ReportStepResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Write the message before sending it." };
  }
  const input = parsed.data;
  const [q, api] = await Promise.all([qApiSession(), apiSession()]);
  if (q === null || api === null) {
    return { ok: false, message: "Your session ended. Sign in again." };
  }
  const report = await getQWorkReport(q, input.delegationId, input.laneId).catch(
    () => null,
  );
  if (report === null) {
    return { ok: false, message: "This report isn't available any more." };
  }
  const blocked = stepBlocked(input.step as ReportStep, report);
  if (blocked !== null || report.relationshipId === null) {
    return { ok: false, message: blocked ?? "Nothing can be sent yet." };
  }
  try {
    await sendChatMessage(
      api,
      report.relationshipId,
      { kind: "TEXT", body: input.body },
      `web:report:${input.key}`,
    );
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : "That didn't send. Nothing went out; try again.",
    };
  }
  if (input.step !== "PASS" || !report.laneOpen) {
    return { ok: true, stopped: false };
  }
  // The note went out; stopping is best effort and said if it fails.
  const stopped = await stopQWork(q, input.delegationId, input.laneId)
    .then(() => true)
    .catch(() => false);
  return { ok: true, stopped };
}
