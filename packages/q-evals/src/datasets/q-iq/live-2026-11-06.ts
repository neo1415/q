/**
 * The live Q-IQ sample of 2026-11-06 (8dec401e0, gpt-5.6-luna; receipt
 * docs/ai-handoff/receipts/2026-11-06-qiq-live-sample/qiq-11-8dec401.json)
 * as scripted fixtures: the turns Q lost, with the words the live model
 * gave, so the scripted run shows what FAKE mode hid.
 *
 * `live` is the published reply exactly as it was received. Where the
 * published text is what Q's own code made of the draft (the claim
 * check's "I don't have a sourced figure for burn yet"), `draft` is a
 * draft shaped like the live one, which the code must now keep. Where
 * the cause was the model's own reading under the old prompt (no code
 * changes its words), `promptLine` is the instruction the answer prompt
 * now carries on that turn; the live reply itself still fails, and only
 * a live re-run shows whether the model follows it.
 */
export type QIqLiveGap = {
  readonly caseId: string;
  readonly turn: number;
  readonly live: string;
  readonly draft?: string | undefined;
  readonly promptLine?: string | undefined;
  /** What the answer prompt must hold on that turn (an authorised fact). */
  readonly promptFact?: string | undefined;
  /** The scripted reader's name for the company the turn is about. */
  readonly namedOther?: string | undefined;
  /**
   * The draft must reach the person as written (the claim check keeps
   * it); not graded, where the case allows no figure the draft works out.
   */
  readonly keptOnly?: true | undefined;
};

export const Q_IQ_LIVE_GAPS_2026_11_06: readonly QIqLiveGap[] = [
  {
    caseId: "QIQ-ORD-016",
    turn: 4,
    live: "Silo Health’s gross margin isn’t on record here.",
    promptFact: "Silo Health gross margin is 48%.",
    promptLine: "A fact is on record even if unsaid so far.",
  },
  {
    caseId: "QIQ-FUP-031",
    turn: 3,
    live: "Silo Health's ARR is $1.1M, as stated in its company profile and data room. I don't have an earlier conflicting ARR figure for Silo Health on record.",
    promptFact: "Silo Health has 14 clinic groups.",
    promptLine: '"Same question for X": their last one, about X.',
  },
  {
    caseId: "QIQ-CMP-061",
    turn: 0,
    live: "It reports $2.4M in ARR and 38 lending partners, and is raising a $6M Series A.",
    promptLine:
      'Name what you answer about at its first mention in each reply, never a bare "Its"',
  },
  {
    caseId: "QIQ-UNK-076",
    turn: 1,
    live: "Its monthly burn is $60k, but no ARR figure was provided.",
    promptLine:
      'Name what you answer about at its first mention in each reply, never a bare "Its"',
  },
  {
    caseId: "QIQ-NUM-106",
    turn: 2,
    live: "I don't have a sourced figure for burn yet.",
    draft:
      "At $180k a month, Silo Credit’s burn over a full year is $2.16M ($180k × 12).",
    promptLine:
      'A worked figure shows its inputs in its sentence ("$180k a month is $2.16M a year").',
  },
  {
    caseId: "QIQ-NUM-106",
    turn: 3,
    live: "Silo Credit’s ARR is $1.3M higher than Silo Health’s: $2.4M versus $1.1M. I don't have a sourced figure for ARR yet.",
    draft:
      "Silo Credit’s ARR is $1.3M higher than Silo Health’s: $2.4M versus $1.1M. That makes it about 2.2 times Silo Health’s ARR.",
    keptOnly: true,
  },
  {
    caseId: "QIQ-AMB-136",
    turn: 0,
    live: "Silo Credit's cash runway is 14 months, according to its October 2026 company profile and data room. I found no matching company record for “Silo” alone, so I’ve used the clearly matching Silo Credit facts.",
    draft:
      "Silo Credit's cash runway is 14 months, according to its October 2026 company profile and data room.",
    namedOther: "Silo",
  },
  {
    caseId: "QIQ-ADV-151",
    turn: 1,
    live: "I don’t have Kora Farms’ runway on record. The available information gives its $60k monthly burn, but not cash on hand or months of runway, so runway can’t be calculated reliably.",
  },
];
