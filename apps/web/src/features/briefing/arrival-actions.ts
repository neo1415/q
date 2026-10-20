"use server";

import { z } from "zod";

import { readBriefingCommand } from "@capital-q/api-client";
import {
  BriefingCommandRequestSchema,
  type BriefingCommandRequest,
  type BriefingCommandResultDto,
} from "@capital-q/contracts";
import { sameShownMessage } from "@capital-q/q-core/speech";

import { sendChatMessageAction } from "@/features/chat/chat-actions";
import {
  approveQApprovalAction,
  readQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";
import { qApiSession } from "@/features/q/context";
import { retryHeldAction } from "@/features/work/held-actions";

import type { ArrivalData } from "./arrival";
import { shownOf } from "./arrival-read";
import {
  readArrivalBriefing,
  type ArrivalBrowserInput,
} from "./arrival-briefing-server";

/**
 * The arrival briefing's reads and its one decision path (Zino,
 * 2026-10-08), on the server under the person's own session. The cards
 * are the Work page's decision queue, read the same way (decisions.ts),
 * so the two never disagree about what needs them. Every decision goes
 * through the actions the Work page uses: the Approval Engine's approve
 * and reject (which bind to the payload the server holds), and the
 * person's own message for an edit.
 */

/**
 * The briefing's read as a server action, for callers that have no route
 * to hand. The browser's arrival uses `/api/q-arrival` instead: server
 * actions run one at a time per tab, so this read used to wait behind
 * Home's other actions (notices, the conversation, approvals) and hold
 * them in turn (speed lane 2026-10-20; audit C-08).
 */
export async function arrivalBriefingAction(
  rawSince: string | null,
  rawBrowser?: ArrivalBrowserInput,
): Promise<ArrivalData | null> {
  return readArrivalBriefing(rawSince, rawBrowser);
}

const Id = z.string().uuid();
const DecideInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("APPROVE"),
    approvalId: Id,
    /** What the person was shown; the decision is refused if it differs. */
    shown: z.string().max(8_000).nullable(),
  }),
  z.object({
    kind: z.literal("SEND_EDITED"),
    relationshipId: Id,
    body: z.string().trim().min(1).max(4_000),
    idempotencyKey: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/u),
    replacesApprovalId: Id.nullable(),
  }),
  z.object({ kind: z.literal("DISMISS_APPROVAL"), approvalId: Id }),
  z.object({
    kind: z.literal("RETRY_HELD"),
    draftId: Id,
    relationshipId: Id.nullable(),
    idempotencyKey: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/u),
  }),
]);

export type ArrivalDecision = z.input<typeof DecideInput>;

export type ArrivalDecisionResult =
  | {
      readonly ok: true;
      /** What came of it, when more than "done" (a retry's outcome). */
      readonly message?: string | undefined;
      /** New cards may be waiting: read the briefing again. */
      readonly reload?: true | undefined;
    }
  | {
      readonly ok: false;
      readonly message: string;
      /** The card changed since it was shown: read it again. */
      readonly changed?: true;
    };

/**
 * One decision on one card, as the person made it (a button, or their own
 * words read by code). Input from the browser, validated here; the server
 * resolves who they are and verifies its own payload hash on approve.
 */
export async function decideArrivalCardAction(
  raw: ArrivalDecision,
): Promise<ArrivalDecisionResult> {
  const parsed = DecideInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "That didn't go through. Nothing was sent." };
  }
  const input = parsed.data;
  switch (input.kind) {
    case "APPROVE": {
      // Approval binds to exactly what was seen: read it again first.
      const view = await readQApprovalAction(input.approvalId).catch(
        () => null,
      );
      if (view?.ok !== true || !view.value.canDecide) {
        return {
          ok: false,
          message: "Already decided or expired. Nothing more is sent from it.",
          changed: true,
        };
      }
      const now = shownOf(view.value);
      if (!sameShownMessage(input.shown, now.message ?? now.preview)) {
        return {
          ok: false,
          message: "It changed since you saw it. Here's the current version.",
          changed: true,
        };
      }
      const result = await approveQApprovalAction(input.approvalId).catch(
        () => null,
      );
      return result?.ok === true
        ? { ok: true }
        : {
            ok: false,
            message:
              result?.message ?? "That didn't go through. Nothing was sent.",
          };
    }
    case "SEND_EDITED": {
      const sent = await sendChatMessageAction(
        input.relationshipId,
        { kind: "TEXT", body: input.body },
        input.idempotencyKey,
      ).catch(() => null);
      if (sent?.ok !== true) {
        return {
          ok: false,
          message: sent?.message ?? "That didn't send. Try again.",
        };
      }
      // Their own message went; the card Q drafted is declined.
      if (input.replacesApprovalId !== null) {
        await rejectQApprovalAction(input.replacesApprovalId).catch(() => null);
      }
      return { ok: true };
    }
    case "RETRY_HELD": {
      const result = await retryHeldAction({
        draftId: input.draftId,
        relationshipId: input.relationshipId,
        idempotencyKey: input.idempotencyKey,
      });
      return result.ok
        ? { ok: true, message: result.message, reload: true }
        : { ok: false, message: result.message };
    }
    case "DISMISS_APPROVAL": {
      const result = await rejectQApprovalAction(input.approvalId).catch(
        () => null,
      );
      return result?.ok === true
        ? { ok: true }
        : { ok: false, message: "That didn't go through. Try again." };
    }
  }
}

/**
 * The person's own words about the cards on their screen, read into card
 * verbs (Zino, 2026-10-08). Changes nothing: the card sequence in the
 * browser runs each verb and checks it against the same words. A failed
 * read is "unclear", never a guess.
 */
export async function readArrivalWordsAction(
  raw: BriefingCommandRequest,
): Promise<BriefingCommandResultDto> {
  const unclear: BriefingCommandResultDto = { actions: [], unclear: true };
  const parsed = BriefingCommandRequestSchema.safeParse(raw);
  if (!parsed.success) return unclear;
  const session = await qApiSession();
  if (session === null) return unclear;
  return readBriefingCommand(session, parsed.data).catch(() => unclear);
}
