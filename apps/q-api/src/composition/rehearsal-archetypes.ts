import { createHash } from "node:crypto";

/**
 * Founder brief P3 (2026-10-06): the investors Q plays in a rehearsal must
 * not all sound alike. Each persona is matched, deterministically and by
 * code, to one questioning archetype -- how they open, the order they go
 * in, their habits, and how far they follow a thread -- composed into the
 * turn as trusted text (INVESTOR_TWIN_TURN v10, HOW THIS PERSON QUESTIONS).
 * The persona's own reading (style, priorities, likely questions) still
 * leads; the archetype shapes the conduct. Versioned: a change here is a
 * new version, never an edit in place.
 */

export const INVESTOR_ARCHETYPES_VERSION = "investor-archetypes.v1";

export type InvestorArchetypeId =
  | "NUMBERS_FIRST"
  | "THESIS_SKEPTIC"
  | "FOUNDER_FIRST"
  | "PATTERN_MATCHER"
  | "METHODICAL_DILIGENCE"
  | "MISSION_DRIVEN";

type Archetype = {
  readonly id: InvestorArchetypeId;
  /** Words in the persona's priorities, style and questions that suggest it. */
  readonly cues: readonly string[];
  readonly note: string;
};

const NUMBERS_FIRST: Archetype = {
  id: "NUMBERS_FIRST",
  cues: [
    "revenue",
    "arr",
    "mrr",
    "margin",
    "unit economics",
    "cac",
    "ltv",
    "burn",
    "runway",
    "cohort",
    "retention",
    "metrics",
    "financial",
    "valuation",
  ],
  note: 'A numbers-first investor. Opens briefly, then straight to the figures: revenue, growth, margins, burn. Asks for the exact number, the period and the source; does the arithmetic out loud and says when it does not add up. Follow-ups: up to three on one number until it is specific ("forty percent of what, over what period?"), then notes it as a gap and moves on. Habits: repeats a figure back before questioning it; dry, precise, rarely enthusiastic until the numbers hold.',
};

const ARCHETYPES: readonly Archetype[] = [
  NUMBERS_FIRST,
  {
    id: "THESIS_SKEPTIC",
    cues: [
      "market",
      "thesis",
      "competition",
      "competitor",
      "moat",
      "defensib",
      "why now",
      "timing",
      "category",
      "incumbent",
    ],
    note: 'A thesis-driven skeptic. Opens with the big picture -- why this, why now, why you -- and argues the other side on purpose: names the incumbent, the cheaper substitute, the reason it fails. Follow-ups: pushes the strongest objection twice; if the answer holds, says so plainly and moves on; if not, asks what would prove them wrong. Habits: "Let me play devil\'s advocate", "Help me understand why this isn\'t just..."; calm, probing, never hostile for its own sake.',
  },
  {
    id: "FOUNDER_FIRST",
    cues: [
      "founder",
      "team",
      "background",
      "execution",
      "resilien",
      "grit",
      "culture",
      "hiring",
      "operator",
      "pre-seed",
      "angel",
    ],
    note: 'A founder-first operator investor. Warm opening, asks how they came to this problem; bets on people. Questions are stories: a hard decision, a hire that went wrong, what they learned from customers. Follow-ups: "tell me about a specific time", then one about self-awareness ("what would your co-founder say you\'re worst at?"). Habits: shares a short line of their own operating experience now and then; encouraging, but notices rehearsed answers and asks for the real version.',
  },
  {
    id: "PATTERN_MATCHER",
    cues: [
      "scale",
      "category leader",
      "big outcome",
      "venture scale",
      "series a",
      "series b",
      "growth",
      "portfolio",
    ],
    note: 'A time-poor senior partner who pattern-matches. Short questions, little small talk; asks for the one-sentence version and cuts off a long answer ("Got it -- next"). Jumps between topics quickly and compares to what they have seen before in general terms ("we\'ve seen three of these this year"). Follow-ups: one sharp follow-up, then on to the next topic; comes back to anything that sounded weak at the end. Habits: checks the time, decisive, gives a clear signal of interest or not.',
  },
  {
    id: "METHODICAL_DILIGENCE",
    cues: [
      "diligence",
      "process",
      "governance",
      "compliance",
      "risk",
      "legal",
      "data room",
      "documentation",
      "references",
      "structure",
    ],
    note: 'A methodical diligence investor. Says how the meeting will go, then works through it in order: problem, product, traction, team, terms. Repeats answers back to confirm ("so, to make sure I have it..."), asks what document or data shows it, and notes what to send after the call. Follow-ups: keeps asking until the claim is pinned to evidence; flags inconsistencies politely. Habits: "let me write that down", unhurried, polite, hard to rush.',
  },
  {
    id: "MISSION_DRIVEN",
    cues: [
      "impact",
      "climate",
      "sustainab",
      "social",
      "esg",
      "mission",
      "inclusion",
      "emerging market",
      "health outcome",
      "education",
    ],
    note: "A mission-driven investor. Asks first what changes in the world if this works and for whom, then how it is measured. Probes the trade-off between impact and returns, and whether the mission survives growth and pressure. Follow-ups: asks for the metric behind any impact claim and challenges impact-washing; then turns to whether the business can stand on its own. Habits: thoughtful pauses, values-led language, firm on accountability.",
  },
];

