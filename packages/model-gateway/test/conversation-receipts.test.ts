import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  capabilityNote,
  collectReceipts,
  type QCapabilityManifest,
  type QReceiptPort,
} from "../src/q/index.js";

/**
 * What Q can do and what it already produced, as code-built facts
 * (CQ-QX-008; founder live 2026-09-26: "I can't navigate you" while
 * navigation worked; "the conversation is ended" when nothing ended; a
 * mandate PDF made one turn earlier "not currently available").
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

function card(id: string, title: string): QResultBlock {
  return {
    kind: "ARTIFACT_REFERENCE",
    artifactId: id,
    type: "INVESTOR_MANDATE",
    status: "PREPARING",
    title,
  } as QResultBlock;
}

const ID = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("receipts come from the owning records, with current status", () => {
  it("lists every card once, newest last, with the record's status, and leaves out what the record does not show", async () => {
    const history = [
      { blocks: [card(ID(1), "Deck one")] },
      { blocks: [] },
      { blocks: [card(ID(2), "Mandate"), card(ID(1), "Deck one")] },
      { blocks: [card(ID(3), "Gone")] },
    ];
    const port: QReceiptPort = {
      artifact: (_actor, id) =>
        Promise.resolve(
          id === ID(3) ? null : { status: id === ID(2) ? "READY" : "FAILED" },
        ),
      action: () => Promise.resolve(null),
    };
    const receipts = await collectReceipts(history, port, actor);
    expect(receipts.map((r) => [r.id, r.status])).toEqual([
      [ID(1), "FAILED"],
      [ID(2), "READY"],
    ]);
  });

  it("a record that cannot be read claims nothing", async () => {
    const port: QReceiptPort = {
      artifact: () => Promise.reject(new Error("down")),
      action: () => Promise.reject(new Error("down")),
    };
    expect(
      await collectReceipts([{ blocks: [card(ID(1), "x")] }], port, actor),
    ).toEqual([]);
  });
});

describe("the capability note says what the run can do, and nothing else", () => {
  const FULL: QCapabilityManifest = {
    navigate: ["HOME", "PROFILE", "CAPITAL", "DISCOVER"],
    documents: ["PITCH_DECK", "INVESTMENT_BRIEF", "OWN_MANDATE"],
    visibilityChange: true,
  };

  it("names exactly what the manifest and the offered tools hold", () => {
    const subsets: QCapabilityManifest[] = [
      FULL,
      { navigate: ["DISCOVER"], documents: [], visibilityChange: false },
      { navigate: [], documents: ["PITCH_DECK"], visibilityChange: false },
    ];
    for (const manifest of subsets) {
      const note = capabilityNote(
        manifest,
        [{ name: "search_companies", description: "Finds companies. More." }],
        [],
      ).content;
      expect(note).toContain("search_companies (Finds companies.)");
      expect(note.includes("Discover")).toBe(
        manifest.navigate.includes("DISCOVER"),
      );
      expect(note.includes("Capital,")).toBe(
        manifest.navigate.includes("CAPITAL"),
      );
      expect(note.includes("a pitch deck")).toBe(
        manifest.documents.includes("PITCH_DECK"),
      );
      expect(note.includes("own mandate")).toBe(
        manifest.documents.includes("OWN_MANDATE"),
      );
      expect(note.includes("who can see their company")).toBe(
        manifest.visibilityChange,
      );
      // Always: what it cannot do, and claims only from receipts.
      expect(note).toContain("You cannot end, clear or start a conversation");
      expect(note).toContain("ONLY when a tool result");
    }
  });

  it("a tool that prepares a change is named as one, never as a read (R20)", () => {
    const note = capabilityNote(
      FULL,
      [
        {
          name: "search_companies",
          description: "Finds companies.",
          classification: "READ_ONLY",
        },
        {
          name: "propose_profile_change",
          description: "Prepares a change to the person's own profile. More.",
          classification: "SIDE_EFFECT",
        },
      ],
      [],
    ).content;
    const readLine =
      note.split("\n").find((line) => line.startsWith("- Read")) ?? "";
    const changeLine =
      note
        .split("\n")
        .find((line) => line.startsWith("- Prepare these changes")) ?? "";
    expect(readLine).toContain("search_companies");
    expect(readLine).not.toContain("propose_profile_change");
    expect(changeLine).toContain("propose_profile_change");
    expect(changeLine).toContain("for their approval");
  });

  it("says a document it made is the card above, downloadable only when ready", () => {
    for (const status of ["READY", "PREPARING", "FAILED"]) {
      const note = capabilityNote(
        FULL,
        [],
        [
          {
            kind: "DOCUMENT",
            id: ID(1),
            type: "INVESTOR_MANDATE",
            title: "Harrow Road Capital: investment mandate",
            status,
          },
        ],
      ).content;
      expect(note).toContain('"Harrow Road Capital: investment mandate"');
      expect(note).toContain(`status ${status}`);
      expect(note.includes("PDF downloads from that card")).toBe(
        status === "READY",
      );
    }
  });

  it("with no manifest still bounds what Q may claim", () => {
    const note = capabilityNote(undefined, [], []).content;
    expect(note).not.toContain("opens these screens");
    expect(note).not.toContain("prepares");
    expect(note).toContain("ONLY when a tool result");
  });
});
