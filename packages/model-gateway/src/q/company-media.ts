import {
  parseQResultBlocks,
  type PitchSummaryDto,
  type QCompanyMediaBlock,
  type QResultBlock,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * A8 (owner directive 13 Nov 2026: rich media must not stay behind). When
 * someone talks with Q about a company, the answer can show that company's
 * own Capital Q media: its profile picture when the turn is about the
 * company as a whole, and its pitch when they ask to watch it.
 *
 * Three decisions, three owners, none of them a word rule:
 *
 * - WHETHER media was asked for is the turn reader's (TURN_READER v86
 *   `companyMedia`, by meaning, in any language). Unread: no media.
 * - WHICH company is the run's: the company subjects the answer already
 *   references (authorised against the run, never named by a model).
 * - WHAT this reader may see is the media context's, asked per company
 *   through `QCompanyMediaPort` under the reader's own actor: the
 *   company's own picture under its visibility, and a pitch only where
 *   the playback rule lets them play it now. The block then grants
 *   nothing: the browser asks for the picture and a signed playback
 *   authorization under its own session when it draws them.
 *
 * No media spam: one block per company, pictures for at most
 * COMPANY_MEDIA_COMPANIES_MAX companies, and a pitch only when the answer
 * is about exactly one company (one active player).
 */

export type QCompanyMediaRead = {
  /** The company's canonical name, when the media context read it. */
  readonly name: string | null;
  /** Its own Capital Q picture is shown to this reader. */
  readonly image: boolean;
  /** The pitch this reader may play now, or null. */
  readonly pitch: PitchSummaryDto | null;
};

export type QCompanyMediaPort = {
  /**
   * The media of each company this reader may see. A company they may not
   * see is absent; an unreadable read is absent. `pitch` false: pitches
   * are not read (no playback check is spent on an unasked turn).
   */
  readonly read: (input: {
    readonly actor: ActorContext;
    readonly companyIds: readonly string[];
    readonly pitch: boolean;
  }) => Promise<ReadonlyMap<string, QCompanyMediaRead>>;
};

/** How the turn reader read the turn (v86); absent: not read. */
export type QCompanyMediaAsk = {
  readonly pitch: boolean;
  readonly picture: boolean;
};

/**
 * The ask from a turn reading (TURN_READER v86 `companyMedia`): absent
 * when unread, not written, or neither part asked.
 */
export function companyMediaAskOf(
  reading:
    | {
        readonly companyMedia?:
          | { readonly pitch: boolean; readonly picture: boolean }
          | null
          | undefined;
      }
    | null
    | undefined,
): QCompanyMediaAsk | undefined {
  const media = reading?.companyMedia;
  if (media === undefined || media === null) return undefined;
  if (!media.pitch && !media.picture) return undefined;
  return { pitch: media.pitch, picture: media.picture };
}

/** Pictures for at most this many companies (a comparison of up to four). */
export const COMPANY_MEDIA_COMPANIES_MAX = 4;

export type QCompanyMediaPlan = {
  readonly companyIds: readonly string[];
  /** Read and show the pitch (exactly one company, asked by meaning). */
  readonly pitch: boolean;
  /** Show the picture. */
  readonly picture: boolean;
};

/**
 * Which companies get media on this answer, and which media, from the
 * reading and the answer's own company references. Null: none.
 */
export function companyMediaPlan(input: {
  readonly ask: QCompanyMediaAsk | undefined;
  readonly subjects: readonly QSubjectRef[];
}): QCompanyMediaPlan | null {
  const ask = input.ask;
  if (ask === undefined || (!ask.pitch && !ask.picture)) return null;
  const companyIds = [
    ...new Set(
      input.subjects.flatMap((subject) =>
        subject.kind === "COMPANY" ? [subject.companyId] : [],
      ),
    ),
  ];
  if (companyIds.length === 0) return null;
  // One active player: a pitch only for the one company the turn is about.
  const pitch = ask.pitch && companyIds.length === 1;
  if (!pitch && !ask.picture) return null;
  return {
    companyIds: pitch
      ? companyIds
      : companyIds.slice(0, COMPANY_MEDIA_COMPANIES_MAX),
    pitch,
    picture: ask.picture,
  };
}

/**
 * The media blocks for a plan, from what the media context said this
 * reader may see. A company with nothing permitted gets no block; a name
 * is the run's reading first, the media context's second, and a company
 * with neither is left out rather than shown unnamed.
 */
