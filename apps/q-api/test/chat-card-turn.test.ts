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
 * Live 2026-10-28 (founder Ajopot): "What did Savanna Seed Partners say in
 * our chat?" came back as words alone, with no chat card and no "Open the
 * chat". The chat card now travels with the list_messages tool's own
 * result: when the turn reads the thread, the answer carries the
 * CHAT_WITH_INVESTOR card as a screen act, exactly as `show` does.
 */

const INVESTOR = "71000000-0000-4000-8000-000000000001";
const SAVANNA = "Savanna Seed Partners";

const OFFERED = [
  offered("list_messages", "relationship.messages.list"),
  offered("list_my_relationships", "relationship.list"),
];

function build(options: { readonly withCard?: boolean } = {}) {
  return buildTurn({
    said: `What did ${SAVANNA} say in our chat?`,
    script: [
      toolCalls([
        { name: "list_messages", arguments: { counterpartName: SAVANNA } },
      ]),
      answer(
        'Amara Diallo-Benson wrote at 2026-10-03 08:56 UTC: "QA double-send 1". The relationship is in diligence.',
      ),
    ],
    offered: OFFERED,
    world: (proposal) => {
      if (proposal.name !== "list_messages") return null;
      return ok(proposal, "relationship.messages.list", {
        open: true,
        counterpartName: SAVANNA,
        messages: [
          {
            from: "OTHER_SIDE",
            senderName: "Amara Diallo-Benson",
            kind: "TEXT",
            text: "QA double-send 1",
            attachmentTitle: null,
            sentAt: "2026-10-03T08:56:00.000Z",
          },
        ],
        ...(options.withCard === false
          ? {}
          : {
              clientAction: {
                kind: "SHOW_IN_Q_ROOM",
                object: "CHAT_WITH_INVESTOR",
                id: INVESTOR,
                title: SAVANNA,
              },
            }),
      });
    },
  });
}

describe("a chat question brings the chat card (live 2026-10-28)", () => {
  it("carries the CHAT_WITH_INVESTOR card the list_messages read returned", async () => {
    const { seam, request, executed, stored } = build();
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name)).toContain("list_messages");
    const final = last(stored);
    expect(final.content).toContain("QA double-send 1");
    const card = final.blocks.find(
      (
        block,
      ): block is { kind: "UI_INTENT"; intent: Record<string, unknown> } =>
        block.kind === "UI_INTENT",
    );
    expect(card?.intent).toEqual({
      kind: "SHOW_IN_Q_ROOM",
      object: "CHAT_WITH_INVESTOR",
      id: INVESTOR,
      title: SAVANNA,
    });
  });

  it("shows no card when the read had no record for the other side", async () => {
    const { seam, request, stored } = build({ withCard: false });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(last(stored).kinds).not.toContain("UI_INTENT");
  });
});
