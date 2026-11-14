import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import {
  correctsOwnCompany,
  readsAsAboutSubjectCompany,
} from "../src/company/about-company.js";
import { createCompanyIntelligenceSpecialist } from "../src/company/specialist.js";

/**
 * Which questions the company specialist may take: decided from Q's turn
 * reader (a model reading, ADR 0011/0016), never from patterns over the
 * person's words.
 */
const reading = (
  kind: string,
  questionKind: string | null = null,
  aboutNamedOther = false,
) => ({ kind, questionKind, aboutNamedOther });

describe("whether a question is about the company in the conversation", () => {
  it("takes a request for Q's judgement about the subject", () => {
    expect(readsAsAboutSubjectCompany(reading("QUESTION_TO_Q", "ADVICE"))).toBe(
      true,
    );
    expect(readsAsAboutSubjectCompany(reading("CORRECTION"))).toBe(true);
  });

  it("sends small talk, requests, other subjects and the outside world elsewhere", () => {
    for (const read of [
      reading("SMALL_TALK"),
      reading("OFF_TOPIC"),
      reading("TOOL_REQUEST"),
      reading("RESEARCH_REQUEST", "PUBLIC_FACTS"),
      reading("QUESTION_TO_Q", "PUBLIC_FACTS"),
      reading("QUESTION_TO_Q", "REAL_WORLD_EXAMPLE"),
      reading("QUESTION_TO_Q", "ABOUT_CAPITAL_Q"),
      reading("QUESTION_TO_Q", "ADVICE", true),
      reading("CORRECTION", null, true),
    ]) {
      expect(readsAsAboutSubjectCompany(read), JSON.stringify(read)).toBe(
        false,
      );
    }
  });

  it("sends a turn the reader could not read to the conversational path", () => {
    expect(readsAsAboutSubjectCompany(null)).toBe(false);
  });

  it("routes on the reading, not on the words", () => {
    const specialist = createCompanyIntelligenceSpecialist({} as never);
    const subjects = [
      { kind: "COMPANY", companyId: "11111111-1111-4111-8111-111111111111" },
    ] as never;
    // Words no pattern would have recognised, read as advice: taken.
    expect(
      specialist.supports({
        capability: "ANSWER",
        subjects,
        question: "be honest, would you put money in?",
        reading: reading("QUESTION_TO_Q", "ADVICE"),
      }),
    ).toBe(true);
    // First-person words read as small talk: not taken.
    expect(
      specialist.supports({
        capability: "ANSWER",
        subjects,
        question: "how are we doing today, Q?",
        reading: reading("SMALL_TALK"),
      }),
    ).toBe(false);
  });
});

/**
 * A8 (live 14 Nov 2026): a founder's correction about their own company is
 * for the path that can prepare its approval card. Decided from the
 * reader's kind and the firewall's plan, never from words.
 */
describe("whether a turn corrects the person's own company", () => {
  const OWN = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";
  const OTHER = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
  const subjects = [{ kind: "COMPANY" as const, companyId: OWN }];
  const plan = (
    companyId: string,
    contextLabel: string,
  ): Pick<PermittedContextPlan, "scopes"> =>
    ({
      scopes: [
        {
          kind: "COMPANY_PROFILE",
          subject: { kind: "COMPANY", companyId },
          contextLabel,
        },
      ],
    }) as unknown as Pick<PermittedContextPlan, "scopes">;
  const correction = { kind: "CORRECTION", aboutNamedOther: false };

  it("takes a correction about the company the plan holds on its owner's side", () => {
    expect(
      correctsOwnCompany(correction, subjects, plan(OWN, "organisation_private")),
    ).toBe(true);
  });

  it("never an investor's view, another company, another kind or someone named", () => {
    expect(
      correctsOwnCompany(correction, subjects, plan(OWN, "network_visible")),
    ).toBe(false);
    expect(
      correctsOwnCompany(
        correction,
        subjects,
        plan(OTHER, "organisation_private"),
      ),
    ).toBe(false);
    for (const kind of ["ANSWER", "QUESTION_TO_Q", "SMALL_TALK"]) {
      expect(
        correctsOwnCompany(
          { kind, aboutNamedOther: false },
          subjects,
          plan(OWN, "organisation_private"),
        ),
      ).toBe(false);
    }
    expect(
      correctsOwnCompany(
        { kind: "CORRECTION", aboutNamedOther: true },
        subjects,
        plan(OWN, "organisation_private"),
      ),
    ).toBe(false);
    expect(
      correctsOwnCompany(null, subjects, plan(OWN, "organisation_private")),
    ).toBe(false);
  });
});
