import { describe, expect, it } from "vitest";

import type { QResultBlock } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  capabilityNote,
  DAILY_HERE_LINE,
  HERE_LINE,
  screenLines,
  collectReceipts,
  PLAIN_KNOWING_LINE,
  POINTING_LINE,
  proposalStatusLine,
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

  it("client actions are done at once, never 'for approval'; a screen Capital Q lacks is said not to exist (R20/R33, live test #4/#5)", () => {
    const note = capabilityNote(
      FULL,
      [
        {
          name: "set_theme",
          description: "Switches the appearance. More.",
          classification: "SIDE_EFFECT",
        },
        {
          name: "propose_profile_change",
          description: "Prepares a change.",
          classification: "SIDE_EFFECT",
        },
      ],
      [],
    ).content;
    const lines = note.split("\n");
    const atOnce = lines.find((line) => line.includes("at once")) ?? "";
    expect(atOnce).toContain("set_theme");
    expect(atOnce).not.toContain("propose_profile_change");
    const approval = lines.find((line) => line.startsWith("- Prepare")) ?? "";
    expect(approval).toContain("propose_profile_change");
    expect(approval).not.toContain("set_theme");
    expect(note).toContain("Capital Q has no other screens");
    expect(note).toContain("offer the nearest");
    // No screen sent: no claim about where they are.
    expect(note).not.toContain("WHERE THEY ARE NOW");
  });

  it("says where the person is from the screen the plan carries (R21)", () => {
    const note = capabilityNote(FULL, [], [], {
      route: "COMPANY",
      companyId: ID(7),
    }).content;
    expect(note).toContain("on a company's page");
    expect(note).toContain(`the company ${ID(7)}`);
    // Founder report 2026-10-01: "get me a meeting with this person" on a
    // company's page was met with "which person?". Pointing words resolve
    // to what the screen shows.
    expect(note).toContain(POINTING_LINE);
  });

  it("says nothing about pointing when the screen shows nothing in particular", () => {
    const note = capabilityNote(FULL, [], [], { route: "HOME" }).content;
    expect(note).not.toContain(POINTING_LINE);
  });

  it('keeps the notes\' own words out of what Q says (live: "the authorised context does not include")', () => {
    expect(capabilityNote(FULL, [], []).content).toContain(PLAIN_KNOWING_LINE);
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

describe("a change's status is its real one, said plainly (live 2026-09-27 #1, #2)", () => {
  const FULL: QCapabilityManifest = {
    navigate: ["HOME", "PROFILE"],
    documents: [],
    visibilityChange: false,
  };
  const APPROVE = {
    name: "approve_pending_proposal",
    description: "Approves the one change waiting for their decision.",
    classification: "SIDE_EFFECT",
  };
  const PROPOSE = {
    name: "propose_profile_change",
    description: "Prepares a change to the person's own profile.",
    classification: "SIDE_EFFECT",
  };
  const change = (status: string) =>
    ({
      kind: "ACTION",
      id: ID(7),
      actionType: "person.profile.update",
      summary: "Update your profile. Headline: Angel investor.",
      status,
    }) as const;

  it("names each change by its id with what its status allows Q to say", () => {
    const pending = capabilityNote(
      FULL,
      [APPROVE, PROPOSE],
      [change("PENDING")],
    ).content;
    const line =
      pending.split("\n").find((entry) => entry.includes(ID(7))) ?? "";
    expect(line).toContain("status PENDING");
    expect(line).toContain("not saved yet");
    expect(line).not.toMatch(/: saved\.$/);

    const saved = capabilityNote(FULL, [APPROVE], [change("SAVED")]).content;
    const savedLine =
      saved.split("\n").find((entry) => entry.includes(ID(7))) ?? "";
    expect(savedLine).toContain("status SAVED: saved.");
  });

  it("offers approval by conversation only with the tool, and never as a change of its own", () => {
    const withTool = capabilityNote(FULL, [APPROVE, PROPOSE], []).content;
    const changeLine =
      withTool
        .split("\n")
        .find((line) => line.startsWith("- Prepare these changes")) ?? "";
    expect(changeLine).toContain("propose_profile_change");
    expect(changeLine).not.toContain("approve_pending_proposal");
    expect(withTool).toContain("approve it with approve_pending_proposal");
    expect(withTool).toContain("needs its own approval");

    const without = capabilityNote(FULL, [PROPOSE], []).content;
    expect(without).not.toContain("approve_pending_proposal");
  });

  it("never tells the model to call a waiting change done, nor to cite records", () => {
    const note = capabilityNote(
      FULL,
      [APPROVE, PROPOSE],
      [change("PENDING")],
    ).content;
    expect(note).not.toContain("ready for approval");
    expect(note).toContain("never call the same change both");
    expect(note).toContain("internal terms");
  });
});

describe("here is the screen (founder live 2026-10-01)", () => {
  it("on The Q Daily, 'everything here' is today's edition, read with its tool", () => {
    const lines = screenLines({ route: "DAILY" });
    expect(lines[0]).toContain("on The Q Daily (today's edition)");
    expect(lines).toContain(HERE_LINE);
    expect(lines).toContain(DAILY_HERE_LINE);
    expect(DAILY_HERE_LINE).toContain("get_q_daily");
  });

  it("says nothing about here on a screen without a name", () => {
    expect(screenLines({ route: "OTHER" })).not.toContain(HERE_LINE);
  });
});

describe("no ids or tool needs said to the person (live 2026-10-02)", () => {
  it("tells Q to resolve names itself and to say who waits for whom", () => {
    expect(PLAIN_KNOWING_LINE).toContain("Never ask them for an id");
    expect(PLAIN_KNOWING_LINE).toContain("never say what a tool needs");
    expect(PLAIN_KNOWING_LINE).toContain("the other side hasn't answered yet");
  });
});

/**
 * QA run 581a8862: a declined card's audience ("investors can download
 * it") was said as the deck's own. A card that is not saved changed
 * nothing, and Q is told so beside each one.
 */
describe("pending and declined changes are never described as done", () => {
  const card = (status: string) => ({
    kind: "ACTION" as const,
    id: `p-${status}`,
    actionType: "document.deck_audience.set",
    summary: "Let investors who can find Ajopot download Ajopot seed deck",
    status,
  });

  it.each(["PENDING", "DECLINED", "EXPIRED"])(
    "%s: the note says nothing changed, and the status line never says done or saved",
    (status) => {
      const note = capabilityNote(undefined, [], [card(status)]).content;
      expect(note).toContain(
        "A change that is not saved changed nothing: never describe what a pending, declined or lapsed change would do as how things are now.",
      );
      const line = note
        .split("\n")
        .find((entry) => entry.includes(`id p-${status}`));
      expect(line).toMatch(/nothing (?:has )?changed/u);
      expect(line).not.toMatch(/: (?:saved|approved, still being saved)\b/u);
      const status_ = proposalStatusLine([card(status)]);
      expect(status_).not.toMatch(/\bis saved\b|\bdone\b|already/iu);
    },
  );
});
