import type {
  DeckFact,
  DeckSectionReading,
  DeckSetAside,
} from "@capital-q/contracts";

/**
 * F26: a deterministic check of Q's deck reading against the deck's own
 * text, run before a reading is stored. No model.
 *
 * Every figure Q cites as "the deck says X" must occur in the deck's
 * extracted text, compared by value after normalising (commas, thin
 * spaces, "bn"/"billion"/"B", "%"/"percent"). Seed evidence: Q read
 * ₦2.5bn as also ₦5bn, 1.4% as 4%, and 410,000 as 241,000, then told the
 * founder their own deck contradicted itself.
 *
 *   a CONTRADICTORY section citing a figure the deck never states:
 *     set aside (UNCLEAR, no summary, LOW), keeping only facts that check
 *   a fact Q presents as the deck's own figure (USER_CLAIM, FIGURE) that
 *     the deck never states: dropped
 *
 * Q_INFERENCE facts are Q's own derivations and are not the deck's words,
 * so they are not checked here. A figure the deck does state is never
 * touched: a real contradiction stays a contradiction.
 */

type Figure = { readonly value: number; readonly percent: boolean };

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
};

const NUMBER =
  /(?<![\d.,])(\d{1,3}(?:[,   ]\d{3})+|\d+)(?:\.(\d+))?\s?(%|percent|per cent|trillion|billion|million|thousand|tn|bn|mn|mm|k|m|b|t)?(?![a-z\d])/giu;

function normalise(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function key(figure: Figure): string {
  return `${figure.percent ? "p" : "n"}:${String(Number(figure.value.toPrecision(6)))}`;
}

type Token = Figure & {
  readonly text: string;
  readonly suffixed: boolean;
  readonly raw: number;
};

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const match of normalise(text).matchAll(NUMBER)) {
    const whole = (match[1] ?? "").replace(/[,   ]/gu, "");
    const raw = Number(
      `${whole}${match[2] === undefined ? "" : `.${match[2]}`}`,
    );
    if (!Number.isFinite(raw)) continue;
    const unit = match[3]?.toLowerCase();
    const percent = unit === "%" || unit === "percent" || unit === "per cent";
    const scale = unit === undefined || percent ? 1 : (SCALE[unit] ?? 1);
    out.push({
      text: match[0].trim(),
      value: raw * scale,
      raw,
      percent,
      suffixed: unit !== undefined && !percent,
    });
  }
  return out;
}

/**
 * A cited figure worth checking: a percentage, a scaled amount, or a
 * number of at least 1,000 that is not a bare year. Small counts ("3
 * founders") and years are too common to prove anything either way.
 */
function material(token: Token): boolean {
  if (token.percent || token.suffixed) return true;
  const year =
    Number.isInteger(token.raw) && token.raw >= 1900 && token.raw <= 2100;
  return token.raw >= 1000 && !year;
}

/** The deck's figures, by value (scaled and as written). */
export function deckFigureIndex(deckText: string): ReadonlySet<string> {
  const index = new Set<string>();
  for (const token of tokens(deckText)) {
    index.add(key(token));
    if (!token.percent) index.add(key({ value: token.raw, percent: false }));
  }
  return index;
}

/** The material figures in `text` that the deck's text never states. */
export function unverifiedFigures(
  text: string | null,
  index: ReadonlySet<string>,
): string[] {
  if (text === null) return [];
  return tokens(text)
    .filter(material)
    .filter((token) => !index.has(key(token)))
    .map((token) => token.text);
}

function claimsDeckFigure(fact: DeckFact): boolean {
  return fact.truthClass === "USER_CLAIM" && fact.kind === "FIGURE";
}

export type DeckVerification = {
  readonly sections: DeckSectionReading[];
  readonly setAside: DeckSetAside[];
};

export function verifyDeckReading(
  sections: readonly DeckSectionReading[],
  deckText: string,
): DeckVerification {
  const index = deckFigureIndex(deckText);
  const setAside: DeckSetAside[] = [];
  const checked = sections.map((section): DeckSectionReading => {
    const missing = new Set<string>();
    const facts = section.facts.filter((fact) => {
      if (!claimsDeckFigure(fact) && fact.unknownReason !== "CONTRADICTORY") {
        return true;
      }
      const bad = unverifiedFigures(fact.value, index);
      for (const figure of bad) missing.add(figure);
      return bad.length === 0;
    });
    const contradiction = section.status === "CONTRADICTORY";
    const summaryBad = contradiction
      ? unverifiedFigures(section.summary, index)
      : [];
    for (const figure of summaryBad) missing.add(figure);
    if (missing.size > 0) {
      setAside.push({
        section: section.section,
        figures: [...missing].slice(0, 8).map((f) => f.slice(0, 60)),
      });
    }
    // A contradiction resting on any figure the deck never states is not
    // the deck's: the whole claim is set aside, not half-kept.
    if (contradiction && missing.size > 0) {
      return {
        ...section,
        status: "UNCLEAR",
        summary: null,
        facts: facts.filter((fact) => fact.unknownReason !== "CONTRADICTORY"),
        confidence: "LOW",
      };
    }
    return facts.length === section.facts.length
      ? section
      : { ...section, facts };
  });
  return { sections: checked, setAside };
}
