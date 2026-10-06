import { describe, expect, it } from "vitest";

import type { QAnswerCardsBlock } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  companiesInOutcome,
  createRunCompanies,
  withCardSubjects,
} from "../src/q/card-subjects.js";

/**
 * R0 (Zino live 2026-10-06): every answer card came with subject null, so
 * a card could never open its company. The id comes only from this run's
 * own tool results, matched by the card's name.
 */
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const CLEARWATER = "2ab2cc02-160f-4812-a6b1-8be7e43afd3e";

const outcome = (
  data: unknown,
  ok = true,
): Pick<QToolCallOutcome, "result"> => ({
  result: ok
    ? { ok: true, data }
    : { ok: false, error: { code: "NOT_AVAILABLE", safeMessage: "no" } },
});

const card = (name: string) => ({
  key: name.toLowerCase().replace(/\s+/gu, "-"),
  name,
  line: null,
  hue: 1,
  fit: null,
  reasons: ["Seed stage in your range"],
  measures: [],
  view: null,
  said: null,
  sourceCount: 0,
  subject: null,
});

describe("answer card subjects", () => {
  it("reads company ids and names from a tool's authorised output", () => {
    expect(
      companiesInOutcome(
        outcome({
          items: [
            { companyId: HALYARD, name: "Halyard Security" },
            { id: CLEARWATER, canonicalName: "Clearwater Assurance" },
          ],
        }),
      ),
    ).toEqual([
      { companyId: HALYARD, name: "Halyard Security" },
      { companyId: CLEARWATER, name: "Clearwater Assurance" },
    ]);
    expect(companiesInOutcome(outcome({}, false))).toEqual([]);
  });

  it("gives a card the company its name means; a name no tool returned keeps none", () => {
    const runs = createRunCompanies();
    runs.note(
      "run-1",
      outcome({ items: [{ companyId: HALYARD, name: "Halyard Security" }] }),
    );
    const block: QAnswerCardsBlock = {
      kind: "ANSWER_CARDS",
      shape: "RANKED",
      title: "Top for your mandate",
      cards: [card("Halyard security"), card("Tensorgate")],
      followUps: [],
    };
    const out = withCardSubjects(block, runs.take("run-1"));
    expect(out.cards.map((c) => c.subject)).toEqual([
      { kind: "COMPANY", companyId: HALYARD },
      null,
    ]);
    // Taken once: another answer of the same run starts empty.
    expect(runs.take("run-1").size).toBe(0);
  });
});
