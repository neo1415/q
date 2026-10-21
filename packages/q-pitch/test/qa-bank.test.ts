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

  it("answers shared questions with their own entry on the founder side too", () => {
    for (const entry of QA_BANK.filter((e) => e.side === "BOTH")) {
      for (const asked of [entry.question, ...entry.paraphrases]) {
        expect(founder.answer(asked)?.id, asked).toBe(entry.id);
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

  it("answers the product questions investors ask after the story", () => {
    for (const [asked, id] of [
      ["Is my data used to train ChatGPT?", "qa.training"],
      ["Can founders game the scoring?", "qa.founder-score-gaming"],
      ["How is this different from PitchBook?", "qa.vs-databases"],
      ["Are you SOC 2 compliant?", "qa.certification"],
      ["Can Q predict the winners?", "qa.prediction"],
      ["Are these companies real?", "qa.demo-data"],
      ["Do you take a success fee?", "qa.success-fee"],
      ["Why wouldn't I just use ChatGPT?", "qa.vs-chatgpt"],
      ["Is the score biased against some founders?", "qa.bias"],
      ["Can I export my data if I leave?", "qa.data-ownership"],
    ] as const) {
      expect(investor.answer(asked)?.id, asked).toBe(id);
    }
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

  it("speaks plainly: no engineering vocabulary in a spoken answer", () => {
    const jargon =
      /\b(?:rls|row[- ]level|pgvector|bm25|llms?|embeddings?|vectors?|apis?|sql|postgres(?:ql)?|supabase|railway|zod|schemas?|tenants?|rag|langgraph|openai|gpt[\w.-]*|tavus|deterministic|canonical|provenance|gateway model|model gateway|context firewall|write gate|json|endpoints?|backend|frontend|servers?|databases?|tokens?|prompts?|repos(?:itory)?|migrations?|webhooks?|latency)\b/iu;
    for (const entry of QA_BANK) {
      expect(entry.answer, entry.id).not.toMatch(jargon);
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
