import { describe, expect, it } from "vitest";

import { QMessageSchema, type QMessage } from "@capital-q/contracts";

import { demoTop } from "@/features/q/answer-canvas-fixtures";
import {
  fixtureKeysOf,
  receiptCompanies,
  resolveCompanyFixture,
} from "@/features/q-pitch/fixtures";
import { captionSpeak, readingMs } from "@/features/q-pitch/narrator";

const LEDGERFOLD = "0b9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f00";
const F2 = "1c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f01";
const RUN = "2c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f02";

let messageSeq = 0;
function messageId(): string {
  messageSeq += 1;
  return `3c9a8c3e-4f61-4d2a-9c1e-${String(messageSeq).padStart(12, "0")}`;
}

/** A real, schema-valid Q message with answer cards (demo card shape). */
function cardsMessage(
  cards: { name: string; companyId: string | null }[],
): QMessage {
  const block = demoTop(cards.length);
  return QMessageSchema.parse({
    messageId: messageId(),
    runId: RUN,
    role: "Q",
    createdAt: "2026-10-15T00:00:00.000Z",
    blocks: [
      {
        ...block,
        cards: block.cards.map((card, i) => ({
          ...card,
          name: cards[i]?.name ?? card.name,
          subject:
            cards[i]?.companyId == null
              ? null
              : { kind: "COMPANY", companyId: cards[i]?.companyId },
        })),
      },
    ],
  });
}

const OTHER_RUN = "4c9a8c3e-4f61-4d2a-9c1e-5a7b3d2e1f04";

describe("Q Pitch companies come only from the acknowledged receipt", () => {
  it("card-N is the Nth company card of the acknowledged run, in order", () => {
    const receipt = receiptCompanies(
      [
        cardsMessage([
          { name: "Duplo", companyId: LEDGERFOLD },
          { name: "Bumpa", companyId: F2 },
        ]),
      ],
      RUN,
    );
    expect(resolveCompanyFixture("card-1", receipt)).toEqual({
      companyId: LEDGERFOLD,
      name: "Duplo",
    });
    expect(resolveCompanyFixture("card-2", receipt)?.name).toBe("Bumpa");
    expect(resolveCompanyFixture("card-3", receipt)).toBeNull();
  });

  it("never resolves a hard-coded name, or cards from another run", () => {
    const messages = [
      cardsMessage([{ name: "Ledgerfold", companyId: LEDGERFOLD }]),
    ];
    expect(
      resolveCompanyFixture("ledgerfold", receiptCompanies(messages, RUN)),
    ).toBeNull();
    expect(receiptCompanies(messages, OTHER_RUN)).toEqual([]);
    expect(resolveCompanyFixture("card-1", [])).toBeNull();
  });

  it("skips cards without a resolved company record", () => {
    const receipt = receiptCompanies(
      [
        cardsMessage([
          { name: "Unresolved", companyId: null },
          { name: "Bumpa", companyId: F2 },
        ]),
      ],
      RUN,
    );
    expect(resolveCompanyFixture("card-1", receipt)?.name).toBe("Bumpa");
  });

  it("does not let a person's own typed text name a record", () => {
    const typed = QMessageSchema.parse({
      messageId: messageId(),
      runId: RUN,
      role: "USER",
      text: "Open Ledgerfold",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    expect(receiptCompanies([typed], RUN)).toEqual([]);
  });

  it("lists every fixture a scene's actions name", () => {
    expect(
      fixtureKeysOf([
        { actionId: "ta_open", kind: "openCompany", company: "card-1" },
        {
          actionId: "ta_cmp",
          kind: "buildComparison",
          question: "q.compare-two",
          companies: ["card-1", "card-2"],
        },
      ]),
    ).toEqual(["card-1", "card-2"]);
  });
});

describe("caption narrator", () => {
  it("gives each line a bounded reading time", () => {
    expect(readingMs("Hello.")).toBe(1_500);
    expect(readingMs(Array.from({ length: 25 }, () => "word").join(" "))).toBe(
      10_000,
    );
    expect(readingMs(Array.from({ length: 200 }, () => "w").join(" "))).toBe(
      14_000,
    );
  });

  it("stops at once when interrupted", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const speaking = captionSpeak(
      [
        {
          lineId: "l.test",
          kind: "CONNECTIVE",
          text: "A long line that would take a while to read on screen.",
          claimIds: [],
          timing: "BEFORE_ACK",
          source: "test",
        },
      ],
      controller.signal,
    );
    controller.abort();
    await speaking;
    expect(Date.now() - started).toBeLessThan(500);
  });
});
