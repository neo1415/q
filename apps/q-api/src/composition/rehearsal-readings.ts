import {
  PERSONA_FORWARDNESS,
  PERSONA_MOODS,
  PERSONA_TRAIT_SOURCES,
  REHEARSAL_APPRAISALS_V4,
  REHEARSAL_CONCLUSIONS,
  REHEARSAL_DIMENSIONS,
  REHEARSAL_LINE_MOODS_V4,
  REHEARSAL_MOVES,
  REHEARSAL_RATINGS,
  type CounterpartPersonaStored,
  type PresenceReading,
  type RehearsalReviewResult,
  type RehearsalTurnV7Result,
} from "@capital-q/q-core";

/**
 * Rehearsal readings, accepted field by field (REHEARSE P0, founder
 * 2026-10-01: "this should never be happening, at all"). A model's reading
 * is never refused whole for one field: a label outside its set, a missing
 * key, a wrong type, an over-long line or list, an extra key -- each field
 * is read on its own, kept when usable, cut to its bound when long, and
 * otherwise replaced by its plain, unremarkable value. A reading is null
 * only when it has nothing usable at all (no object, or a turn with no
 * words to say). The stored schemas still bound everything after this.
 */

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Cut at a word, so a trimmed line still reads. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** A string field: trimmed and bounded, or the fallback. */
export function text(
  value: unknown,
  max: number,
  fallback: string,
  min = 1,
): string {
  if (typeof value === "number" || typeof value === "boolean") {
    value = String(value);
  }
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length < min ? fallback : cut(trimmed, max);
}

/** A label from a fixed set: the set's spelling, or the fallback. */
export function label<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== "string") return fallback;
  const spelled = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(spelled)
    ? (spelled as T)
    : fallback;
}

/** An optional label: null unless it is in the set. */
function labelOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (typeof value !== "string") return null;
  const spelled = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(spelled)
    ? (spelled as T)
    : null;
}

export function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  return fallback;
}

/** A list of lines: usable items kept, bad ones dropped, bounded. */
export function lines(
  value: unknown,
  count: number,
  max: number,
  min = 3,
): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return items
    .map((item) => text(item, max, "", min))
    .filter((item) => item.length >= min)
    .slice(0, count);
}

