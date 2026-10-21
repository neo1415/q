import type { ActorContext } from "@capital-q/security";

import { MEMORY_QUOTE_MAX } from "./contracts.js";
import type { MemoryService } from "./service.js";

/**
 * The person corrects one thing Q remembers, in their own words (ADR
 * 0012; What Q remembers, 2026-10-21). A correction is the person's own
 * statement, so it goes through the same Write Gate as anything they tell
 * Q: the words are the quote, checked against what they wrote. The new
 * item takes the old one's type and key, so the gate supersedes the old
 * one: it stays in history, marked superseded, and is never deleted.
 *
 * Only the actor's own live memory: the item is looked up in their own
 * list, so an id that is not theirs (or not live) is NOT_FOUND.
 */
export type MemoryCorrectionOutcome =
  "CORRECTED" | "NOT_FOUND" | "SENSITIVE" | "REFUSED";

export function createMemoryCorrection(
  memory: Pick<MemoryService, "list" | "remember">,
) {
  return {
    correct: async (
      actor: ActorContext,
      memoryItemId: string,
      content: string,
    ): Promise<MemoryCorrectionOutcome> => {
      const words = content.trim();
      if (words.length < 3) return "REFUSED";
      const item = (await memory.list(actor)).find(
        (candidate) => candidate.id === memoryItemId,
      );
      if (item === undefined) return "NOT_FOUND";
      const result = await memory.remember({
        actor,
        candidate: {
          memoryType: item.memoryType,
          memoryKey: item.memoryKey,
          content: words,
          quote: words.slice(0, MEMORY_QUOTE_MAX),
          subject: item.subject,
          structuredValue: item.structuredValue,
        },
        writeMode: "USER_CONFIRMED",
        userTurns: [words],
        source: { conversationId: null, runId: null },
      });
      if (result.outcome !== "REFUSED") return "CORRECTED";
      return result.reason === "SENSITIVE_CONTENT" ? "SENSITIVE" : "REFUSED";
    },
  };
}
