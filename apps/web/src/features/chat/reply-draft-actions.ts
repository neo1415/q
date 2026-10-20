"use server";

import { z } from "zod";

import { isTerminalQRunStatus } from "@capital-q/contracts";

import { askQAction, readQRunAction } from "@/features/q/actions";

/**
 * "Draft a reply" in a conversation (inbox split, 2026-10-20): Q is asked,
 * through the same Q run every question takes (the Q API authorises the
 * relationship subject and answers from this side's own fold), for a short
 * reply the person then edits. The draft only fills the composer: it is
 * never sent, and nothing reaches the other side until the person presses
 * Send.
 */

export type ReplyDraftResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Name = z.string().trim().min(1).max(200);

export async function startReplyDraftAction(
  relationshipId: string,
  counterpart: string,
): Promise<ReplyDraftResult<{ readonly runId: string }>> {
  const id = Id.safeParse(relationshipId);
  const name = Name.safeParse(counterpart);
  if (!id.success || !name.success) {
    return { ok: false, message: "Q couldn't draft that. Try again." };
  }
  const started = await askQAction(
    `Draft a short reply from me to ${name.data}'s latest message in our conversation, for me to edit before I send it. Answer with the message text only.`,
    undefined,
    { relationshipId: id.data },
  );
  return started.ok
    ? { ok: true, value: { runId: started.value.runId } }
    : started;
}

/** Where the draft is: still being written, written, or not to be had. */
export async function readReplyDraftAction(runId: string): Promise<
  ReplyDraftResult<{
    readonly done: boolean;
    readonly text: string | null;
  }>
> {
  const read = await readQRunAction(runId);
  if (!read.ok) return read;
  const run = read.value;
  if (!isTerminalQRunStatus(run.status)) {
    return { ok: true, value: { done: false, text: null } };
  }
  if (run.status !== "COMPLETED") {
    return { ok: false, message: "Q couldn't draft a reply just now." };
  }
  const answer = (run.messages ?? [])
    .filter((message) => message.role === "Q")
    .map((message) => message.text ?? "")
    .filter((text) => text.trim() !== "")
    .at(-1);
  return { ok: true, value: { done: true, text: answer?.trim() ?? null } };
}