export function companyMediaBlocks(input: {
  readonly plan: QCompanyMediaPlan;
  readonly read: ReadonlyMap<string, QCompanyMediaRead>;
  /** Names this run already read (company id -> name). */
  readonly names?: ReadonlyMap<string, string> | undefined;
}): QCompanyMediaBlock[] {
  const blocks: QCompanyMediaBlock[] = [];
  for (const companyId of input.plan.companyIds) {
    const media = input.read.get(companyId);
    if (media === undefined) continue;
    const name = (input.names?.get(companyId) ?? media.name ?? "").trim();
    if (name.length === 0) continue;
    const pitch = input.plan.pitch ? media.pitch : null;
    // The picture rides with the pitch they asked for (the same company,
    // once), and alone only when the turn is about the company as a whole.
    const image = media.image && (input.plan.picture || pitch !== null);
    if (!image && pitch === null) continue;
    blocks.push({
      kind: "COMPANY_MEDIA",
      companyId,
      name: name.slice(0, 160),
      image,
      pitch,
    });
  }
  // Parsed, never asserted: a block the contract refuses is dropped.
  return parseQResultBlocks(blocks).blocks.filter(
    (block): block is QCompanyMediaBlock => block.kind === "COMPANY_MEDIA",
  );
}

/**
 * The whole step: plan, read under the reader's actor, build. Any failure
 * of the read is no media -- the answer is complete without it.
 */
export async function companyMediaFor(input: {
  readonly ask: QCompanyMediaAsk | undefined;
  readonly subjects: readonly QSubjectRef[];
  readonly actor: ActorContext;
  readonly port: QCompanyMediaPort | undefined;
  readonly names?: ReadonlyMap<string, string> | undefined;
  /** Blocks already on the answer: a company already shown gets no more. */
  readonly already?: readonly QResultBlock[] | undefined;
}): Promise<QCompanyMediaBlock[]> {
  if (input.port === undefined) return [];
  const plan = companyMediaPlan({ ask: input.ask, subjects: input.subjects });
  if (plan === null) return [];
  const shown = new Set(
    (input.already ?? []).flatMap((block) =>
      block.kind === "COMPANY_MEDIA" ? [block.companyId] : [],
    ),
  );
  const companyIds = plan.companyIds.filter((id) => !shown.has(id));
  if (companyIds.length === 0) return [];
  const read = await input.port
    .read({ actor: input.actor, companyIds, pitch: plan.pitch })
    .catch(() => new Map<string, QCompanyMediaRead>());
  return companyMediaBlocks({
    plan: { ...plan, companyIds },
    read,
    names: input.names,
  });
}

/**
 * A sentence saying Q could not open, play or show something, or that its
 * attempt did not go through: the answer's own account of a screen act.
 */
const COULD_NOT_SHOW =
  /^\s*(?:sorry,?\s+)?(?:(?:unfortunately,?\s+)?i\s+(?:couldn['’]t|could\s+not|can['’]t|cannot|wasn['’]t\s+able\s+to|was\s+unable\s+to|was\s+not\s+able\s+to)\s+(?:\w+\s+){0,2}?(?:open|play|show|load|pull\s+up|bring\s+up|display|start)\b|i\s+tried,?\s+but\b)/iu;
/** What the failed act was about: the pitch, its video, or the screen. */
const ABOUT_THE_PITCH = /\b(?:pitch|video|workspace|screen|pane|player)\b/iu;

/**
 * Live 13 Nov 2026 (d96c63ee1): "Play me their pitch." played inline (the
 * answer's COMPANY_MEDIA pitch), yet the reply said "I couldn't open the
 * pitch in the workspace … I tried, but it didn't go through": the model
 * had also tried to open it on screen (a `show` refused), and the
 * could-not line followed. With the pitch in the answer, that attempt is
 * not what they asked for, so neither failure is said. Only applied when
 * a pitch block this reader may play is in the answer -- never otherwise,
 * so a pitch that is not there still gets its honest line. With nothing
 * left, the reply says what is there.
 */
export function withoutPitchFailureTalk(
  text: string,
  couldNot: string | null,
  pitchOf: string,
): { readonly text: string; readonly removed: number } {
  const parts = text.split(/\n{2,}/u);
  let removed = 0;
  const kept = parts
    .map((part) => {
      if (couldNot !== null && part.trim() === couldNot.trim()) {
        removed += 1;
        return "";
      }
      const sentences = part.match(/[^.!?\n]+[.!?…]*\s*/gu) ?? [part];
      const left = sentences.filter((sentence) => {
        const failed =
          COULD_NOT_SHOW.test(sentence) && ABOUT_THE_PITCH.test(sentence);
        if (failed) removed += 1;
        return !failed;
      });
      return left.join("").trim();
    })
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
  if (removed === 0) return { text, removed: 0 };
  return {
    text: kept.length > 0 ? kept : `Here's ${pitchOf}'s pitch.`,
    removed,
  };
}
