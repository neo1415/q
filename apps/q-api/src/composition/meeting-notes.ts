import { randomUUID } from "node:crypto";

import type { MeetingNotesComposer } from "@capital-q/communication";
import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  MeetingNotesV3ResultSchema,
  renderPrompt,
  type MeetingNotesV3Result,
  type MeetingNotesV3Variables,
} from "@capital-q/q-core";

/**
 * The meeting record (ADR 0027), written through the model gateway by task
 * class like every other model call (MEETING_NOTES v3). The transcript goes
 * to the provider the gateway picks for CONFIDENTIAL work; the meeting
 * assistant service keeps it with the record.
 */
const NOTES_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.08,
  maxOutputTokens: 3_000,
  attemptTimeoutMs: 60_000,
} as const;

export const MEETING_NOTES_COMPOSER_VERSION = "meeting-notes.v3";

export function createMeetingNotesComposer(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): MeetingNotesComposer {
  const registry = createDefaultPromptRegistry();
  return {
    compose: async (input) => {
      const rendered = renderPrompt<MeetingNotesV3Variables>(registry, {
        task: "MEETING_NOTES",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You write from the call's captions only; captions can mishear names and numbers.",
        variables: {
          purpose: input.purpose,
          organiserName: input.organiserName,
          transcript: input.transcript,
          callDate: input.callDate,
        },
      });
      const runId = randomUUID();
      try {
        const response =
          await dependencies.gateway.execute<MeetingNotesV3Result>(
            {
              taskClass: "STRUCTURED_EXTRACTION",
              sensitivity: "CONFIDENTIAL",
              ...(dependencies.dataPosture === undefined
                ? {}
                : { dataPosture: dependencies.dataPosture }),
              budget: NOTES_BUDGET,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: {
                purpose: "MEETING",
                tenantId: input.tenantId,
                userId: input.userId,
                correlationId: `cor_${runId}`,
              },
            },
            { schema: MeetingNotesV3ResultSchema },
          );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = MeetingNotesV3ResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) return null;
        return {
          summary: parsed.data.summary,
          flags: parsed.data.flags,
          followUps: parsed.data.followUps,
          attendees: parsed.data.attendees,
          agreements: parsed.data.agreements,
          commitments: parsed.data.commitments,
          nextSteps: parsed.data.nextSteps,
          composerVersion: MEETING_NOTES_COMPOSER_VERSION,
        };
      } catch (error: unknown) {
        dependencies.logger?.warn({ err: error }, "meeting notes not written");
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 2026-10-20 (meetings speed): rolling notes. The record used to be written
// only after the call ended, from the whole transcript: one long model call
// (15-40 s) between the end of the call and its notes. Now drafts are
// written while the call is live, off the speaking path, and when it ends
// only what was said since the last draft is read and merged in code.
// ---------------------------------------------------------------------------

type NotesInput = Parameters<MeetingNotesComposer["compose"]>[0];
type Notes = NonNullable<Awaited<ReturnType<MeetingNotesComposer["compose"]>>>;

/** What a draft needs besides the transcript (the meeting's own booking). */
export type MeetingNotesDraftMeta = Omit<
  NotesInput,
  "transcript" | "meetingId"
>;

export type MeetingNotesDrafts = {
  /** The live record grew: a draft is written when enough is new. */
  readonly observe: (
    meetingId: string,
    meta: MeetingNotesDraftMeta,
    transcript: string,
  ) => void;
  /** The call ended: what came after the last draft is read now. */
  readonly finish: (
    meetingId: string,
    meta: MeetingNotesDraftMeta,
    transcript: string,
  ) => void;
};

/** The first draft once this much has been said (about two minutes). */
const FIRST_DRAFT_CHARS = 2_000;
/** Then each time the record grows by this much, or by DRAFT_GROWTH. */
const NEXT_DRAFT_CHARS = 2_500;
const DRAFT_GROWTH = 0.35;
/** Drafts a call at most (a long call's drafts stay a few cents). */
const MAX_DRAFTS = 12;
/** A tail longer than this share of the call is composed whole instead. */
const TAIL_SHARE_MAX = 0.6;
/** Words the provider may add past the end of the live record (a "bye"). */
const TAIL_WORDS_IGNORED = 12;
const ANCHOR_WORDS = 8;
const STATE_TTL_MS = 6 * 3_600_000;

type Covered = { readonly notes: Notes; readonly covered: string };
type DraftState = {
  draft: Covered | null;
  final: Covered | null;
  inflight: Promise<void> | null;
  finishing: Promise<void> | null;
  drafts: number;
  at: number;
};

/** A transcript's words, per line, without the "Speaker:" label. */
function wordsByLine(
  transcript: string,
): { readonly line: number; readonly word: string }[] {
  const out: { line: number; word: string }[] = [];
  transcript.split("\n").forEach((raw, line) => {
    const colon = raw.indexOf(": ");
    const text = colon >= 0 && colon < 130 ? raw.slice(colon + 2) : raw;
    for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length > 0) out.push({ line, word });
    }
  });
  return out;
}

/**
 * What `transcript` holds past what `covered` already covered, matched by
 * the last words a person said in `covered` (Q's own lines come back
 * differently in the provider's captions). Null when they cannot be matched.
 */
export function tailPast(covered: string, transcript: string): string | null {
  const people = covered
    .split("\n")
    .filter((line) => !line.startsWith("Q: "))
    .join("\n");
  const anchor = wordsByLine(people)
    .slice(-ANCHOR_WORDS)
    .map((w) => w.word);
  if (anchor.length < 4) return null;
  const words = wordsByLine(transcript);
  for (let i = words.length - anchor.length; i >= 0; i -= 1) {
    if (anchor.every((word, k) => words[i + k]?.word === word)) {
      const end = words[i + anchor.length - 1];
      if (end === undefined) return null;
      // The tail starts after the anchor's line; when the anchor ends
      // mid-line, that line rides along (a few words of overlap).
      const nextLine = words[i + anchor.length]?.line;
      const from =
        nextLine === undefined || nextLine !== end.line
          ? end.line + 1
          : end.line;
      return transcript.split("\n").slice(from).join("\n").trim();
    }
  }
  return null;
}

const key = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The draft's items, then the tail's new ones; the newest kept within a cap. */
function joined<T>(
  base: readonly T[],
  tail: readonly T[],
  max: number,
  text: (item: T) => string,
): T[] {
  const seen = new Set(base.map((item) => key(text(item))));
  const all = [...base, ...tail.filter((item) => !seen.has(key(text(item))))];
  return all.length > max ? all.slice(all.length - max) : all;
}

/**
 * The draft's notes with what the tail added, by code. Nothing in the tail
 * is dropped for coming late; the summary stays the draft's, with the
 * tail's own added when the tail held anything to record.
 */
export function mergeNotes(base: Notes, tail: Notes): Notes {
  const substantive =
    tail.agreements.length +
      tail.commitments.length +
      (tail.nextSteps?.length ?? 0) +
      tail.flags.length >
    0;
  const summary =
    substantive && tail.summary.trim().length > 0
      ? `${base.summary.trim()} ${tail.summary.trim()}`.slice(0, 1_500)
      : base.summary;
  const attendees = [...base.attendees];
  for (const person of tail.attendees) {
    const known = attendees.findIndex((a) => key(a.name) === key(person.name));
    if (known < 0) attendees.push(person);
    else if (attendees[known]?.side === null && person.side !== null) {
      attendees[known] = person;
    }
  }
  return {
    summary,
    flags: joined(base.flags, tail.flags, 12, (f) => f.text),
    followUps: joined(base.followUps, tail.followUps, 10, (f) => f.text),
    attendees: attendees.slice(0, 20),
    agreements: joined(base.agreements, tail.agreements, 12, (a) => a),
    commitments: joined(base.commitments, tail.commitments, 10, (c) => c.quote),
    nextSteps: joined(
      base.nextSteps ?? [],
      tail.nextSteps ?? [],
      8,
      (n) => n.what,
    ),
    composerVersion: base.composerVersion,
  };
}

export type RollingMeetingNotes = MeetingNotesComposer &
  MeetingNotesDrafts & {
    /** Settles a meeting's pending draft and finish (tests). */
    readonly idle: (meetingId: string) => Promise<void>;
  };

export function createRollingMeetingNotes(
  composer: MeetingNotesComposer,
  options: {
    readonly now?: () => number;
    readonly logger?: Logger | undefined;
  } = {},
): RollingMeetingNotes {
  const now = options.now ?? (() => Date.now());
  const states = new Map<string, DraftState>();

  const stateOf = (meetingId: string): DraftState => {
    let state = states.get(meetingId);
    if (state === undefined) {
      for (const [id, old] of states) {
        if (now() - old.at > STATE_TTL_MS) states.delete(id);
      }
      state = {
        draft: null,
        final: null,
        inflight: null,
        finishing: null,
        drafts: 0,
        at: now(),
      };
      states.set(meetingId, state);
    }
    state.at = now();
    return state;
  };

  const composeSafely = (input: NotesInput) =>
    composer.compose(input).catch((error: unknown) => {
      options.logger?.warn({ err: error }, "meeting notes draft failed");
      return null;
    });

  /** The tail read alone and merged into `base`; null when it failed. */
  async function withTail(
    base: Covered,
    meta: MeetingNotesDraftMeta,
    tail: string,
  ): Promise<Notes | null> {
    if (tail.trim().length === 0) return base.notes;
    const read = await composeSafely({ ...meta, transcript: tail });
    return read === null ? null : mergeNotes(base.notes, read);
  }

  return {
    observe: (meetingId, meta, transcript) => {
      const state = stateOf(meetingId);
      if (
        state.inflight !== null ||
        state.finishing !== null ||
        state.final !== null ||
        state.drafts >= MAX_DRAFTS
      ) {
        return;
      }
      const covered = state.draft?.covered.length ?? 0;
      const due =
        covered === 0
          ? FIRST_DRAFT_CHARS
          : Math.max(NEXT_DRAFT_CHARS, covered * DRAFT_GROWTH);
      if (transcript.length - covered < due) return;
      state.drafts += 1;
      state.inflight = composeSafely({ ...meta, transcript })
        .then((notes) => {
          if (notes !== null) state.draft = { notes, covered: transcript };
        })
        .finally(() => {
          state.inflight = null;
        });
    },
    finish: (meetingId, meta, transcript) => {
      const state = stateOf(meetingId);
      if (state.finishing !== null || transcript.trim().length === 0) return;
      state.finishing = (async () => {
        await state.inflight;
        const base = state.draft;
        const tail = base === null ? null : tailPast(base.covered, transcript);
        const notes =
          base !== null &&
          tail !== null &&
          tail.length <= transcript.length * TAIL_SHARE_MAX
            ? await withTail(base, meta, tail)
            : await composeSafely({ ...meta, transcript });
        if (notes !== null) state.final = { notes, covered: transcript };
      })().catch((error: unknown) => {
        options.logger?.warn({ err: error, meetingId }, "notes not finished");
      });
    },
    compose: async (input) => {
      const state =
        input.meetingId === undefined ? undefined : states.get(input.meetingId);
      if (state === undefined || input.meetingId === undefined) {
        return composer.compose(input);
      }
      states.delete(input.meetingId);
      await state.inflight;
      await state.finishing;
      const meta: MeetingNotesDraftMeta = {
        tenantId: input.tenantId,
        userId: input.userId,
        purpose: input.purpose,
        organiserName: input.organiserName,
        callDate: input.callDate,
      };
      // The provider's transcript against the live record Q already read:
      // what it adds past the end is read alone, never the whole call again.
      for (const base of [state.final, state.draft]) {
        if (base === null) continue;
        const tail = tailPast(base.covered, input.transcript);
        if (tail === null) continue;
        if (tail.length > input.transcript.length * TAIL_SHARE_MAX) break;
        if (
          base === state.final &&
          wordsByLine(tail).length <= TAIL_WORDS_IGNORED
        ) {
          return base.notes;
        }
        const notes = await withTail(base, meta, tail);
        if (notes !== null) return notes;
        break;
      }
      return composer.compose(input);
    },
    idle: async (meetingId) => {
      const state = states.get(meetingId);
      await state?.inflight;
      await state?.finishing;
    },
  };
}
