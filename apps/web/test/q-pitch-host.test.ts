import { describe, expect, it } from "vitest";

import { QMessageSchema, type QMessage } from "@capital-q/contracts";

import { demoTop } from "@/features/q/answer-canvas-fixtures";
import {
  fixtureKeysOf,
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

describe("Q Pitch fixtures resolve only from what the actor was shown", () => {
  it("resolves a key from the actor's own answer cards", () => {
    const messages = [
      cardsMessage([
        { name: "Ledgerfold Labs", companyId: LEDGERFOLD },
        { name: "F2 Health", companyId: F2 },
      ]),
    ];
    expect(resolveCompanyFixture("ledgerfold", messages)).toEqual({
      companyId: LEDGERFOLD,
      name: "Ledgerfold Labs",
    });
    expect(resolveCompanyFixture("f2", messages)?.companyId).toBe(F2);
  });

  it("does not resolve a company the actor has not been shown", () => {
    expect(resolveCompanyFixture("ledgerfold", [])).toBeNull();
    // A name match without a resolved record is not a record.
    expect(
      resolveCompanyFixture("ledgerfold", [
        cardsMessage([{ name: "Ledgerfold Labs", companyId: null }]),
      ]),
    ).toBeNull();
    // An unknown fixture key never guesses.
    expect(
      resolveCompanyFixture("someone-else", [
        cardsMessage([{ name: "Someone Else", companyId: LEDGERFOLD }]),
      ]),
    ).toBeNull();
  });

  it("does not let a person's own typed text name a record", () => {
    const typed = QMessageSchema.parse({
      messageId: messageId(),
      runId: RUN,
      role: "USER",
      text: "Open Ledgerfold",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    expect(resolveCompanyFixture("ledgerfold", [typed])).toBeNull();
  });

  it("lists every fixture a scene's actions name", () => {
    expect(
      fixtureKeysOf([
        { actionId: "ta_open", kind: "openCompany", company: "ledgerfold" },
        {
          actionId: "ta_cmp",
          kind: "buildComparison",
          question: "q.compare-two",
          companies: ["ledgerfold", "f2"],
        },
      ]),
    ).toEqual(["ledgerfold", "f2"]);
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
