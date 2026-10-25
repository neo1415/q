import { describe, expect, it } from "vitest";

import type { QAnswerCardsBlock } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  companiesInOutcome,
  createRunCompanies,
  namedCompanySubjects,
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

describe("explicit company finding attribution", () => {
  const profile = (
    companyId = HALYARD,
    canonicalName = "Halyard Security",
  ) => ({
    companyId,
    canonicalName,
    legalName: null,
    websiteUrl: null,
    foundedDate: null,
    headquartersCountry: null,
    headquartersCity: null,
    currentStageCode: null,
    shortDescription: null,
    primaryDescription: null,
    companyStatus: "active",
    relationToYou: "SHARED",
    truthClass: "USER_CLAIM",
  });
  const complete = (data = profile()): QToolCallOutcome => ({
    callId: "profile",
    toolName: "company.get",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "PUBLIC",
    result: { ok: true, data },
    latencyMs: 1,
  });
  it("accepts a complete authorised read and a whole canonical name, never a name embedded in another", () => {
    const runs = createRunCompanies();
    runs.note("r", complete());
    const read = runs.take("r");
    expect(
      namedCompanySubjects("What does Halyard Security do?", read),
    ).toEqual([{ kind: "COMPANY", companyId: HALYARD }]);
    expect(
      namedCompanySubjects("What does Superhalyard Security do?", read),
    ).toEqual([]);
    expect(namedCompanySubjects("What does this company do?", read)).toEqual(
      [],
    );
  });
  it("does not reuse a previous run's authorized profile or a consumed answer", () => {
    const runs = createRunCompanies();
    runs.note("previous", complete());
    expect(runs.read("current").profiles.has(HALYARD)).toBe(false);
    expect(
      namedCompanySubjects("Halyard Security", runs.take("current")),
    ).toEqual([]);
    expect(runs.take("previous").profiles.has(HALYARD)).toBe(true);
    expect(runs.read("previous").profiles.has(HALYARD)).toBe(false);
    runs.note("previous", {
      ...complete(),
      status: "DENIED",
      result: {
        ok: false,
        error: { code: "NOT_AVAILABLE", safeMessage: "Access revoked" },
      },
    });
    expect(runs.read("previous").profiles.has(HALYARD)).toBe(false);
  });
  it.each(["search", "denied", "malformed", "failed", "unclassified"])(
    "does not attribute findings from %s output",
    (kind) => {
      const runs = createRunCompanies();
      const base = complete();
      const read: QToolCallOutcome = {
        ...base,
        ...(kind === "search" ? { toolName: "company.search" } : {}),
        ...(kind === "denied" ? { status: "DENIED" as const } : {}),
        ...(kind === "failed"
          ? {
              result: {
                ok: false as const,
                error: { code: "NOT_AVAILABLE", safeMessage: "Not available" },
              },
            }
          : {}),
        ...(kind === "malformed"
          ? {
              result: {
                ok: true as const,
                data: { companyId: HALYARD, canonicalName: "Halyard Security" },
              },
            }
          : {}),
      };
      runs.note("r", kind === "unclassified" ? { result: read.result } : read);
      expect(namedCompanySubjects("Halyard Security", runs.take("r"))).toEqual(
        [],
      );
    },
  );
  it("leaves duplicate identities and multi-company claims unattributed", () => {
    for (const otherName of ["Halyard Security", "Clearwater Assurance"]) {
      const runs = createRunCompanies();
      runs.note("r", complete());
      runs.note("r", complete(profile(CLEARWATER, otherName)));
      expect(
        namedCompanySubjects(
          "Compare Halyard Security and Clearwater Assurance",
          runs.take("r"),
        ),
      ).toEqual([]);
    }
  });
});

describe("artifacts live: researched identities in the run's reads", () => {
  it("keeps the identity a person-search result names, with its attached image only when credited and https", async () => {
    const { createRunCompanies } = await import("../src/q/card-subjects.js");
    const runs = createRunCompanies();
    const subject = {
      externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
      entityKind: "PERSON",
      researchStatus: "RESEARCHED",
      requiresRefresh: false,
      image: {
        status: "ATTACHED",
        assetUrl: "https://images.example/shadi.jpg",
        attribution: "Photo: Example News",
        licenseNote: "Editorial use",
      },
      quotes: [],
      displayName: "Shadi Qishta",
      nameVariants: ["Shadi Qishta"],
      profileUrl: null,
      role: "Finance Director",
      organization: null,
      location: null,
      evidenceBundleId: null,
      briefVersion: 0,
      confidence: "STRONG",
    };
    runs.note("run-1", {
      status: "SUCCEEDED",
      result: {
        ok: true,
        data: {
          outcome: "MATCHED",
          candidates: [],
          clarifyingQuestion: null,
          elapsedMs: 10,
          card: {
            entityKind: "PERSON",
            subject,
            sources: [
              {
                id: null,
                description: null,
                evidenceClass: null,
                url: "https://example.org/shadi",
                domain: "example.org",
                title: null,
                publishedAt: null,
                retrievedAt: "2026-10-20T00:00:00Z",
                provider: "tavily",
              },
            ],
            uncertainty: [],
            attributionLine: null,
            enriching: false,
            actions: [],
          },
        },
      },
    } as never);
    expect([...runs.read("run-1").externals.values()]).toEqual([
      {
        name: "Shadi Qishta",
        kind: "PERSON",
        externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
        image: {
          url: "https://images.example/shadi.jpg",
          attribution: "Photo: Example News",
        },
      },
    ]);
  });
});

// F-133: an investor's stage, sector and geography as the prospects tool
// judged them, kept on the run's read so a card shows code's levels. A
// related sector (ADJACENT) is not a stated match.
describe("an investor's judged fit on the run's read (F-133)", () => {
  const ids = [
    "51000000-0000-4000-8000-000000000001",
    "52000000-0000-4000-8000-000000000002",
    "53000000-0000-4000-8000-000000000003",
  ];
  it("keeps published stage and geography, and a sector only when it is theirs", () => {
    const companies = createRunCompanies();
    companies.note("run-1", {
      toolName: "investor.prospects",
      status: "SUCCEEDED",
      classification: "READ_ONLY",
      result: {
        ok: true,
        data: {
          prospects: [
            {
              investorOrganisationId: ids[0],
              name: "Zino Aviation",
              hqCountry: "NG",
              sector: { fit: "MATCH", focus: "fintech", closeness: "ADJACENT" },
              publishedFit: {
                stage: "MET",
                sector: "UNKNOWN",
                geography: "MET",
              },
            },
            {
              investorOrganisationId: ids[1],
              name: "Savanna Seed Partners",
              hqCountry: null,
              sector: { fit: "MATCH", focus: "logistics", closeness: "EXACT" },
            },
            {
              investorOrganisationId: ids[2],
              name: "Baobab Ridge Capital",
              hqCountry: null,
            },
          ],
        },
      },
    });
    const fitOf = (id: string | undefined) =>
      [...companies.read("run-1").investors.values()].find(
        (one) => one.investorOrganisationId === id,
      )?.fit;
    expect(fitOf(ids[0])).toEqual({
      stage: "MET",
      sector: "UNKNOWN",
      geography: "MET",
    });
    expect(fitOf(ids[1])).toEqual({
      stage: "UNKNOWN",
      sector: "MET",
      geography: "UNKNOWN",
    });
    expect(fitOf(ids[2])).toBeUndefined();
  });
});
