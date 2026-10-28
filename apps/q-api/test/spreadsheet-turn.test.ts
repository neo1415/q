import { describe, expect, it } from "vitest";

import {
  answer,
  buildTurn,
  last,
  offered,
  ok,
  toolCalls,
} from "./q-turn-harness.js";

/**
 * XLSX-001: "give me an Excel of my pipeline". The reader picks the source
 * by meaning (the fake model here calls make_spreadsheet with PIPELINE);
 * the tool files a SPREADSHEET and its own result -- never the model's
 * words -- puts the document's card on the answer, with its downloads.
 */

const ARTIFACT = "77000000-0000-4000-8000-000000000001";

function build() {
  return buildTurn({
    said: "Give me an Excel of my pipeline",
    script: [
      toolCalls([
        { name: "make_spreadsheet", arguments: { source: "PIPELINE" } },
      ]),
      answer(
        "Your pipeline is in a spreadsheet: 3 relationships, with a Sources sheet.",
      ),
    ],
    offered: [
      {
        ...offered(
          "make_spreadsheet",
          "documents.own.spreadsheet",
          "SIDE_EFFECT",
        ),
        definition: {
          name: "make_spreadsheet",
          description: "make_spreadsheet",
          inputJsonSchema: {
            type: "object",
            properties: { source: { type: "string" } },
          },
        },
      },
      offered("list_my_relationships", "relationship.own.list"),
    ],
    world: (proposal) => {
      if (proposal.name !== "make_spreadsheet") return null;
      return ok(proposal, "documents.own.spreadsheet", {
        status: "DOCUMENT_UPDATED",
        document: {
          artifactId: ARTIFACT,
          type: "SPREADSHEET",
          status: "READY",
          title: "Pipeline",
          currentVersion: 1,
        },
      });
    },
  });
}

describe("an Excel of my pipeline (XLSX-001)", () => {
  it("calls make_spreadsheet and carries the spreadsheet's card on the answer", async () => {
    const { seam, request, executed, stored } = build();
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name)).toContain("make_spreadsheet");
    expect(
      executed.find((call) => call.name === "make_spreadsheet")?.arguments,
    ).toEqual({ source: "PIPELINE" });
    const final = last(stored);
    const card = final.blocks.find(
      (block) => block.kind === "ARTIFACT_REFERENCE",
    );
    expect(card).toEqual({
      kind: "ARTIFACT_REFERENCE",
      artifactId: ARTIFACT,
      type: "SPREADSHEET",
      status: "READY",
      title: "Pipeline",
    });
  });
});
