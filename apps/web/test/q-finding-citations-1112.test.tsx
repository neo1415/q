// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { QTurn } from "../src/features/q/conversation";
import { QEvidenceBody } from "../src/features/q/q-evidence";

/**
 * Slice 1 (owner review 12 Nov): under Sources, each finding names what it
 * rests on, with that source's own standing and date; a finding with no
 * citation shows none (honest, never invented).
 */
const TURN: Extract<QTurn, { kind: "Q" }> = {
  kind: "Q",
  id: "q-1",
  text: "MedTrail sells drug traceability software.",
  streaming: false,
  sourceCount: 0,
  publicSources: [],
  uncertainties: [],
  blocks: [],
  findings: [
    {
      id: "f-1",
      type: "FACT",
      statement: "MedTrail sells drug traceability software.",
      confidence: "MODERATE",
      sourceCount: 0,
      citations: [
        {
          source: "Company profile",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          asOf: "2026-10-01T09:00:00.000Z",
        },
        {
          source: "Pitch deck, as Q read it",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          asOf: "September 2026",
        },
        {
          source: "Public web: news.example.com — MedTrail raises seed round",
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
          asOf: "2026-09-02",
        },
      ],
    },
    {
      id: "f-2",
      type: "INFERENCE",
      statement: "Demand likely tracks recall regulation.",
      confidence: "LOW",
      sourceCount: 0,
      citations: [],
    },
  ],
};

describe("finding citations", () => {
  it("shows the cited source with its own standing and date, and nothing for an uncited finding", () => {
    const { container } = render(<QEvidenceBody turn={TURN} />);
    const lists = container.querySelectorAll("[data-q-finding-citations]");
    expect(lists).toHaveLength(1);
    expect(lists[0]?.textContent).toBe(
      "Source: Company profile · Claimed by the company, self-reported · 2026-10-01" +
        "Source: Pitch deck, as Q read it · Claimed by the company, self-reported · September 2026" +
        "Source: Public web: news.example.com — MedTrail raises seed round · Not verified · 2026-09-02",
    );
    expect(container.textContent).not.toContain("Verified");
  });
});
