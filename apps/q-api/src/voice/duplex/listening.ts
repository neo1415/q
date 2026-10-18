import {
  Q_VOICE_LISTENING_LEVELS,
  QVoiceListeningLevelSchema,
  type QVoiceListeningLevel,
} from "@capital-q/contracts";
import type { MemoryService } from "@capital-q/q-knowledge";
import type { ActorContext } from "@capital-q/security";

import type { LISTENING_CHANGES } from "./instructions.js";

/**
 * BACKCHANNEL: how much Q reacts while a person talks, remembered per
 * person through the memory Write Gate (ADR 0012), never by the model.
 *
 * The model proposes a change from a closed set with the person's quote;
 * this code resolves the level, writes a `preference` item under one
 * fixed key (supersede-by-key keeps one live value), and the gate checks
 * the quote against the provider's transcript of what the person said.
 * The item shows on their memory page, where they can forget it, which
 * returns them to the default.
 */

export const LISTENING_MEMORY_KEY = "preference.voice.listening";

export type ListeningChange = (typeof LISTENING_CHANGES)[number];

export function isListeningChange(value: unknown): value is ListeningChange {
  return (
    value === "OFF" ||
    value === "LESS" ||
    value === "MORE" ||
    value === "SUBTLE" ||
    value === "NATURAL"
  );
}

/** Deterministic: LESS and MORE step one level, and stop at the ends. */
export function nextListeningLevel(
  current: QVoiceListeningLevel,
  change: ListeningChange,
): QVoiceListeningLevel {
  if (change !== "LESS" && change !== "MORE") return change;
  const index = Q_VOICE_LISTENING_LEVELS.indexOf(current);
  const next = Math.min(
    Q_VOICE_LISTENING_LEVELS.length - 1,
    Math.max(0, index + (change === "MORE" ? 1 : -1)),
  );
  return Q_VOICE_LISTENING_LEVELS[next] ?? current;
}

const WORDS: Record<QVoiceListeningLevel, string> = {
  OFF: "no listening sounds or bridging lines while they talk or wait",
  SUBTLE: "subtle listening sounds while they talk",
  NATURAL: "natural, more frequent listening sounds while they talk",
};

export type RememberedListening = {
  readonly level: QVoiceListeningLevel;
  /** ISO timestamp of when it was set. */
  readonly setAt: string;
};

export type DuplexListeningStore = {
  readonly read: (actor: ActorContext) => Promise<RememberedListening | null>;
  /** True when it was kept (or already was); false when the gate refused. */
  readonly remember: (input: {
    readonly actor: ActorContext;
    readonly level: QVoiceListeningLevel;
    readonly quote: string;
    /** The provider's transcripts of the person's latest turns. */
    readonly heard: readonly string[];
  }) => Promise<boolean>;
};

export function createMemoryListeningStore(
  memory: Pick<MemoryService, "list" | "remember">,
): DuplexListeningStore {
  return {
    read: async (actor) => {
      const items = await memory.list(actor);
      const item = items.find(
        (candidate) =>
          candidate.memoryType === "preference" &&
          candidate.memoryKey === LISTENING_MEMORY_KEY &&
          candidate.validTo === null,
      );
      if (item === undefined) return null;
      const level = QVoiceListeningLevelSchema.safeParse(
        item.structuredValue.listening,
      );
      return level.success
        ? { level: level.data, setAt: item.validFrom }
        : null;
    },
    remember: async ({ actor, level, quote, heard }) => {
      const result = await memory.remember({
        actor,
        candidate: {
          memoryType: "preference",
          memoryKey: LISTENING_MEMORY_KEY,
          // Deterministic words, never the model's.
          content: `Voice preference: ${WORDS[level]}.`,
          quote,
          subject: null,
          structuredValue: { listening: level },
        },
        writeMode: "Q_PROPOSED",
        userTurns: heard,
        source: { conversationId: null, runId: null },
      });
      return result.outcome !== "REFUSED";
    },
  };
}
