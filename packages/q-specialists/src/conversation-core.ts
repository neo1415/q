import { z } from "zod";

import {
  DISCOVERY_EXIT_REASONS,
  type DiscoveryState,
  type QuestionSequence,
} from "@capital-q/q-core";
import type {
  QOpenResolution,
  QResolutionCounterparty,
  QToolFocus,
} from "@capital-q/q-runtime";

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
  /**
   * C3 (13 Nov 2026): the offer Q's last answer closed with, bound by code
   * to a tool of that run, with that run's id -- so a yes after a deploy or
   * on another instance binds to it. Optional: a snapshot written before
   * it carries none.
   */
  readonly offer?: CoreOffer | null | undefined;
  /**
   * Live 14 Nov 2026 (D12-D14): the open resolution item -- a material
   * uncertainty about a counterparty Q offered to resolve through the
   * route the stage allows -- so a later "request that" binds to it after
   * a deploy or on another instance. Optional: older snapshots carry none.
   */
  readonly resolution?: QOpenResolution | null | undefined;
  /**
   * HQ-5: discovery's state (q-core state.ts), so the questions already
   * asked, the cap and a "just show me" hold after a deploy and on every
   * instance. Optional: older snapshots carry none (not in discovery).
   */
  readonly discovery?: DiscoveryState | null | undefined;
  /**
   * VOICE-FIX: what they asked Q to leave out, held until they name it
   * again (q-core exclusions.ts). Optional: older snapshots carry none.
   */
  readonly excluded?: readonly string[] | undefined;
};

/** A recorded action offer, as the core keeps it (answer.ts RecordedOffer). */
export type CoreOffer = {
  readonly runId: string;
  readonly action: string;
  readonly request: string;
  readonly said: string;
  /** Addendum 14 Nov 2026: the uncertainty it resolves; absent: none. */
  readonly about?:
    { readonly statement: string; readonly standing: string } | undefined;
  /** D13: whom the offer goes to; absent: not resolved. */
  readonly counterparty?: QResolutionCounterparty | undefined;
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

const About = z.object({
  statement: z.string().min(1).max(400),
  standing: z.string().min(1).max(40),
});

const Counterparty = z.object({
  kind: z.literal("COMPANY"),
  id: z.string().min(1).max(64),
  name: z.string().max(200).nullable(),
});

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
      readsOnly: z.boolean().optional(),
    })
    .nullable(),
  offer: z
    .object({
      runId: z.string().min(1).max(120),
      action: z.string().min(1).max(120),
      request: z.string().min(1).max(400),
      said: z.string().min(1).max(400),
      about: About.optional(),
      counterparty: Counterparty.optional(),
    })
    .nullable()
    .optional(),
  resolution: z
    .object({
      runId: z.string().min(1).max(120),
      action: z.string().min(1).max(120),
      counterparty: Counterparty,
      about: About,
      title: z.string().min(1).max(200),
    })
    .nullable()
    .optional(),
  discovery: z
    .object({
      active: z.boolean(),
      asked: z.array(z.string().min(1).max(40)).max(32),
      underspecifiedInARow: z.number().int().min(0).max(50),
      exited: z.enum(DISCOVERY_EXIT_REASONS).nullable(),
    })
    .nullable()
    .optional(),
  excluded: z.array(z.string().min(1).max(80)).max(8).optional(),
});

/**
 * HQ-5: whether a stored snapshot has the conversation in discovery, so a
 * voice line opened on it takes turns patiently. Anything unreadable: no.
 */
export function discoveryActiveIn(stored: unknown): boolean {
  return readCoreSnapshot(stored)?.discovery?.active === true;
}

/** A stored snapshot, or null when it is absent or not one we wrote. */
export function readCoreSnapshot(
  stored: unknown,
): ConversationCoreSnapshot | null {
  const read = SnapshotSchema.safeParse(stored);
  if (!read.success) return null;
  const {
    focus,
    unclearInARow,
    lastAction,
    sequence,
    offer,
    resolution,
    discovery,
    excluded,
  } = read.data;
  return {
    unclearInARow,
    lastAction,
    sequence,
    ...(discovery === undefined || discovery === null ? {} : { discovery }),
    ...(excluded === undefined || excluded.length === 0 ? {} : { excluded }),
    ...(offer === undefined || offer === null ? {} : { offer }),
    ...(resolution === undefined || resolution === null ? {} : { resolution }),
    focus:
      focus === null
        ? null
        : {
            areas: focus.areas,
            tools: focus.tools,
            ...(focus.widen === undefined ? {} : { widen: focus.widen }),
            ...(focus.readsOnly === undefined
              ? {}
              : { readsOnly: focus.readsOnly }),
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
