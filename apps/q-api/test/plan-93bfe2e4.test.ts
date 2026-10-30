import { describe, expect, it } from "vitest";

import {
  noteVocabulary,
  personLines,
  type ReviewPoint,
} from "../src/composition/workforce/plan-job.js";

/**
 * Live 2026-10-30 (production 6b4d994b3, plan job 0823a533, plan
 * 93bfe2e4, "Plan my raise over 8 weeks", scores 89/84, offered as a
 * draft). On the card, expanded ("Show fewer" showing):
 *
 *   - Step 4 ended "And 4 more.", step 6 "And 1 more.", step 9 "And 2
 *     more.": the card had nowhere to show them.
 *   - Step 3 read "The meeting with Aster is waiting for your decision
 *     before it can be booked. An initial Aster meeting is already waiting
 *     for your approval. The Aster meeting has not yet been approved or
 *     declined.": the reviewers' notes on the same open item, joined.
 *
 * Titles and the notes the card showed are verbatim; the notes the card
 * hid behind "And N more." were never shown, so the ones here stand for
 * them (each on its own rubric item, as distinct points are).
 */
const STEPS = [
  [
    "s1",
    "Approve, change or decline the two waiting messages to Aster Africa Ventures",
  ],
  [
    "s2",
    "Approve, change or decline the waiting LedgerBridge company-profile update",
  ],
  [
    "s3",
    "Approve, change or decline the proposed initial meeting with Aster Africa Ventures",
  ],
  [
    "s4",
    "Complete founder verification, confirm current figures and prepare LedgerBridge’s evidence for Aster",
  ],
  [
    "s5",
    "Review LedgerBridge’s private market note and internal customer risk note for Aster preparation",
  ],
  [
    "s6",
    "Prepare Nigerian market and alternatives research, then draft LedgerBridge deck revisions",
  ],
  [
    "s7",
    "Approve the revised LedgerBridge seed deck and file that version in the data room",
  ],
  [
    "s8",
    "Approve sharing only the revised LedgerBridge seed deck with Aster Africa Ventures",
  ],
  [
    "s9",
    "Research a shortlist of seed investors and draft outreach using LedgerBridge’s recorded positioning and approved evidence",
  ],
].map(([key, title]) => ({ key: key ?? "", title: title ?? "" }));

const p = (
  reviewer: "R1" | "R2",
  item: ReviewPoint["item"],
  stepKey: string,
  note: string,
): ReviewPoint => ({
  reviewer,
  item,
  stepKey,
  problem: `${item} on ${stepKey}`,
  fix: `fix ${item} on ${stepKey}`,
  note,
});

const STEP3 = [
  p(
    "R1",
    "situationCoverage",
    "s3",
    "The meeting with Aster is waiting for your decision before it can be booked.",
  ),
  p(
    "R2",
    "situationCoverage",
    "s3",
    "An initial Aster meeting is already waiting for your approval.",
  ),
  p(
    "R2",
    "situationCoverage",
    "s3",
    "The Aster meeting has not yet been approved or declined.",
  ),
];

const STEP4 = [
  p(
    "R1",
    "situationCoverage",
    "s4",
    "The figures you previously gave Q are not yet reconciled into the evidence work.",
  ),
  p(
    "R1",
    "specificity",
    "s4",
    "Which revenue evidence you will prepare for Aster is not yet named.",
  ),
  p(
    "R1",
    "feasibility",
    "s4",
    "Your founder verification and the figures work may not both fit before the Aster conversation.",
  ),
  p(
    "R2",
    "citesFacts",
    "s4",
    "Your regulatory and finance-control position is not yet tied to what you hold on record.",
  ),
  p(
    "R2",
    "asksNothingKnown",
    "s4",
    "You are asked again for your raise amount, which you already told Q.",
  ),
];

const STEP6 = [
  p(
    "R1",
    "situationCoverage",
    "s6",
    "Your economics and financial-planning gaps are not yet tied to the deck work.",
  ),
  p(
    "R1",
    "specificity",
    "s6",
    "Your team slide does not yet explain key non-founder roles or how the team will develop.",
  ),
  p(
    "R2",
    "feasibility",
    "s6",
    "The research and the deck revisions may not both be done by the date set.",
  ),
];

const STEP9 = [
  p(
    "R1",
    "specificity",
    "s9",
    "The wider investor universe and the basis for selecting it remain unsettled.",
  ),
  p(
    "R1",
    "citesFacts",
    "s9",
    "Which of your approved evidence the outreach rests on is not yet named.",
  ),
  p(
    "R2",
    "feasibility",
    "s9",
    "A shortlist and tailored drafts in one week may be more than the week allows.",
  ),
];

const VOCABULARY = noteVocabulary("FOUNDER");
const lines = personLines({
  points: [...STEP3, ...STEP4, ...STEP6, ...STEP9],
  steps: STEPS,
  vocabulary: VOCABULARY,
});
const stepLines = (number: number) =>
  lines.filter(
    (line) =>
      line.startsWith(`Step ${String(number)}, “`) ||
      line.startsWith(`Step ${String(number)}, continued: `),
  );

describe("plan 93bfe2e4: every note the card promises is on the card", () => {
  it("no line promises notes it does not hold", () => {
    for (const line of lines) {
      expect(line).not.toMatch(/And \d+ more\./u);
      expect(line.length).toBeLessThanOrEqual(300);
    }
  });

  it("each of step 4's five notes is said, under its title and then 'continued'", () => {
    const step4 = stepLines(4);
    expect(step4[0]?.startsWith(`Step 4, “${STEPS[3]?.title ?? ""}”: `)).toBe(
      true,
    );
    expect(step4.length).toBeGreaterThan(1);
    for (const line of step4.slice(1)) {
      expect(line.startsWith("Step 4, continued: ")).toBe(true);
    }
    const said = step4.join(" ");
    for (const point of STEP4) expect(said).toContain(point.note);
  });

  it("steps 6 and 9 say every note too", () => {
    const six = stepLines(6).join(" ");
    for (const point of STEP6) expect(six).toContain(point.note);
    const nine = stepLines(9).join(" ");
    for (const point of STEP9) expect(nine).toContain(point.note);
  });

  it("step 3: one note per rubric item, the first reviewer's, never the same item said three times", () => {
    expect(stepLines(3)).toEqual([
      `Step 3, “${STEPS[2]?.title ?? ""}”: The meeting with Aster is waiting for your decision before it can be booked.`,
    ]);
  });

  it("the first usable note on an item stands for it: a refused first note gives way to the second reviewer's", () => {
    const refused = personLines({
      points: [
        // Written over the plan's JSON: refused by code-known vocabulary.
        p("R1", "situationCoverage", "s3", "Add s3 to the cites."),
        STEP3[1] ?? p("R2", "situationCoverage", "s3", ""),
      ],
      steps: STEPS,
      vocabulary: VOCABULARY,
    });
    expect(refused).toEqual([
      `Step 3, “${STEPS[2]?.title ?? ""}”: An initial Aster meeting is already waiting for your approval.`,
    ]);
  });

  it("two items on one step are two notes", () => {
    const two = personLines({
      points: [STEP3[0], STEP4[1]].flatMap((point) =>
        point === undefined ? [] : [{ ...point, stepKey: "s3" }],
      ),
      steps: STEPS,
      vocabulary: VOCABULARY,
    });
    expect(two).toHaveLength(1);
    expect(two[0]).toContain(STEP3[0]?.note ?? "-");
    expect(two[0]).toContain(STEP4[1]?.note ?? "-");
  });
});
