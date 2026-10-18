"use server";

import { z } from "zod";

import {
  ApiProblemError,
  answerReadinessQuestion,
  dismissReadinessQuestion,
  setReadinessActionState,
  type ApiSession,
} from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * The founder's plan steps and Q's questions, server side. Server actions
 * keep the session token off the browser; the API decides whose company it
 * is. An answer carries a key made once per press, so a retry can never
 * answer twice.
 */
export type ReadinessResult =
  | { readonly ok: true; readonly remaining?: number }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const ActionKey = z.string().regex(/^[a-z0-9-]{1,40}$/);
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);
const Answer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("QUICK"),
    index: z.number().int().min(0).max(19),
  }),
  z.object({
    kind: z.literal("TYPED"),
    text: z.string().trim().min(1).max(2000),
  }),
]);

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
  ok: (out: T) => ReadinessResult,
): Promise<ReadinessResult> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    return ok(await work(session));
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError &&
        error.status < 500 &&
        error.problem?.detail !== undefined
          ? error.problem.detail
          : "Capital Q didn't answer. Try again.",
    };
  }
}

export async function markPlanStepAction(
  actionKey: string,
  done: boolean,
): Promise<ReadinessResult> {
  if (!ActionKey.safeParse(actionKey).success) {
    return { ok: false, message: "That step isn't on your plan." };
  }
  return run(
    (session) => setReadinessActionState(session, actionKey, done),
    () => ({ ok: true }),
  );
}

export async function answerQuestionAction(
  questionId: string,
  answer: unknown,
  key: string,
): Promise<ReadinessResult> {
  const parsed = Answer.safeParse(answer);
  if (
    !Id.safeParse(questionId).success ||
    !Key.safeParse(key).success ||
    !parsed.success
  ) {
    return { ok: false, message: "Pick an answer, or type one." };
  }
  return run(
    (session) => answerReadinessQuestion(session, questionId, parsed.data, key),
    (out) => ({ ok: true, remaining: out.remaining }),
  );
}

export async function setAsideQuestionAction(
  questionId: string,
  key: string,
): Promise<ReadinessResult> {
  if (!Id.safeParse(questionId).success || !Key.safeParse(key).success) {
    return { ok: false, message: "That question isn't waiting any more." };
  }
  return run(
    (session) => dismissReadinessQuestion(session, questionId, key),
    (out) => ({ ok: true, remaining: out.remaining }),
  );
}