function records(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

// ---------------------------------------------------------------------------

/** The persona, as stored (v2 shape plus v4 stance), from any reading. */
export function readPersona(raw: unknown): CounterpartPersonaStored | null {
  if (!isRecord(raw)) return null;
  const temperament = isRecord(raw["temperament"]) ? raw["temperament"] : {};
  const questions = records(raw["likelyQuestions"])
    .map((q) => ({
      question: text(q["question"], 300, "", 3),
      why: text(q["why"], 200, "It matters to them.", 3),
    }))
    .filter((q) => q.question.length >= 3)
    .slice(0, 12);
  const traits = records(raw["knownTraits"])
    .map((t) => ({
      trait: text(t["trait"], 200, "", 3),
      source: label(t["source"], PERSONA_TRAIT_SOURCES, "PUBLIC"),
    }))
    .filter((t) => t.trait.length >= 3)
    .slice(0, 8);
  return {
    summary: text(raw["summary"], 600, "Little is known about them yet."),
    style: text(raw["style"], 300, "Not known yet."),
    temperament: {
      baseline: label(temperament["baseline"], PERSONA_MOODS, "NEUTRAL"),
      warmsTo: lines(temperament["warmsTo"], 5, 200),
      coolsOn: lines(temperament["coolsOn"], 5, 200),
    },
    priorities: lines(raw["priorities"], 6, 200),
    likelyQuestions:
      questions.length > 0
        ? questions
        : [
            {
              question: "Tell me about what you're building.",
              why: "Where any first meeting starts.",
            },
          ],
    likelyAnswers: records(raw["likelyAnswers"])
      .map((a) => ({
        topic: text(a["topic"], 120, "", 3),
        answer: text(a["answer"], 400, "", 3),
      }))
      .filter((a) => a.topic.length >= 3 && a.answer.length >= 3)
      .slice(0, 10),
    pushbacks: lines(raw["pushbacks"], 6, 200),
    howToWin: lines(raw["howToWin"], 6, 200),
    dealbreakers: lines(raw["dealbreakers"], 5, 200),
    grounding: label(
      raw["grounding"],
      ["THIN", "SOME", "RICH"] as const,
      "THIN",
    ),
    forwardness: label(raw["forwardness"], PERSONA_FORWARDNESS, "TYPICAL"),
    forwardnessWhy: text(raw["forwardnessWhy"], 300, "No sign either way.", 0),
    knownTraits: traits,
  };
}

/** A camera presence reading, or null when there is nothing clear. */
export function readPresence(raw: unknown): PresenceReading | null {
  if (!isRecord(raw)) return null;
  const clear = <T extends string>(value: unknown, allowed: readonly T[]) =>
    label(value, allowed, "UNCLEAR" as T);
  return {
    gaze: clear(raw["gaze"], [
      "AT_CAMERA",
      "READING_OFF_SCREEN",
      "LOOKING_AWAY",
      "UNCLEAR",
    ] as const),
    distracted: flag(raw["distracted"], false),
    framing: clear(raw["framing"], ["GOOD", "POOR", "UNCLEAR"] as const),
    lighting: clear(raw["lighting"], ["GOOD", "POOR", "UNCLEAR"] as const),
    background: clear(raw["background"], ["CALM", "BUSY", "UNCLEAR"] as const),
    company: flag(raw["company"], false),
    confident: flag(raw["confident"], false),
  };
}

/** A played line: null only when there are no words to say. */
export function readTurn(raw: unknown): RehearsalTurnV7Result | null {
  if (!isRecord(raw)) return null;
  const onlyNoise = flag(raw["onlyNoise"], false);
  const line = text(raw["line"], 700, "");
  // Noise needs no words; anything else with none is no turn at all.
  if (line.length === 0 && !onlyNoise) return null;
  const move = label(raw["move"], REHEARSAL_MOVES, "REMARK");
  const conclusion = labelOrNull(raw["conclusion"], REHEARSAL_CONCLUSIONS);
  return {
    appraisal: label(raw["appraisal"], REHEARSAL_APPRAISALS_V4, "NEUTRAL"),
    line,
    // A close with no conclusion still closes, undecided.
    move,
    mood: label(raw["mood"], REHEARSAL_LINE_MOODS_V4, "NEUTRAL"),
    intensity: label(
      raw["intensity"],
      ["SOFT", "NORMAL", "RAISED"] as const,
      "NORMAL",
    ),
    reaction: labelOrNull(raw["reaction"], [
      "LAUGH",
      "CHUCKLE",
      "SIGH",
      "CRY",
    ] as const),
    conclusion: move === "CLOSE" ? (conclusion ?? "INDECISIVE") : null,
    presence: readPresence(raw["presence"]),
    askedToSee: flag(raw["askedToSee"], false),
    wantsToEnd: flag(raw["wantsToEnd"], false),
    onlyNoise,
  };
}

/** The review: null only when not one dimension could be read. */
export function readReview(raw: unknown): RehearsalReviewResult | null {
  if (!isRecord(raw)) return null;
  const seen = new Set<string>();
  const dimensions = records(raw["dimensions"])
    .flatMap((d) => {
      const name = labelOrNull(d["name"], REHEARSAL_DIMENSIONS);
      if (name === null || seen.has(name)) return [];
      seen.add(name);
      return [
        {
          name,
          rating: label(d["rating"], REHEARSAL_RATINGS, "SOLID"),
          note: text(d["note"], 300, "No note.", 3),
        },
      ];
    })
    .slice(0, 5);
  if (dimensions.length === 0) return null;
  return {
    overall: text(raw["overall"], 600, "A rehearsal worth repeating."),
    dimensions,
    wentRight: records(raw["wentRight"])
      .map((w) => ({
        moment: text(w["moment"], 300, "", 3),
        why: text(w["why"], 300, "It helped.", 3),
      }))
      .filter((w) => w.moment.length >= 3)
      .slice(0, 5),
    wentWrong: records(raw["wentWrong"])
      .map((w) => ({
        moment: text(w["moment"], 300, "", 3),
        why: text(w["why"], 300, "It cost you.", 3),
        better: text(w["better"], 500, "Answer it directly, with a number.", 3),
      }))
      .filter((w) => w.moment.length >= 3)
      .slice(0, 6),
    tips: lines(raw["tips"], 6, 300),
  };
}
