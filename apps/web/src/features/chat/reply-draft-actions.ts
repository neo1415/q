"use server";

import { z } from "zod";

import { isTerminalQRunStatus } from "@capital-q/contracts";

import {
  askQAction,
  pendingQApprovalsAction,
  readQApprovalAction,
  readQRunAction,
  rejectQApprovalAction,
} from "@/features/q/actions";

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

/** The action Q prepares when it drafts a message for approval. */
const CHAT_MESSAGE_SEND = "chat.message.send";
/** What the approval preview adds when the message also shares a file. */
const SHARES_SUFFIX = /\n\n\(shares one of your documents\)$/u;
/**
 * Q's turn when it prepared the message for approval instead of answering
 * with the text (app-actions readyToSendLine):
 * `Message Zino Aviation: "Hi …". Ready to send: approve on the card, …`.
 */
const READY_TO_SEND = /^[^:\n]{1,240}: "([\s\S]+)"\. Ready to send: [^\n]*$/u;

/** Only the message body, never Q's sentence around it. */
function messageBodyOf(answer: string): string {
  const text = answer.trim();
  return READY_TO_SEND.exec(text)?.[1]?.trim() ?? text;
}

/**
 * The body of a message Q prepared for approval in this run, read from the
 * approval's exact content (the preview the approval binds to is the
 * message body). The draft goes to the composer for the person to edit
 * and send themselves, so Q's prepared copy is declined: no second card
 * waits to send the old words. Null when the run prepared no message.
 */
async function preparedBody(runId: string): Promise<string | null> {
  const pending = await pendingQApprovalsAction();
  if (!pending.ok) return null;
  for (const item of pending.value) {
    if (item.runId !== runId) continue;
    const view = await readQApprovalAction(item.approvalId);
    if (!view.ok || view.value.action.actionType !== CHAT_MESSAGE_SEND) {
      continue;
    }
    const preview = view.value.action.preview?.replace(SHARES_SUFFIX, "");
    if (preview === undefined || preview.trim() === "") continue;
    await rejectQApprovalAction(item.approvalId);
    return preview.trim();
  }
  return null;
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
  // Q prepared the message for approval: the draft is its exact body
  // (waiting on any other approval, there is no draft to wait for).
  if (run.status === "AWAITING_APPROVAL") {
    const body = await preparedBody(runId);
    return { ok: true, value: { done: true, text: body } };
  }
  if (!isTerminalQRunStatus(run.status)) {
    return { ok: true, value: { done: false, text: null } };
  }
  if (run.status !== "COMPLETED") {
    return { ok: false, message: "Q couldn't draft a reply just now." };
  }
  const prepared = await preparedBody(runId);
  if (prepared !== null) {
    return { ok: true, value: { done: true, text: prepared } };
  }
  const answer = (run.messages ?? [])
    .filter((message) => message.role === "Q")
    .map((message) => message.text ?? "")
    .filter((text) => text.trim() !== "")
    .at(-1);
  return {
    ok: true,
    value: {
      done: true,
      text: answer === undefined ? null : messageBodyOf(answer),
    },
  };
}
