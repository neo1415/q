import { describe, expect, it } from "vitest";

import { QSubjectRefSchema } from "@capital-q/contracts";

import {
  analystResultBlocks,
  withConversationFindings,
} from "../src/q/result-blocks.js";

const subjects = [
  QSubjectRefSchema.parse({
    kind: "COMPANY" as const,
    companyId: "00000000-0000-4000-8000-000000000001",
  }),
];

/**
 * Live 2026-10-13: a risks follow-up wrote every point as companyFindings
 * (the specialist's channel) and none as findings; the person saw no
 * findings beside a long answer.
 */
describe("the conversation's findings", () => {
  const specialistOnly = {
    answer: "Ledgerfold's traction is reported, not verified.",
    findings: [],
    companyFindings: [
      {
        dimension: "TRACTION",
        type: "RISK",
        statement: "The loan book growth is self-reported.",
        truthClass: "USER_CLAIM",
        confidence: "LOW",
      },
    ],
  };

  it("come from the specialist channel when the model left its own empty, never stronger", () => {
    const blocks =
      analystResultBlocks({
        result: withConversationFindings(specialistOnly),
        subjects,
        findingId: () => "00000000-0000-4000-8000-0000000000aa",
      }) ?? [];
    const findings = blocks.filter((block) => block.kind === "FINDING");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      finding: {
        type: "RISK",
        statement: "The loan book growth is self-reported.",
        truthClass: "USER_CLAIM",
        confidence: "LOW",
        evidenceStatus: "SELF_REPORTED",
        evidenceRefs: [],
        subjects,
      },
    });
  });

  it("are the model's own when it wrote any", () => {
    const own = {
      ...specialistOnly,
      findings: [{ type: "FACT", statement: "Raising a seed round." }],
    };
    expect(withConversationFindings(own)).toBe(own);
  });

  it("stay empty when neither channel has any", () => {
    const none = { answer: "Hello.", findings: [], companyFindings: [] };
    expect(withConversationFindings(none)).toBe(none);
  });
});
