// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GateqDossierV1 } from "@capital-q/contracts";
import { DossierView } from "../src/features/gateq/page/dossier-view";

afterEach(cleanup);
const dossier: GateqDossierV1 = {
  schemaVersion: "gateq-dossier.v1",
  generatedAt: "2026-10-13T00:00:00Z",
  application: { reference: "ga_test", submittedAt: "2026-10-13T00:00:00Z" },
  company: {
    name: "Example",
    description: null,
    website: null,
    country: null,
    stage: null,
    sectorPhrases: [],
    note: null,
  },
  contact: null,
  qualification: { outcome: "QUALIFIED", access: "MAY_APPLY", criteria: [] },
  dimensions: [],
  unknowns: [{ dimension: "REVENUE", label: "Revenue", group: "FINANCIALS" }],
  declined: [],
  missing: [],
  contradictions: ["Reported revenue differs"],
  documents: [
    {
      documentId: "00000000-0000-4000-8000-000000000001",
      title: "Supporting accounts",
    },
  ],
  diligenceQuestions: [
    {
      dimension: "REVENUE",
      basis: "UNKNOWN",
      question: "What supports revenue?",
    },
  ],
  transcript: { turnCount: 2 },
  synthesis: null,
};
describe("immutable received investor dossier", () => {
  it("retains unknowns, contradictions, source identifiers and exact submitted transcript", () => {
    render(
      <DossierView
        detail={{
          dossier,
          transcript: [
            {
              seq: 1,
              role: "PERSON",
              text: "Revenue is not known yet <script>do not run</script>",
              at: "2026-10-13T00:00:00Z",
            },
            {
              seq: 2,
              role: "Q",
              text: "What supports revenue?",
              at: "2026-10-13T00:00:00Z",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("Reported revenue differs")).toBeTruthy();
    expect(
      screen.getByText(/Source ID: 00000000-0000-4000-8000-000000000001/),
    ).toBeTruthy();
    expect(screen.getByText(/Revenue is not known yet <script>/)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /approve|reject|send/i }),
    ).toBeNull();
  });
  it("does not invent a dossier or transcript for legacy submissions", () => {
    const { container } = render(
      <DossierView detail={{ dossier: null, transcript: null }} />,
    );
    expect(container.textContent).toBe("");
  });
});
