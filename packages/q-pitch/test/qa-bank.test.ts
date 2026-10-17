import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { QA_BANK, buildQaIndex } from "../src/index.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe("the Q&A bank (v6)", () => {
  const investor = buildQaIndex("INVESTOR");
  const founder = buildQaIndex("FOUNDER");

  it("answers every question and paraphrase with its own entry", () => {
    for (const entry of QA_BANK) {
      const index = entry.side === "FOUNDER" ? founder : investor;
      for (const asked of [entry.question, ...entry.paraphrases]) {
        expect(index.answer(asked)?.id, asked).toBe(entry.id);
      }
    }
  });

  it("answers by meaning, not only by the stored wording", () => {
    expect(investor.answer("Could a competitor just copy you?")?.id).toBe(
      "qa.moat",
    );
    expect(investor.answer("How much will this cost my fund?")?.id).toBe(
      "qa.business-model",
    );
    expect(investor.answer("Will founders see what I think of them?")?.id).toBe(
      "qa.privacy",
    );
    expect(investor.answer("Does the AI hallucinate numbers?")?.id).toBe(
      "qa.ai-accuracy",
    );
  });

  it("leaves to normal Q what it does not hold", () => {
    for (const asked of [
      "What's the weather in Lagos tomorrow?",
      "Draft an email to Clinicrest",
      "ok",
      "next",
      "Show me the data room",
      "What is a pitch deck?",
    ]) {
      expect(investor.answer(asked), asked).toBeNull();
    }
  });

  it("never claims traction, customers, revenue, investors or a team size", () => {
    const invented =
      /\b\d[\d,.]*\s*(?:k|m|million)?\s*(?:customers|clients|users|investors|employees|people|staff)\b|\b(?:arr|mrr)\b|\brevenue of\b|\bteam of \d|\bwe have (?:signed|raised)\b/iu;
    for (const entry of QA_BANK) {
      expect(invented.test(entry.answer), entry.id).toBe(false);
    }
  });

  it("names a source for every answer, and the files exist", () => {
    for (const entry of QA_BANK) {
      for (const source of entry.sources) {
        const path = source.split(" ")[0] ?? "";
        if (!path.includes("/")) continue;
        expect(existsSync(join(ROOT, path)), `${entry.id}: ${path}`).toBe(true);
      }
    }
  });
});
