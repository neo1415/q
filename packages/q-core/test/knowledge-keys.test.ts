import { describe, expect, it } from "vitest";

import {
  isRecordableKnowledgeKey,
  RECORDABLE_KNOWLEDGE_NAMESPACES,
} from "../src/index.js";

/**
 * The seam where a sentence in a conversation becomes something Capital Q
 * holds. It was open, and against a live company the model wrote the
 * conversation into the knowledge base under keys it made up.
 */
describe("what may become a recorded fact about a company", () => {
  it("refuses the keys that actually caused this", () => {
    // Real rows, from a real company, under keys nobody defined: the
    // content was the conversation itself.
    expect(isRecordableKnowledgeKey("user.statement")).toBe(false);
    expect(isRecordableKnowledgeKey("user.request")).toBe(false);
    expect(isRecordableKnowledgeKey("user.message")).toBe(false);
  });

  it("refuses anything outside the namespaces, however well formed", () => {
    for (const key of [
      "conversation.turn",
      "note.general",
      "misc.other",
      "q.memory",
      "answer.text",
      "president.of_nigeria",
    ]) {
      expect(isRecordableKnowledgeKey(key), key).toBe(false);
    }
  });

  it("refuses a bare namespace: a fact is about something particular", () => {
    for (const namespace of RECORDABLE_KNOWLEDGE_NAMESPACES) {
      expect(isRecordableKnowledgeKey(namespace), namespace).toBe(false);
    }
  });

  it("refuses shapes that are not keys", () => {
    for (const key of [
      "",
      "   ",
      "Financial.ARR",
      "financial..arr",
      ".financial.arr",
      "financial.arr.",
      "financial arr",
      "financial-arr",
      "1financial.arr",
    ]) {
      expect(isRecordableKnowledgeKey(key), JSON.stringify(key)).toBe(false);
    }
  });

  it("accepts the facts a founder actually states about their company", () => {
    for (const key of [
      "financial.arr",
      "financial.mrr",
      "team.employee_count",
      "customer.concentration",
      "traction.paying_customers",
      "market.geography",
      "operations.market.kenya",
      "capital.round_target",
      "company.description",
      "founder.background",
    ]) {
      expect(isRecordableKnowledgeKey(key), key).toBe(true);
    }
  });
});
