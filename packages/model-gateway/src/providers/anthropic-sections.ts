import { createHash } from "node:crypto";

/**
 * Stable sections first, for Anthropic's prefix cache (live 2026-11-06).
 *
 * Anthropic caches a prompt only up to a breakpoint, and only while every
 * byte before it is unchanged. Q's rendered prompts put per-turn sections
 * (what was established, THIS TURN) ahead of the large ones that hold
 * still across a conversation (AUTHORISED FACTS), so each turn's first
 * call re-wrote most of its prompt: live, ~8.7k of ~31k input tokens read
 * from cache and 13-17k written again, at 1.25x input, on every turn.
 * OpenAI caches any shared prefix and is unaffected; its prompt is not
 * touched.
 *
 * So, for the Anthropic request only, the first user message's sections
 * are reordered: those that have held still between one person's
 * consecutive requests of the same kind come first, in their original
 * order; those that change most of the time come after, in THEIR
 * original order, so the person's own message stays last. Nothing is
 * added, removed or rewritten. A section is a header line (capitals) after
 * a blank line, up to the next header; text inside an untrusted-content
 * fence never counts as a header, so fetched content cannot move or split
 * a fence. Only hashes of section text are kept, keyed by the gateway's
 * hashed cache key (tenant, user, task class, tools), never the text.
 */

const HEADER = /^[A-Z][A-Z0-9 ,'’()/&:-]{5,}$/;
const FENCE_OPEN = "<<<UNTRUSTED_CONTENT";
const FENCE_CLOSE = "<<<END_UNTRUSTED_CONTENT>>>";

export type PromptSection = {
  readonly header: string;
  readonly lines: readonly string[];
};

export type PromptSections = {
  readonly preamble: readonly string[];
  readonly sections: readonly PromptSection[];
};

export function sectionsOf(text: string): PromptSections {
  const lines = text.split("\n");
  const preamble: string[] = [];
  const sections: { header: string; lines: string[] }[] = [];
  let fenced = 0;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const header =
      fenced === 0 &&
      HEADER.test(trimmed) &&
      (index === 0 || (lines[index - 1] ?? "").trim() === "");
    if (header) {
      sections.push({ header: trimmed, lines: [line] });
    } else {
      (sections.at(-1)?.lines ?? preamble).push(line);
    }
    if (trimmed.startsWith(FENCE_OPEN)) fenced += 1;
    if (trimmed.startsWith(FENCE_CLOSE) && fenced > 0) fenced -= 1;
  }
  return { preamble, sections: sections.flatMap(paragraphsOf) };
}

/**
 * A long paragraph inside a section is its own unit, so a large stable
 * block that follows something volatile in the same section (the
 * analyst's ~10k-character output instruction after the person's
 * message) can join the cached head. Short paragraphs stay with what
 * precedes them. A blank line inside an untrusted fence never splits.
 */
const PARAGRAPH_UNIT_MIN_CHARS = 2_000;

function paragraphsOf(section: PromptSection): PromptSection[] {
  const units: { header: string; lines: string[] }[] = [
    { header: section.header, lines: [] },
  ];
  let paragraph: string[] = [];
  let fenced = 0;
  let count = 0;
  const flush = (): void => {
    if (paragraph.length === 0) return;
    const size = paragraph.join("\n").length;
    const current = units.at(-1);
    if (
      current !== undefined &&
      current.lines.length > 0 &&
      size >= PARAGRAPH_UNIT_MIN_CHARS
    ) {
      count += 1;
      units.push({
        header: `${section.header} ¶${String(count)}`,
        lines: paragraph,
      });
    } else {
      current?.lines.push(...paragraph);
    }
    paragraph = [];
  };
  for (const line of section.lines) {
    const trimmed = line.trim();
    paragraph.push(line);
    if (trimmed.startsWith(FENCE_OPEN)) fenced += 1;
    if (trimmed.startsWith(FENCE_CLOSE) && fenced > 0) fenced -= 1;
    if (trimmed === "" && fenced === 0) flush();
  }
  flush();
  return units;
}

function hashOf(lines: readonly string[]): string {
  return createHash("sha256")
    .update(lines.join("\n"))
    .digest("base64url")
    .slice(0, 16);
}

/** A section is volatile once it changed in more than half of its comparisons (one is enough to start). */
const VOLATILE_MIN_SEEN = 1;
const KEYS_MAX = 512;
const MIN_SECTIONS = 3;

export type SectionOrder = {
  /**
   * The text with stable sections first, and how many characters from the
   * start are the stable part (0 when nothing was learned or moved).
   */
  readonly order: (
    kind: string,
    key: string,
    text: string,
    /**
     * The notes that follow the first user message (Q's trusted SYSTEM
     * notes, said as marked user-turn notes). Their stability is learned
     * the same way; the indexes of those that hold still come back in
     * `stableNotes`, to be placed after the stable head.
     */
    notes?: readonly string[],
  ) => {
    readonly text: string;
    readonly stableChars: number;
    readonly stableNotes: readonly number[];
  };
};

/**
 * The sections in `order` (headers, most stable first), and where the
 * leading `stableCount` of them end.
 */
