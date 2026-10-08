"use server";

import { z } from "zod";

import { retryWorkforceDraft } from "@capital-q/api-client";

import { sendChatMessageAction } from "@/features/chat/chat-actions";
import { qApiSession } from "@/features/q/context";

/**
 * A message Q held (Zino, 2026-10-08: "if I even wanted to approve it, I
 * have no way to do so"): send it as it is, after "Send this exact
 * message?", or ask Q to write and review it again. On the server, under
 * the person's own session; every input is from the browser.
 */

export type HeldOutcome =
  | {
      readonly ok: true;
      /** Retry: the rewrite passed and waits as an approval card. */
      readonly offered?: boolean | undefined;
      readonly message: string;
    }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/u);

const SendInput = z
  .object({
    relationshipId: Id,
    /** Exactly the text the person confirmed. */
    body: z.string().trim().min(1).max(4_000),
    idempotencyKey: Key,
  })
  .strict();

/**
 * "Send as is": the person's own send of exactly the text they confirmed.
 * The key is bound to that text by the caller, so a second press of the
 * same confirmation is the same send.
 */
export async function sendHeldAsIsAction(
  raw: z.input<typeof SendInput>,
): Promise<HeldOutcome> {
  const parsed = SendInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "That didn't send. Nothing was sent." };
  }
  const sent = await sendChatMessageAction(
    parsed.data.relationshipId,
    { kind: "TEXT", body: parsed.data.body },
    parsed.data.idempotencyKey,
  ).catch(() => null);
  return sent?.ok === true
    ? { ok: true, message: "Sent, exactly as shown." }
    : { ok: false, message: sent?.message ?? "That didn't send. Try again." };
}

const RETRY_WORDS: Readonly<Record<string, string>> = {
  NOT_HELD: "That message was already handled or replaced.",
  NOT_SUPPORTED:
    "Q can't write this one again here. Send it as it is, or edit it.",
  NOT_ACTIVE:
    "The instruction behind it is paused or stopped, so Q can't write it again.",
  NOT_IN_REACH: "That conversation isn't one Q may write in any more.",
};

const RetryInput = z
  .object({
    draftId: Id,
    relationshipId: Id.nullable(),
    idempotencyKey: Key,
  })
  .strict();

/**
 * "Ask Q to try again": written and reviewed again now. A pass becomes an
 * ordinary approval card (nothing is sent from here); a second hold says
 * why, in Needs you.
 */
export async function retryHeldAction(
  raw: z.input<typeof RetryInput>,
): Promise<HeldOutcome> {
  const parsed = RetryInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "That didn't go through. Try again." };
  }
  const session = await qApiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to ask Q." };
  }
  const answer = await retryWorkforceDraft(
    session,
    parsed.data.draftId,
    parsed.data.relationshipId,
    parsed.data.idempotencyKey,
  ).catch(() => null);
  if (answer === null) {
    return { ok: false, message: "Q couldn't try again just now. Try later." };
  }
  switch (answer.outcome) {
    case "OFFERED":
      return {
        ok: true,
        offered: true,
        message:
          "Q wrote it again and the reviewer passed it. It's waiting for your approval.",
      };
    case "HELD":
      return {
        ok: true,
        offered: false,
        message:
          "Q tried again and held it again. The new draft is in Needs you, with why.",
      };
    case "UNAVAILABLE":
      return {
        ok: false,
        message:
          RETRY_WORDS[answer.reason] ??
          "Q couldn't try again just now. Try later.",
      };
  }
}
