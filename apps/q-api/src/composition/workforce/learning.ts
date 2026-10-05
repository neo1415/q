import { createHash } from "node:crypto";

import type { MemoryService } from "@capital-q/q-knowledge";
import type { ActorContext } from "@capital-q/security";

import type { Owner, WorkforceStore } from "./store.js";

/**
 * Agents learn from the person's feedback (founder brief J3).
 *
 * The person's approval, edit or rejection of a draft is recorded as
 * history, and what it teaches becomes a "what worked" note: the person's
 * preference about how Q writes for them, never a fact about anyone. The
 * note is written only through the memory Write Gate (ADR 0012), which
 * checks its quote against the person's own words (the text they approved
 * or wrote, or their stated reason), refuses secrets, dedupes and
 * supersedes by key. The writer and the reviewer then read the person's
 * notes beside their own guide (see `learnedNotes` and the etiquette
 * source), so the next draft starts closer to what they send.
 */

export const LEARNED_KEY_PREFIX = "workforce.what_worked";
/** How many notes reach a prompt: the most recent, bounded. */
export const LEARNED_NOTES_MAX = 6;

const EXCERPT = 280;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= EXCERPT ? flat : flat.slice(0, EXCERPT);
}

function keyOf(text: string): string {
  return `${LEARNED_KEY_PREFIX}.${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

export type DraftFeedback = {
  readonly kind: "APPROVED" | "EDITED" | "REJECTED";
  readonly editedBody?: string | undefined;
  readonly note?: string | undefined;
  readonly idempotencyKey: string;
};

export function createWorkforceLearning(dependencies: {
  readonly store: WorkforceStore;
  readonly memory?: Pick<MemoryService, "remember"> | undefined;
}) {
  return {
    /**
     * The person's word on one of their own drafts. Null: not their draft.
     * A replayed key answers the first feedback and learns nothing again.
     */
    feedback: async (
      actor: ActorContext,
      draftId: string,
      input: DraftFeedback,
    ): Promise<{
      readonly feedbackId: string;
      readonly learned: boolean;
    } | null> => {
      const owner: Owner = { tenantId: actor.tenantId, userId: actor.userId };
      const draft = await dependencies.store.draft(owner, draftId);
      if (draft === null) return null;

      // What it teaches, and the person's own words it rests on.
      const words =
        input.kind === "EDITED"
          ? (input.editedBody ?? "")
          : input.kind === "APPROVED"
            ? draft.body
            : (input.note ?? "");
      const lesson =
        input.kind === "EDITED"
          ? `When Q drafted a ${draft.channel === "EMAIL" ? "email" : "message"}${draft.counterpart_name === null ? "" : ` to ${draft.counterpart_name}`}, they rewrote it as: "${excerpt(words)}"${input.note === undefined ? "" : ` (${excerpt(input.note)})`}`
          : input.kind === "APPROVED"
            ? `They approved this ${draft.channel === "EMAIL" ? "email" : "message"} as written: "${excerpt(words)}"`
            : `They rejected a draft because: "${excerpt(words)}"`;
      const quote = excerpt(words);
      let memoryItemId: string | null = null;
      let learned = false;
      if (dependencies.memory !== undefined && quote.length >= 3) {
        const result = await dependencies.memory
          .remember({
            actor,
            candidate: {
              memoryType: "preference",
              memoryKey: keyOf(lesson),
              content: lesson.slice(0, 1_000),
              quote,
              subject: null,
              structuredValue: { draftId, kind: input.kind },
            },
            // The person's own act: their approval, their words.
            writeMode: "USER_CONFIRMED",
            userTurns: [words],
            source: { conversationId: null, runId: null },
          })
          .catch(() => null);
        if (result !== null && result.outcome === "REMEMBERED") {
          learned = true;
          memoryItemId = result.item.id;
        }
      }
      const filed = await dependencies.store.addFeedback(owner, {
        draftId,
        kind: input.kind,
        editedBody: input.kind === "EDITED" ? (input.editedBody ?? null) : null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
        memoryItemId,
      });
      if (filed === null) return null;
      return { feedbackId: filed.id, learned: filed.created && learned };
    },
  };
}

export type WorkforceLearning = ReturnType<typeof createWorkforceLearning>;

/**
 * The Approval Engine's decision on a card that offered a graded draft,
 * as feedback: approved as written, edited, or rejected (with the reason
 * they gave). Cards that offered no draft are not the workforce's.
 */
export function feedbackFromApprovals(dependencies: {
  readonly store: WorkforceStore;
  readonly learning: WorkforceLearning;
}) {
  return async (
    actor: ActorContext,
    decision: {
      readonly qActionId: string;
      readonly kind: "APPROVED" | "REJECTED" | "EDITED";
      readonly editedBody?: string | undefined;
      readonly note?: string | undefined;
    },
  ): Promise<void> => {
    const draftId = await dependencies.store.draftForAction(
      { tenantId: actor.tenantId, userId: actor.userId },
      decision.qActionId,
    );
    if (draftId === null) return;
    await dependencies.learning.feedback(actor, draftId, {
      kind: decision.kind,
      editedBody: decision.editedBody,
      note: decision.note,
      idempotencyKey: `approval:${decision.qActionId}:${decision.kind}`,
    });
  };
}

/**
 * The person's "what worked" notes, newest first, for the writer and the
 * reviewer. Read from their own live memory; failures read as none.
 */
export function learnedNotesFrom(
  items: readonly {
    readonly memoryType: string;
    readonly memoryKey: string;
    readonly content: string;
  }[],
): readonly string[] {
  return items
    .filter(
      (item) =>
        item.memoryType === "preference" &&
        item.memoryKey.startsWith(`${LEARNED_KEY_PREFIX}.`),
    )
    .slice(0, LEARNED_NOTES_MAX)
    .map((item) => item.content.slice(0, 400));
}
