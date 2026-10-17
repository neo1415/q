import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";
import { TurnReaderV54ResultSchema } from "@capital-q/q-core";

import type { ModelGateway } from "../src/index.js";
import { controlsLine } from "../src/q/manifest-fact.js";
import { acceptStructuredOutput } from "../src/policy/structured.js";
import {
  createQTurnReader,
  readerScreenControls,
  TURN_READER_LENIENT_FIELDS,
} from "../src/q/turn-reader.js";

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

const attribution = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  correlationId: "cor_test",
};

const CONTROLS = [
  { id: "tab.overview", kind: "TAB", state: "SELECTED", label: "Overview" },
  { id: "tab.dataroom", kind: "TAB", label: "Salle de données" },
  { id: "section.risks", kind: "SECTION" },
  { id: "list.risks", kind: "LIST" },
] as const;

/** Owner 2026-10-17: the reader chooses the page's tab by meaning (v54). */
describe("the turn reader is given the page's own tabs and sections", () => {
  it("lists tabs and sections with their visible names and states; never lists", () => {
    expect(readerScreenControls(CONTROLS)).toBe(
      [
        "tab.overview (TAB, Overview, SELECTED)",
        "tab.dataroom (TAB, Salle de données)",
        "section.risks (SECTION)",
      ].join("\n"),
    );
    expect(readerScreenControls(undefined)).toBe("(none)");
    expect(readerScreenControls([{ id: "list.x", kind: "LIST" }])).toBe(
      "(none)",
    );
  });

  it("puts them in the prompt, fenced as page text", async () => {
    const sent: string[] = [];
    const gateway = {
      execute: (request: { messages: { content: string }[] }) => {
        sent.push(request.messages.map((m) => m.content).join("\n"));
        return Promise.resolve({ output: { kind: "TEXT", text: "" } });
      },
    } as unknown as ModelGateway;
    await createQTurnReader({ gateway, logger }).read({
      utterance: "ouvre la salle de données",
      recentTurns: [],
      modality: "TEXT",
      screenControls: CONTROLS,
      attribution,
    });
    expect(sent[0]).toMatch(
      /source="screenControls">>>\ntab\.overview \(TAB, Overview, SELECTED\)\ntab\.dataroom \(TAB, Salle de données\)/u,
    );
    expect(sent[0]).toMatch(/CONTROL: control is the id/u);
  });

  it("a malformed control costs the control, never the reading", () => {
    const kept = acceptStructuredOutput(
      JSON.stringify({
        kind: "TOOL_REQUEST",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        control: "the data room tab",
      }),
      TurnReaderV54ResultSchema,
      { lenientFields: TURN_READER_LENIENT_FIELDS },
    );
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.value).toMatchObject({ control: null });
  });

  it("the answer's controls line carries a tab's name too", () => {
    expect(
      controlsLine([{ id: "tab.dataroom", kind: "TAB", label: "Data room" }]),
    ).toMatch(/tab\.dataroom \(TAB, "Data room"\)/u);
  });
});
