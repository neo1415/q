import { describe, expect, it } from "vitest";

import { createDefaultPromptRegistry } from "../src/index.js";

/**
 * Live acceptance 2026-10-30 (production 4bcfa584b): the reader's rules,
 * by concept. Code holds the line on skips; the prompt carries the meaning.
 */
const registry = createDefaultPromptRegistry();

describe("ONBOARDING_TRANSCRIPT_READER v8", () => {
  const active = registry.getActive("ONBOARDING_TRANSCRIPT_READER");
  const template = active.definition.template;

  it("is the active version and keeps v7's rules", () => {
    expect(active.definition.version).toBeGreaterThanOrEqual(8);
    expect(template).toMatch(/A step of kind LONG_TEXT is told at length/u);
    expect(template).toMatch(/no website yet, no revenue so far/u);
  });

  it("examples in Q's question are never a value they agreed to", () => {
    expect(template).toMatch(
      /Examples Q lists inside a question .* are not something read back or suggested/u,
    );
  });

  it("a step is answered only by words that answer it; a skip stays a skip", () => {
    expect(template).toMatch(
      /A step is answered only by words that answer what it asks/u,
    );
    expect(template).toMatch(
      /A step whose record says they chose to skip it stays skipped/u,
    );
  });

  it("not knowing declines an optional step; skipping the rest declines every remaining optional step, never a required one", () => {
    // v9 (2026-10-31): not knowing any step goes under notKnown; code
    // sets an optional one aside.
    expect(template).toMatch(/they do not know the answer to a step/u);
    expect(template).toMatch(
      /put every optional step that has nothing on record and was not skipped under declined/u,
    );
    expect(template).toMatch(/Never a required step\./u);
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v9 (live re-check 2026-10-31)", () => {
  const active = registry.getActive("ONBOARDING_TRANSCRIPT_READER");
  const template = active.definition.template;

  it("v11 is active (on the v5 output schema) and keeps v9's rules", () => {
    expect(active.definition.version).toBeGreaterThanOrEqual(11);
    expect(active.definition.output).toMatchObject({ schemaVersion: 5 });
  });

  it("each value says whether they stated it or Q inferred it", () => {
    expect(template).toMatch(/source: STATED when their words say this value/u);
    expect(template).toMatch(/When in doubt, INFERRED/u);
    expect(template).toMatch(/"source": "STATED"/u);
  });

  it("not knowing is never a value or their own words, for any step", () => {
    expect(template).toMatch(
      /put it under notKnown with those words, needed or optional/u,
    );
    expect(template).toMatch(
      /is not an answer and never their own words for a step/u,
    );
    expect(template).not.toMatch(
      /do not know the answer to an optional step Q asked them, put it under declined/u,
    );
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v10 and ONBOARDING_TYPED_REPLY v5 (live final re-check 2026-10-31)", () => {
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;
  const reply = registry.getActive("ONBOARDING_TYPED_REPLY").definition;

  it("an agreement carries Q's offered value, never their agreeing words", () => {
    expect(reader.template).toMatch(/affirms: true when their words/u);
    expect(reader.template).toMatch(/never their agreeing words/u);
    expect(reader.template).toMatch(/"affirms": false/u);
  });

  it("an unanswered part of Q's question is neither declined nor not known", () => {
    expect(reader.template).toMatch(
      /Not answering part of what Q asked is neither declining it nor not knowing it/u,
    );
    expect(reader.template).toMatch(/"saidSo": true/u);
  });

  it("the reply never asks what their latest message answered (it no longer waits for the reading)", () => {
    expect(reply.version).toBeGreaterThanOrEqual(5);
    expect(reply.template).toMatch(
      /The checklist is the record from before their latest message/u,
    );
    expect(reply.template).toMatch(
      /A topic their latest message answered is answered: never ask it/u,
    );
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v11 (live check 2026-10-31, 2e79954fd)", () => {
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;

  it("keeps v10's rules", () => {
    expect(reader.template).toMatch(/affirms: true when their words/u);
    expect(reader.template).toMatch(/saidSo \(declined and notKnown\)/u);
  });

  it("a yes to one summary gives every LONG_TEXT step it spoke to, in Q's words", () => {
    expect(reader.template).toMatch(
      /one summary of Q's that spoke to several LONG_TEXT steps, give every step that summary spoke to/u,
    );
    // v12: Q's words for each, its content only (no lead-in).
    expect(reader.template).toMatch(
      /each with Q's words for it from that line/u,
    );
  });

  it("a category step takes category words only, never a sentence", () => {
    expect(reader.template).toMatch(
      /never a sentence about what they do or who they serve/u,
    );
  });

  it("how firm a no is decides its step, by meaning", () => {
    expect(reader.template).toMatch(/How firm a "no" is decides its step/u);
    expect(reader.template).toMatch(/to the step that excludes outright/u);
  });

  it("an investor's thesis told at length is LONG_TEXT, said back for their yes", () => {
    expect(reader.template).toMatch(/\(their thesis\) is LONG_TEXT/u);
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v12 and ONBOARDING_TYPED_REPLY v6 (live check 2026-10-31, 84d8ede07)", () => {
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;
  const reply = registry.getActive("ONBOARDING_TYPED_REPLY").definition;

  it("are the active versions and keep the rules before them", () => {
    expect(reader.version).toBeGreaterThanOrEqual(12);
    expect(reply.version).toBeGreaterThanOrEqual(6);
    expect(reader.template).toMatch(/\(their thesis\) is LONG_TEXT/u);
    expect(reply.template).toMatch(
      /The checklist is the record from before their latest message/u,
    );
  });

  it("1. one say-back covers every told-at-length topic the message told, so one yes settles them", () => {
    expect(reply.template).toMatch(
      /says back what you understood for EVERY such topic it told you, all in this one message/u,
    );
    expect(reply.template).toMatch(/never one now and the others later/u);
    expect(reply.template).toMatch(/say all of them back together/u);
    expect(reply.template).not.toMatch(
      /one short sentence a topic, what you understood/u,
    );
  });

  it("2. a summary is its content: no lead-in, a capital first", () => {
    expect(reply.template).toMatch(/never framed as you telling them/u);
    expect(reader.template).toMatch(
      /leave out Q's words that only introduce the topic or speak to them/u,
    );
    expect(reader.template).toMatch(/begin it with a capital letter/u);
    expect(reader.template).not.toMatch(/exactly as Q said them/u);
  });

  it("3. the part of a list no option holds is kept in their words", () => {
    expect(reader.template).toMatch(
      /their own words for each part no option holds/u,
    );
  });

  it("4. an approximate answer to a number step is their words, and never asked again", () => {
    expect(reader.template).toMatch(
      /An approximate answer to a number step is an answer/u,
    );
    expect(reader.template).toMatch(/never turn it into a figure/u);
    expect(reply.template).toMatch(
      /An approximate answer \("a bit under a year", "around a dozen"\) answers its topic/u,
    );
  });
});

describe("ONBOARDING_TRANSCRIPT_READER v13 and ONBOARDING_TYPED_REPLY v7 (live check 2026-10-31, d6f606053)", () => {
  const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER").definition;
  const reply = registry.getActive("ONBOARDING_TYPED_REPLY").definition;

  it("are the active versions and keep the rules before them", () => {
    expect(reader.version).toBe(13);
    expect(reply.version).toBe(7);
    expect(reader.template).toMatch(
      /An approximate answer to a number step is an answer/u,
    );
    expect(reply.template).toMatch(
      /says back what you understood for EVERY such topic/u,
    );
    // The rule against working one step out from another stays.
    expect(reader.template).toMatch(
      /Never work one step out from words about another/u,
    );
  });

  it('1. "we are raising 1.2 million euros", said to another question, answers whether they are raising now', () => {
    expect(reader.template).toMatch(
      /Words that say outright what a step asks do answer it, whichever question they were said to/u,
    );
    expect(reader.template).toMatch(/says they are raising now/u);
    expect(reply.template).toMatch(
      /The checklist can lag a message or two behind the conversation/u,
    );
    expect(reply.template).toMatch(/even in answer to a different question/u);
  });

  it("2. a value held from their own words is put to them for their yes, never asked from scratch", () => {
    expect(reply.template).toMatch(
      /a value not confirmed yet that Q found in their own words, never ask that topic from scratch/u,
    );
  });

  it("4. every category they name is its own item, listed or not", () => {
    expect(reader.template).toMatch(
      /give every category they name, each its own item in their words, even one you think may not be listed/u,
    );
  });

  it("5. a quote is the part of the line about that step", () => {
    expect(reader.template).toMatch(
      /only the part of that line about this step when the line also answers other steps/u,
    );
  });
});
