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
  return { preamble, sections };
}

function hashOf(lines: readonly string[]): string {
  return createHash("sha256")
    .update(lines.join("\n"))
    .digest("base64url")
    .slice(0, 16);
}

/** A section is volatile once it changed in more than half of its comparisons (one is enough to start). */
const VOLATILE_MIN_SEEN = 1;
const VOLATILE_SHARE = 0.5;
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
  ) => { readonly text: string; readonly stableChars: number };
};

export function createSectionOrder(): SectionOrder {
  // Per person and kind: the last request's section hashes, by header.
  const previous = new Map<string, Map<string, string>>();
  // Per kind: how often each header changed between consecutive requests.
  const stats = new Map<
    string,
    Map<string, { seen: number; changed: number }>
  >();

  return {
    order: (kind, key, text) => {
      const parsed = sectionsOf(text);
      if (parsed.sections.length < MIN_SECTIONS)
        return { text, stableChars: 0 };
      const hashes = new Map<string, string>();
      for (const section of parsed.sections) {
        hashes.set(section.header, hashOf(section.lines));
      }
      const personKey = `${kind}|${key}`;
      const before = previous.get(personKey);
      let kindStats = stats.get(kind);
      if (kindStats === undefined) {
        kindStats = new Map();
        stats.set(kind, kindStats);
      }
      if (before !== undefined) {
        for (const [header, hash] of hashes) {
          const old = before.get(header);
          if (old === undefined) continue;
          const entry = kindStats.get(header) ?? { seen: 0, changed: 0 };
          kindStats.set(header, {
            seen: entry.seen + 1,
            changed: entry.changed + (old === hash ? 0 : 1),
          });
        }
      }
      previous.delete(personKey);
      previous.set(personKey, hashes);
      if (previous.size > KEYS_MAX) {
        const oldest = previous.keys().next().value;
        if (oldest !== undefined) previous.delete(oldest);
      }

      const volatile = (header: string): boolean => {
        const entry = kindStats.get(header);
        return (
          entry !== undefined &&
          entry.seen >= VOLATILE_MIN_SEEN &&
          entry.changed / entry.seen > VOLATILE_SHARE
        );
      };
      const stable = parsed.sections.filter((s) => !volatile(s.header));
      const moving = parsed.sections.filter((s) => volatile(s.header));
      if (moving.length === 0) return { text, stableChars: 0 };

      // Each section but the last ends on a blank line, as it did in place.
      const ordered = [...stable, ...moving].map((section, index, all) => {
        const lines = [...section.lines];
        if (index < all.length - 1 && (lines.at(-1) ?? "").trim() !== "") {
          lines.push("");
        }
        return lines;
      });
      const head = [
        ...parsed.preamble,
        ...ordered.slice(0, stable.length).flat(),
      ];
      const all = [...parsed.preamble, ...ordered.flat()];
      const rebuilt = all.join("\n");
      // The stable part ends with the newline after its last line.
      const stableChars = head.length === 0 ? 0 : head.join("\n").length + 1;
      return {
        text: rebuilt,
        stableChars: stableChars < rebuilt.length ? stableChars : 0,
      };
    },
  };
}
