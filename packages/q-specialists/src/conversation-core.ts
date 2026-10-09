import { z } from "zod";

import type { QuestionSequence } from "@capital-q/q-core";
import type { QToolFocus } from "@capital-q/q-runtime";

import type { LastAction } from "./references.js";

/**
 * RECOVERY-2026-10 B3 (audit B-02): the conversation core's state --
 * unclear turns in a row, the last action ("try again", "same for X"), a
 * question series in progress, and the last tool focus -- kept on the
 * conversation so a deploy or a second q-api instance continues where
 * the last turn left off. Memory stays the first read (fast, and the
 * fallback); the durable copy is written after each turn and read once per
 * conversation per process. Server-written conversational texture, never
 * a source of fact; validated on the way back in like any stored input.
 */

export type ConversationCoreScope = {
  readonly tenantId: string;
  readonly conversationId: string;
};

export type ConversationCoreSnapshot = {
  readonly unclearInARow: number;
  readonly lastAction: LastAction | null;
  readonly sequence: QuestionSequence | null;
  readonly focus: QToolFocus | null;
};

/** Where the snapshot is kept; q-api composes it over the conversation row. */
export type ConversationCoreStore = {
  readonly load: (scope: ConversationCoreScope) => Promise<unknown>;
  readonly save: (
    scope: ConversationCoreScope,
    snapshot: ConversationCoreSnapshot & { readonly v: 1 },
  ) => Promise<void>;
};

const Text = z.string().max(4_000);

const SnapshotSchema = z.object({
  v: z.literal(1),
  unclearInARow: z.number().int().min(0).max(50),
  lastAction: z
    .object({
      tool: z.string().min(1).max(120),
      arguments: z.record(z.string(), z.unknown()).nullable(),
      utterance: Text,
      outcome: z.enum(["PREPARED", "SAID", "WAITING", "NOT_DONE"]),
    })
    .nullable(),
  sequence: z
    .object({
      topic: z.string().min(1).max(400),
      total: z.number().int().min(1).max(100),
      asked: z.number().int().min(0).max(100),
    })
    .nullable(),
  focus: z
    .object({
      areas: z.array(z.string().max(80)).max(40),
      tools: z.array(z.string().max(120)).max(200),
      widen: z.boolean().optional(),
    })
    .nullable(),
});

/** A stored snapshot, or null when it is absent or not one we wrote. */
export function readCoreSnapshot(
  stored: unknown,
): ConversationCoreSnapshot | null {
  const read = SnapshotSchema.safeParse(stored);
  if (!read.success) return null;
  const { focus, unclearInARow, lastAction, sequence } = read.data;
  return {
    unclearInARow,
    lastAction,
    sequence,
    focus:
      focus === null
        ? null
        : {
            areas: focus.areas,
            tools: focus.tools,
            ...(focus.widen === undefined ? {} : { widen: focus.widen }),
          },
  };
}

/** A read that takes longer than this answers from memory instead. */
export const CORE_LOAD_DEADLINE_MS = 300;

export function loadWithin<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work.catch(() => null), late]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * The conversation row's bound is 16,384 characters of jsonb text, which
 * is longer than the JSON written (a space after every ":" and ","). Live
 * 2026-10-09 a snapshot broke that check and the turn's state was lost.
 * Kept well under it here: the tool focus goes first (it is recomputed
 * next turn), then the last action. Never a partial or invalid snapshot.
 */
export const CORE_SNAPSHOT_MAX_CHARS = 11_000;

export function boundedCoreSnapshot<S extends ConversationCoreSnapshot>(
  snapshot: S,
): S {
  const fits = (candidate: S) =>
    JSON.stringify(candidate).length <= CORE_SNAPSHOT_MAX_CHARS &&
    SnapshotSchema.safeParse({ ...candidate, v: 1 }).success;
  if (fits(snapshot)) return snapshot;
  const unfocused: S = { ...snapshot, focus: null };
  if (fits(unfocused)) return unfocused;
  const bare: S = { ...unfocused, lastAction: null };
  return fits(bare) ? bare : { ...bare, sequence: null };
}
