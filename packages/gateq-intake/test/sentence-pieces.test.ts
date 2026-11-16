import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ownWords,
  replySentences,
  sentencePieces,
  withoutLeaveOpenRequests,
} from "../src/application/statement-plan.js";
import { reading, statementWorld } from "./support/statement-world.js";

/**
 * Live 2026-11-16 (audit 2026-11-16-demo-evidence-relationships, GateQ):
 * a founder turn holding "the accounts show 29.3% gross margin" was kept
 * as two notes, "...gross margin of 29." and "3%.", because the splitter
 * broke on the decimal point.
 */
const LIVE_TURN =
  "Our deck says 82% gross margin, but the management accounts show a gross margin of 29.3%. The deck figure was before payment costs.";

describe("the one sentence splitter", () => {
  it("never splits inside a number", () => {
    for (const text of [
      "The accounts show 29.3% gross margin.",
      "We raised USD 1.5m last year.",
      "We are raising $2.0m on a SAFE.",
      "The app is on v1.2 now.",
      "Revenue last month was GBP 1,200.50 exactly.",
      "Burn is 0.4m a month and runway is 14.5 months.",
    ]) {
      expect(replySentences(text)).toEqual([text]);
    }
  });

  it("keeps the live turn as two whole sentences", () => {
    expect(replySentences(LIVE_TURN)).toEqual([
      "Our deck says 82% gross margin, but the management accounts show a gross margin of 29.3%.",
      "The deck figure was before payment costs.",
    ]);
  });

  it("never splits after a short form", () => {
    expect(
      replySentences(
        "We sell to lenders, e.g. Kuda and Moniepoint. Our U.S. pilot runs vs. two banks.",
      ),
    ).toEqual([
      "We sell to lenders, e.g. Kuda and Moniepoint.",
      "Our U.S. pilot runs vs. two banks.",
    ]);
  });

  it("keeps a list marker with the sentence it opens", () => {
    expect(
      replySentences(
        "1. Revenue is 40k a month. 2. Churn is 3.5%. b) We hire.",
      ),
    ).toEqual([
      "1. Revenue is 40k a month.",
      "2. Churn is 3.5%.",
      "b) We hire.",
    ]);
  });

  it("still splits real sentences and gives the text back whole", () => {
    const text = "  We sell to shops! Who pays? The shop pays. ";
    expect(replySentences(text)).toEqual([
      "We sell to shops!",
      "Who pays?",
      "The shop pays.",
    ]);
    expect(sentencePieces(text).join("")).toBe(text.trimEnd());
    expect(sentencePieces(LIVE_TURN).join("")).toBe(LIVE_TURN);
  });

  it("keeps a figure whole in the founder's own words and in filters", () => {
    expect(ownWords("accounts gross margin 29.3%", LIVE_TURN)).toBe(
      "Our deck says 82% gross margin, but the management accounts show a gross margin of 29.3%.",
    );
    expect(
      withoutLeaveOpenRequests(
        "Margin is 29.3% in the accounts. Leave it open for now.",
      ),
    ).toBe("Margin is 29.3% in the accounts.");
  });
});

describe("an unfiled figure with a decimal (live shape)", () => {
  it("is kept as one note, never cut at the decimal point", async () => {
    const world = statementWorld();
    const services = world.services();
    const { token } = await services.intake.start({
      gatewayPublicId: "gq_23456789abcdefghjkmnpqrs99",
    });
    world.scripts.push(() =>
      reading({ reply: "Hello, I'm Q. What are you building?" }),
    );
    await services.conversation.openingFor({
      token,
      correlationId: randomUUID(),
    });
    world.advance(60_000);
    // The reader proposed nothing, so each sentence holding a figure is
    // kept in the founder's words as a note.
    world.scripts.push(() =>
      reading({ reply: "Thanks, that helps.", intent: "CORRECTION" }),
    );
    const said =
      "Actually the accounts show 29.3% gross margin. The deck rounded it up.";
    await services.conversation.turn({
      token,
      message: said,
      clientTurnId: "t-margin",
      correlationId: randomUUID(),
    });
    const notes = world
      .store()
      .statementRows.filter((s) => s.dimension === "application.note")
      .map((s) => s.words);
    expect(notes).toEqual(["Actually the accounts show 29.3% gross margin."]);
  });
});
