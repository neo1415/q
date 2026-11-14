import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GATEQ_STATEMENT_QUANTITIES } from "@capital-q/q-core";

import { STATEMENT_QUANTITIES } from "../src/contracts/statements.js";
import {
  claimsRecording,
  NOT_RECORDED_LINE,
  replyHeldToReading,
} from "../src/application/statement-plan.js";
import { reading, statementWorld } from "./support/statement-world.js";

/** Slice 2 edges the long journey does not walk through. */

const GATEWAY = "gq_23456789abcdefghjkmnpqrs99";

async function begun() {
  const world = statementWorld();
  const services = world.services();
  const { token } = await services.intake.start({ gatewayPublicId: GATEWAY });
  world.scripts.push(() => reading({ reply: "Hello. What are you building?" }));
  await services.conversation.openingFor({
    token,
    correlationId: randomUUID(),
  });
  const say = (clientTurnId: string, message: string) =>
    services.conversation.turn({
      token,
      message,
      clientTurnId,
      correlationId: randomUUID(),
    });
  return { world, ...services, token, say };
}

describe("the reading contract", () => {
  it("names the same closed quantity keys as the statement contract", () => {
    expect([...GATEQ_STATEMENT_QUANTITIES]).toEqual([...STATEMENT_QUANTITIES]);
  });
});

describe("an application begun before statements", () => {
  it("carries its legacy fact in as an honest BACKFILL the first time a turn touches it", async () => {
    const { world, intake, token, say } = await begun();
    await intake.recordFacts({
      token,
      facts: [
        {
          dimension: "claims.traction",
          value: { kind: "TEXT", text: "600 weekly active retailers" },
          provenance: "APPLICANT_PROVIDED",
        },
      ],
    });
    world.advance(60_000);
    world.scripts.push((prompt) => {
      // The carried fact has a handle Q can name.
      expect(prompt.statement("600 weekly active retailers")).toMatch(
        /^S\d+$/u,
      );
      return reading({
        reply: "Eighteen operators, nice.",
        statements: [
          {
            op: "NEW",
            target: null,
            turn: null,
            dimension: "claims.traction",
            quantity: null,
            asOf: null,
            provenance: "APPLICANT_PROVIDED",
            value: { kind: "TEXT", text: "18 operators" },
            words: "We have 18 operators",
          },
        ],
      });
    });
    await say("turn-carry-1", "We have 18 operators.");
    const store = world.store();
    const carried = store.statementRows.find((s) => s.origin === "BACKFILL");
    expect(carried?.backfillKey).toMatch(/^legacy-fact:/u);
    expect(carried?.sourceTurnId).toBeNull();
    const traction = store.factRows.find(
      (f) => f.dimension === "claims.traction" && f.supersededAt === null,
    );
    // Added to, never replaced.
    expect(traction?.value).toEqual({
      kind: "TEXT",
      text: "600 weekly active retailers\n18 operators",
    });
  });
});

describe("an orphaned turn sent again after a later one read it", () => {
  it("is answered without being read twice", async () => {
    const { world, say } = await begun();
    world.scripts.push(() => "FAIL");
    await expect(
      say("turn-orphan-1", "We have 18 operators."),
    ).rejects.toThrow();
    world.advance(60_000);
    world.scripts.push((prompt) => {
      expect(prompt.unread()).toEqual(["T1: We have 18 operators."]);
      return reading({
        reply: "Eighteen operators in Lagos.",
        statements: [
          {
            op: "NEW",
            target: null,
            turn: "T1",
            dimension: "claims.traction",
            quantity: null,
            asOf: null,
            provenance: "APPLICANT_PROVIDED",
            value: { kind: "TEXT", text: "18 operators" },
            words: "We have 18 operators",
          },
        ],
      });
    });
    await say("turn-orphan-2", "We're in Lagos.");
    world.advance(60_000);
    // The founder's client retries the first message: the model may read
    // it again, and nothing from it is written twice.
    world.scripts.push(() =>
      reading({
        reply: "Got it, eighteen operators.",
        statements: [
          {
            op: "NEW",
            target: null,
            turn: null,
            dimension: "claims.traction",
            quantity: null,
            asOf: null,
            provenance: "APPLICANT_PROVIDED",
            value: { kind: "TEXT", text: "18 operators again" },
            words: "We have 18 operators",
          },
        ],
      }),
    );
    await say("turn-orphan-1", "We have 18 operators.");
    const store = world.store();
    expect(store.statementRows).toHaveLength(1);
    const orphan = store.turnRows.find(
      (t) => t.clientTurnId === "turn-orphan-1" && t.role === "PERSON",
    );
    expect(
      store.readingRows.filter((r) => r.turnId === orphan?.id),
    ).toHaveLength(1);
    expect(
      store.turnRows.some(
        (t) => t.clientTurnId === "turn-orphan-1" && t.role === "Q",
      ),
    ).toBe(true);
  });
});

describe("Q's claim to have recorded something", () => {
  it.each([
    "Noted!",
    "Got it, I've noted that.",
    "I've added that to your application.",
    "That's recorded.",
    "Saved.",
  ])("is held to the reading: %s", (claim) => {
    expect(claimsRecording(claim)).toBe(true);
    expect(replyHeldToReading(`${claim} What's next?`, 0)).toBe(
      `${NOT_RECORDED_LINE} What's next?`,
    );
    expect(replyHeldToReading(`${claim} What's next?`, 1)).toBe(
      `${claim} What's next?`,
    );
  });

  it("never takes a question for a claim", () => {
    expect(claimsRecording("Have you logged any sales yet?")).toBe(false);
    expect(replyHeldToReading("Fine. Have you recorded revenue?", 0)).toBe(
      "Fine. Have you recorded revenue?",
    );
  });

  it("leaves a reply that claims nothing as it is", () => {
    expect(replyHeldToReading("Lagos, got it. What stage are you at?", 0)).toBe(
      "Lagos, got it. What stage are you at?",
    );
  });
});
