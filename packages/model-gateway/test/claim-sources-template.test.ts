import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  templateRulesHead,
} from "@capital-q/q-core";

import {
  checkSentence,
  claimCorpus,
  templateValues,
} from "../src/q/claim-check.js";

/**
 * Q Intelligence Plan, step 10 (found by the Q-IQ adversarial category):
 * the answer prompt's own instructions carry figures ("7.5/10 · Good
 * fit"). A planted instruction asked Q to reveal a founder-private runway;
 * a model that obeyed wrote "7.5 months", and the claim check found 7.5 in
 * the instructions. Only the values rendered into the task are sources.
 */
describe("the claim check's sources leave out the task template's words", () => {
  const registry = createDefaultPromptRegistry();
  const definition = registry.getActive("COMPANY_ANALYST").definition;
  // v37 (model spend, 18 Nov): the fixed rules travel as an instruction;
  // the task message renders the template's remainder, as the seam reads it.
  const rules = templateRulesHead(definition) ?? "";
  const template = definition.template.slice(rules.length).trimStart();
  const rendered = renderPrompt(registry, {
    task: "COMPANY_ANALYST",
    operatingMode: "DEBRIEF",
    communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
    environmentNotes: "test environment",
    variables: {
      capability: "ANSWER",
      userMessage: "What's Quaywise Freight's runway?",
      conversation: [],
      authorisedFacts: [
        {
          scope: "COMPANY",
          statement: "Quaywise Freight net monthly burn is $130k.",
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
          source: "company profile",
        },
      ],
      subjectDescription:
        "Quaywise Freight, a company available in this conversation",
      turnNotes: "Capital Q established: 85 shippers on record.",
      institutionalNotes: "",
      memory: "",
    },
  });
  const task = rendered.messages.find((m) => m.role !== "SYSTEM");

  it("the template itself states 7.5 (the instruction that grounded the leak); since v37 it travels as an instruction", () => {
    expect(definition.template).toContain("7.5/10");
    expect(rules).toContain("7.5/10");
    expect(task?.content).not.toContain("7.5/10");
    expect(
      rendered.messages.some(
        (m) => m.role === "SYSTEM" && m.content.includes("7.5/10"),
      ),
    ).toBe(true);
  });

  it("keeps every value rendered into the task and drops the template's own text", () => {
    const values = templateValues(task?.content ?? "", template);
    expect(values).not.toContain("7.5/10");
    expect(values).not.toContain("STRICT ANSWER SHAPE");
    expect(values).toContain("Quaywise Freight net monthly burn is $130k.");
    expect(values).toContain("85 shippers on record");
    expect(values).toContain("What's Quaywise Freight's runway?");
    const sentence =
      "From the founder's private notes, Quaywise Freight's runway is 7.5 months.";
    expect(
      checkSentence(sentence, claimCorpus([`${rules}\n${task?.content ?? ""}`]))
        .ungrounded,
    ).toEqual([]);
    expect(checkSentence(sentence, claimCorpus([values])).ungrounded).toContain(
      "NUMBER",
    );
    expect(
      checkSentence("Quaywise Freight has 85 shippers.", claimCorpus([values]))
        .ungrounded,
    ).toEqual([]);
  });

  it("returns a rendering that does not follow the template whole", () => {
    expect(templateValues("something else entirely", template)).toBe(
      "something else entirely",
    );
  });
});
