import type { ActorContext } from "@capital-q/security";

import {
  communicationPreferenceKey,
  type CommunicationAspect,
  type PreferencePersistence,
} from "./communication.js";
import type { MemoryService } from "./service.js";

/**
 * The `note_preference` tool's port over the ADR 0012 memory Write Gate
 * (CQ-QX-007 P0-5). Structurally the q-tools `PreferenceNotePort`; kept
 * here because the memory context owns what a preference is and how it is
 * written, and q-tools does not depend on it.
 *
 * Nothing is written except through `memory.remember`, which verifies the
 * quote against the person's own words, refuses secrets, dedupes and
 * supersedes by key. The model chose the aspect and the value from a
 * closed vocabulary; the key, the owner, the write mode and the lifetime's
 * scope are this code's.
 */
export type PreferenceNote = {
  readonly aspect: CommunicationAspect;
  readonly value: string;
  readonly persistence: PreferencePersistence;
  readonly quote: string;
  readonly latestUserText: string | null;
};

export type PreferenceNoteResult = {
  readonly outcome: "REMEMBERED" | "UNCHANGED" | "REFUSED";
  readonly reason: string;
};

export function createPreferenceNotebook(options: {
  readonly memory: Pick<MemoryService, "remember">;
  readonly actor: ActorContext;
  /**
   * The conversation a SESSION preference belongs to (a Q conversation or
   * an onboarding session). Null: only LONG_TERM preferences can be kept.
   */
  readonly sessionKey: string | null;
  /** The person's own earlier words in this conversation, for the quote check. */
  readonly priorUserTurns: readonly string[];
  /** Provenance, only when these are real Q conversation and run ids. */
  readonly source?:
    | {
        readonly conversationId: string | null;
        readonly runId: string | null;
      }
    | undefined;
}): {
  readonly ownerUserId: string;
  readonly note: (note: PreferenceNote) => Promise<PreferenceNoteResult>;
} {
  return {
    ownerUserId: options.actor.userId,
    note: async (note) => {
      if (note.persistence === "SESSION" && options.sessionKey === null) {
        return { outcome: "REFUSED", reason: "NO_SESSION" };
      }
      const result = await options.memory.remember({
        actor: options.actor,
        candidate: {
          memoryType: "preference",
          memoryKey: communicationPreferenceKey(
            note.aspect,
            note.persistence,
            options.sessionKey,
          ),
          // Deterministic words about the preference, never the model's.
          content: `Communication preference${note.persistence === "SESSION" ? " for this conversation" : ""}: ${note.aspect} ${note.value}.`,
          quote: note.quote,
          subject: null,
          structuredValue: { [note.aspect]: note.value },
        },
        writeMode: "Q_PROPOSED",
        userTurns: [
          ...(note.latestUserText === null ? [] : [note.latestUserText]),
          ...options.priorUserTurns,
        ],
        source: options.source ?? { conversationId: null, runId: null },
      });
      return { outcome: result.outcome, reason: result.reason };
    },
  };
}