function arrange(
  text: string,
  parsed: PromptSections,
  order: readonly string[],
  stableCount: number,
): { readonly text: string; readonly stableChars: number } {
  const byHeader = new Map(parsed.sections.map((s) => [s.header, s]));
  const sections = order
    .map((header) => byHeader.get(header))
    .filter((s): s is PromptSection => s !== undefined);
  const moved = sections.some((s, i) => s !== parsed.sections[i]);
  // Each section but the last ends on a blank line, as it did in place.
  const lines = sections.map((section, index) => {
    const own = [...section.lines];
    if (index < sections.length - 1 && (own.at(-1) ?? "").trim() !== "") {
      own.push("");
    }
    return own;
  });
  const rebuilt = moved
    ? [...parsed.preamble, ...lines.flat()].join("\n")
    : text;
  const head = [...parsed.preamble, ...lines.slice(0, stableCount).flat()];
  // The stable part ends with the newline after its last line.
  const stableChars =
    stableCount === 0 || head.length === 0 ? 0 : head.join("\n").length + 1;
  return {
    text: rebuilt,
    stableChars: stableChars < rebuilt.length ? stableChars : 0,
  };
}

type PersonState = {
  /** The whole first-message text's hash: a repeat within a turn. */
  readonly textHash: string;
  readonly sections: ReadonlyMap<string, string>;
  /** The decision made for that text, reused for every repeat of it. */
  readonly order: readonly string[];
  readonly stableCount: number;
  readonly stableNotes: readonly number[];
};

/**
 * Sections that changed in at most this share of comparisons are the
 * cached head: they hold still from turn to turn, so the breakpoint after
 * them sits where the previous turn wrote it.
 */
const STABLE_SHARE = 0.1;

export function createSectionOrder(): SectionOrder {
  // Per person and kind: the last DISTINCT request's section hashes, and
  // the order decided for it.
  const previous = new Map<string, PersonState>();
  // Per kind: how often each header changed between one person's
  // consecutive distinct requests.
  const stats = new Map<
    string,
    Map<string, { seen: number; changed: number }>
  >();

  return {
    order: (kind, key, text, notes = []) => {
      const parsed = sectionsOf(text);
      if (parsed.sections.length < MIN_SECTIONS) {
        return { text, stableChars: 0, stableNotes: [] };
      }
      const personKey = `${kind}|${key}`;
      const textHash = hashOf([text, ...notes]);
      const noteId = (note: string): string => `note:${note.slice(0, 64)}`;
      const before = previous.get(personKey);
      // A repeat (the tool rounds and the answer of one turn send the same
      // prompt): the same order as before, and nothing learned from it.
      // Counting repeats made every section look stable and flipped the
      // order between the calls of one turn (live 2026-11-06, ~30% reads).
      if (before !== undefined && before.textHash === textHash) {
        return {
          ...arrange(text, parsed, before.order, before.stableCount),
          stableNotes: before.stableNotes,
        };
      }
      const sections = new Map<string, string>();
      for (const section of parsed.sections) {
        sections.set(section.header, hashOf(section.lines));
      }
      for (const note of notes) sections.set(noteId(note), hashOf([note]));
      let kindStats = stats.get(kind);
      if (kindStats === undefined) {
        kindStats = new Map();
        stats.set(kind, kindStats);
      }
      if (before !== undefined) {
        for (const [header, hash] of sections) {
          const old = before.sections.get(header);
          if (old === undefined) continue;
          const entry = kindStats.get(header) ?? { seen: 0, changed: 0 };
          kindStats.set(header, {
            seen: entry.seen + 1,
            changed: entry.changed + (old === hash ? 0 : 1),
          });
        }
      }
      const learned = kindStats;
      const shareOf = (header: string): number => {
        const entry = learned.get(header);
        return entry === undefined || entry.seen < VOLATILE_MIN_SEEN
          ? 0
          : entry.changed / entry.seen;
      };
      // Most stable first, by tenths so a small shift in the counts does
      // not reorder (and re-write) the prompt; ties keep their place.
      const ranked = parsed.sections
        .map((section, index) => ({
          header: section.header,
          share: shareOf(section.header),
          index,
        }))
        .sort(
          (a, b) =>
            Math.round(a.share * 10) - Math.round(b.share * 10) ||
            a.index - b.index,
        );
      const order = ranked.map((r) => r.header);
      let stableCount = 0;
      while (
        stableCount < ranked.length &&
        (ranked[stableCount]?.share ?? 1) <= STABLE_SHARE
      ) {
        stableCount += 1;
      }
      // Nothing learned yet: every share is 0 and nothing moves.
      if (stableCount === ranked.length) stableCount = 0;
      // Notes join the cached head only once seen holding still.
      const stableNotes =
        stableCount === 0
          ? []
          : notes.flatMap((note, index) => {
              const entry = learned.get(noteId(note));
              return entry !== undefined &&
                entry.seen >= VOLATILE_MIN_SEEN &&
                entry.changed / entry.seen <= STABLE_SHARE
                ? [index]
                : [];
            });
      previous.delete(personKey);
      previous.set(personKey, {
        textHash,
        sections,
        order,
        stableCount,
        stableNotes,
      });
      if (previous.size > KEYS_MAX) {
        const oldest = previous.keys().next().value;
        if (oldest !== undefined) previous.delete(oldest);
      }
      return { ...arrange(text, parsed, order, stableCount), stableNotes };
    },
  };
}
