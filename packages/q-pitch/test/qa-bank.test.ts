import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { QA_BANK, type QaEntry, buildQaIndex } from "../src/index.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** Questions as investors ask them, worded unlike the stored ones; null is for normal Q. */
const REALISTIC_PROBES: [string, string | null][] = [
  ["Who is it for?", "qa.who-for"],
  ["Where is my data stored?", "qa.data-location"],
  ["Who can see my deal flow?", "qa.privacy"],
  ["How do you make money?", "qa.business-model"],
  ["Is it free for founders?", "qa.free"],
  ["How is the investability score calculated?", "qa.scores"],
  ["What's the difference between suitability and investability?", "qa.scores"],
  ["Does Q make the investment decision?", "qa.ai-decides"],
  ["Can Q predict which companies will succeed?", "qa.prediction"],
  ["Is the AI biased?", "qa.bias"],
  ["Will founders know I viewed their profile?", "qa.viewing-privacy"],
  ["What happens if I pass?", "qa.pass"],
  ["Can I compare two companies?", "qa.compare"],
  ["Can I invite my partners?", "qa.team-collab"],
  ["Does Q remember what I told it last week?", "qa.memory"],
  ["Do you integrate with HubSpot?", "qa.integrations"],
  ["Does Q sit in on my calls?", "qa.meetings"],
  ["Will Q send messages without asking me?", "qa.q-acts"],
  ["Is there a mobile app?", "qa.mobile"],
  ["What languages do you support?", "qa.languages"],
  ["How do I set up GateQ on my site?", "qa.gateq-setup"],
  ["What is GateQ?", "qa.gateq"],
  ["How many customers do you have?", "qa.stage"],
  ["What's your valuation?", "qa.valuation"],
  ["How big is your market?", "qa.market-size"],
  ["What are your gross margins?", "qa.unit-economics"],
  ["How much are you raising?", "qa.ask"],
  ["Who are your competitors?", "qa.competition"],
  ["How are you different from Affinity?", "qa.vs-relationship-tools"],
  ["Why not just use ChatGPT for this?", "qa.vs-chatgpt"],
  ["What's live today?", "qa.whats-live"],
  ["Are these companies real?", "qa.demo-data"],
  ["Is my data used for training?", "qa.training"],
  ["Can I delete my account?", "qa.deletion"],
  ["Who owns the data?", "qa.data-ownership"],
  ["Are you SOC 2 certified?", "qa.certification"],
  ["Is this regulated as investment advice?", "qa.advice"],
  ["Do you take a success fee?", "qa.success-fee"],
  ["Why would good founders use this?", "qa.adverse-selection"],
  ["How do you stop fake investors?", "qa.verification"],
  ["What can't Q do?", "qa.q-limits"],
  ["Why now?", "qa.why-now"],
  ["What is a Q Card?", "qa.q-card"],
  ["Can founders game the score?", "qa.founder-score-gaming"],
  ["Open the CRM", null],
  ["Go to step 5", null],
  ["Thanks Q", null],
  ["Tell me a joke", null],
  ["What's the capital of France?", null],
  ["Summarise Clinicrest's risks", null],
];

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

  it("answers realistic investor questions, and leaves the rest to normal Q", () => {
    for (const [asked, id] of REALISTIC_PROBES) {
      expect(investor.answer(asked)?.id ?? null, asked).toBe(id);
    }
  });

  it("fixes the S1 engine-audit probes (ENGINE-AUDIT.md, qstory/engine)", () => {
    for (const [asked, id] of [
      ["Who can see my deal flow?", "qa.privacy"],
      ["What actually works right now?", "qa.whats-live"],
      ["Where is my data stored?", "qa.data-location"],
      ["what happens to the data room", null],
      ["Who is it for?", "qa.who-for"],
      ["Who is this for?", "qa.who-for"],
      ["Does it work in Nigeria?", "qa.geography"],
      ["How do I apply to a fund?", "qa.gateq"],
      ["what is q", "qa.what-is-q"],
      ["what does q do", "qa.what-is-q"],
      ["Is there a mobile app?", "qa.mobile"],
      ["How big is the market?", "qa.market-size"],
    ] as const) {
      expect(investor.answer(asked)?.id ?? null, asked).toBe(id);
    }
  });

  it("keeps intent in short questions and the name Q", () => {
    expect(investor.answer("Who is it for?")?.id).toBe("qa.who-for");
    expect(investor.answer("What can't Q do?")?.id).toBe("qa.q-limits");
    expect(founder.answer("What is Capital Q?")?.id).toBe("qa.what-is-it");
  });

  it("leaves a close call to normal Q rather than guess", () => {
    const twin = (id: string, question: string): QaEntry => ({
      id,
      side: "BOTH",
      question,
      paraphrases: [`${question} today`, `${question} please`],
      answer: "A prepared answer long enough for the schema.",
      sources: ["docs/specs/q-pitch/story/INVESTOR-QA.md"],
    });
    const close = buildQaIndex("INVESTOR", [
      twin("qa.twin-a", "How are founders scored for governance"),
      twin("qa.twin-b", "How are founders scored for traction"),
    ]);
    expect(close.answer("how are founders scored")).toBeNull();
    expect(close.answer("founders scored on governance")?.id).toBe("qa.twin-a");
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
