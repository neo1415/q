import type { PermittedContextPlan, QSubjectRef } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { planAdmitsOwnMemory } from "./communication.js";
import { renderMemoryBundle } from "./render.js";
import type { MemoryService } from "./service.js";

/**
 * The prompt-side recall (the model gateway's QMemoryRecall, structurally):
 * the memory service's bundle rendered to bounded text, plus the person's
 * OWN past words it found (step 9), verbatim, for the claim check. Q's own
 * past words are never returned as sources: what Q said earlier grounds
 * nothing.
 *
 * Authorisation before retrieval: past turns are searched only when the
 * run's Context Firewall plan admits this very person's own conversations
 * (the actor-wide OWN_Q_CONVERSATION scope for them).
 */
export type MemoryRecallInput = {
  readonly actor: ActorContext;
  readonly conversationId?: string | undefined;
  readonly subjects: readonly QSubjectRef[];
  readonly utterance?: string | undefined;
  readonly earlierWords?: readonly string[] | undefined;
  readonly plan?: Pick<PermittedContextPlan, "scopes"> | undefined;
};

/** One earlier conversation's summary as recall rendered it (Q's own words). */
export type RecalledSummary = {
  readonly conversationId: string;
  readonly summary: string;
};

export type MemoryRecalled = {
  readonly text: string;
  readonly ownWords: readonly string[];
  /**
   * The summaries of the person's OTHER conversations recall rendered, so
   * the answer can hold their counts to this run's documents and have a
   * contradicted one superseded (never a source: Q's own words).
   */
  readonly earlierSummaries: readonly RecalledSummary[];
};

export function createMemoryRecall(memory: Pick<MemoryService, "recall">): {
  readonly recall: (input: MemoryRecallInput) => Promise<MemoryRecalled>;
} {
  return {
    recall: async (input) => {
      const companyIds = input.subjects.flatMap((s) =>
        s.kind === "COMPANY" ? [s.companyId] : [],
      );
      const bundle = await memory.recall({
        actor: input.actor,
        conversationId: input.conversationId,
        companyIds,
        utterance: input.utterance,
        earlierWords: input.earlierWords,
        ownConversationsAdmitted:
          input.plan !== undefined &&
          planAdmitsOwnMemory(input.plan, input.actor),
      });
      return {
        text: renderMemoryBundle(bundle),
        ownWords: (bundle.pastTurns ?? [])
          .filter((turn) => turn.role === "USER")
          .map((turn) => turn.content),
        earlierSummaries: [...bundle.relevant, ...bundle.otherConversations]
          .filter((c) => c.conversationId !== input.conversationId)
          .map((c) => ({
            conversationId: c.conversationId,
            summary: c.summary,
          })),
      };
    },
  };
}
