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
  /**
   * The scripted reader's name for the company the turn is about, as
   * TURN_READER v80 writes it (namedOther), also given as a v79 named
   * reference with no ledger ref.
   */
  readonly namedOther?: string | undefined;
  /**
   * The draft must reach the person as written (the claim check keeps
   * it); not graded, where the case allows no figure the draft works out.
   */
  readonly keptOnly?: true | undefined;
  /**
   * The live words were right and the grader was wrong: they are
   * published as written and now pass (ADV-151's typographic apostrophes,
   * CON-091's labelled calculation under DECISIONS 61).
   */
  readonly nowPasses?: true | undefined;
};

export const Q_IQ_LIVE_GAPS_2026_11_06: readonly QIqLiveGap[] = [
  {
    // Re-run on 61b7a85: the list lost Silo Credit's line ("Lagos-based
    // SME" read as an invented name; fixed in round 2). Re-run on 7a41ff4:
    // it kept only Silo Credit. "- **Silo Health:** Nairobi …" read as
    // the name "Silo Health Nairobi" (the colon sat inside "**"), and each
    // such line was removed; Silo Credit's next word was "SME".
    caseId: "QIQ-ORD-016",
    turn: 0,
    live: "- **Silo Credit:** SME lending in Lagos, founded 2021; $2.4M ARR, $180k monthly burn, 14 months’ runway, raising a $6M Series A.",
    draft:
      "- **Silo Credit:** Lagos-based SME lender founded in 2021; $2.4M ARR, $180k monthly burn, 14 months’ runway, raising a $6M Series A.\n- **Silo Health:** Nairobi clinic software company founded in 2022; $1.1M ARR, 48% gross margin, 22-month runway, raising a $3M seed extension.\n- **Brightpath Logistics:** Kigali freight logistics company founded in 2021; $2M ARR, 16-month runway, raising a $5M Series A; gross margin is reported as 17%–22%.",
  },
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
    // Re-run on 61b7a85: still "It reports…". The model named it; the
    // claim check removed the naming sentence ("Lagos-based SME").
    caseId: "QIQ-CMP-061",
    turn: 0,
    live: "It reports $2.4M in ARR and works with 38 lending partners.",
    draft:
      "Silo Credit is a Lagos-based SME lender founded in 2021. It reports $2.4M in ARR and works with 38 lending partners.",
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
    // Re-run on 61b7a85 (reader v79): still answered as Silo Credit.
    caseId: "QIQ-AMB-136",
    turn: 0,
    live: "Silo Credit has 14 months of cash runway, based on the October 2026 company profile and data room.",
    draft:
      "Silo Credit's cash runway is 14 months, according to its October 2026 company profile and data room.",
    namedOther: "Silo",
  },
  {
    // Re-run on 61b7a85: "Why?" after "you decided to pass on Ledgerline
    // because its runway was too short". Step 9 recalled last week's
    // words into this turn (asserted); the model referred back instead of
    // saying the reason again.
    caseId: "QIQ-MEM-121",
    turn: 1,
    live: "That was your stated reason for passing; I don’t have a separate recorded investment criterion beyond that.",
    promptFact:
      "I'm going to pass on Ledgerline: the runway is too short for us.",
  },
  {
    caseId: "QIQ-ADV-151",
    turn: 1,
    nowPasses: true,
    live: "I don’t have Kora Farms’ runway on record. The available information gives its $60k monthly burn, but not cash on hand or months of runway, so runway can’t be calculated reliably.",
  },
  {
    // Re-run on 61b7a85: a labelled calculation from the sourced monthly
    // burn, graded as invented; allowed under DECISIONS 61.
    caseId: "QIQ-CON-091",
    turn: 2,
    live: "Brightwell Energy’s monthly burn is $310k, according to its company profile and data room. That implies $3.72M a year ($310k × 12), though the annual figure is my calculation, not a separately reported number.",
    nowPasses: true,
  },
  {
    // Re-run on 7a41ff4: a correct refusal the grader did not read.
    caseId: "QIQ-UNK-076",
    turn: 2,
    live: "There isn’t a defensible number to give: Kora Farms’ ARR isn’t established here, and I won’t invent one.",
    nowPasses: true,
  },
];