const FOUNDER_NOTE =
  "You are the founder: answer their questions directly and specifically, defend with evidence, and ask about the fund and process only once their questions are answered. Follow-ups from them deserve a sharper second answer, not the same one again.";

/** The persona fields the archetype is read from; untrusted text, only matched. */
export type ArchetypeInput = {
  readonly counterpartName: string;
  readonly style: string;
  readonly summary: string;
  readonly priorities: readonly string[];
  readonly likelyQuestions: readonly { readonly question: string }[];
  readonly conduct?: {
    readonly patience: string;
    readonly warmth: string;
    readonly dodgeTolerance: string;
  };
};

/**
 * The archetype a persona plays to: the best match of its own words to
 * each archetype's cues, nudged by its conduct; a tie is broken by a hash
 * of the name, so the same person is always played the same way.
 */
export function investorArchetypeOf(input: ArchetypeInput): Archetype {
  const text = [
    input.style,
    input.summary,
    ...input.priorities,
    ...input.likelyQuestions.map((q) => q.question),
  ]
    .join(" ")
    .toLowerCase();
  const scores = new Map<InvestorArchetypeId, number>();
  for (const archetype of ARCHETYPES) {
    let score = 0;
    // A short cue is a whole word ("arr" is not "array"); a longer one is
    // a stem ("sustainab", "margin").
    for (const cue of archetype.cues) {
      const pattern = cue.length >= 6 ? `\\b${cue}` : `\\b${cue}s?\\b`;
      if (new RegExp(pattern).test(text)) score += 1;
    }
    scores.set(archetype.id, score);
  }
  const bump = (id: InvestorArchetypeId, by: number) =>
    scores.set(id, (scores.get(id) ?? 0) + by);
  if (input.conduct?.patience === "SHORT") bump("PATTERN_MATCHER", 2);
  if (input.conduct?.warmth === "GENEROUS") bump("FOUNDER_FIRST", 2);
  if (input.conduct?.dodgeTolerance === "LOW") bump("METHODICAL_DILIGENCE", 1);
  const best = Math.max(...scores.values());
  const tied = ARCHETYPES.filter((a) => (scores.get(a.id) ?? 0) === best);
  const digest = createHash("sha256")
    .update(input.counterpartName.trim().toLowerCase())
    .digest();
  const pick = tied[(digest[0] ?? 0) % tied.length];
  return pick ?? NUMBERS_FIRST;
}

/** The HOW THIS PERSON QUESTIONS text for a turn. */
export function questioningNote(
  counterpartRole: "INVESTOR" | "FOUNDER",
  input: ArchetypeInput,
): string {
  if (counterpartRole !== "INVESTOR") return FOUNDER_NOTE;
  return investorArchetypeOf(input).note;
}
