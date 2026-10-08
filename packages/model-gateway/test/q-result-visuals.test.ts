import { describe, expect, it } from "vitest";

import {
  parseQResultBlocks,
  QResultBlockSchema,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  cardsMap,
  createRunCompanies,
  withCardSubjects,
} from "../src/q/card-subjects.js";
import {
  analystResultBlocks,
  chartBlock,
  investorsTableBlock,
  timelineBlock,
} from "../src/q/result-blocks.js";

/**
 * RECOVERY-2026-10 E3/E4 (audit E-07, E-08): one invalid block costs only
 * itself and is reported; investors resolve as card subjects; maps,
 * tables, timelines and charts are built from the run's reads, never from
 * the model's words, and refuse what must not be drawn.
 */

const APEX = "3ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const NORTHWIND = "4ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const HALYARD = "5ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const COMPANY = "6ab2cc02-160f-4812-a6b1-8be7e43afd3e";

const outcome = (data: unknown): Pick<QToolCallOutcome, "result"> => ({
  result: { ok: true, data },
});

/** The shape find_prospective_investors returns (public profiles only). */
const PROSPECTS = {
  fitVersion: "prospect-fit.v1",
  companySource: "CAPITAL_Q_RECORD",
  compared: { countryCode: "NG", stageCode: "SEED" },
  prospects: [
    {
      investorOrganisationId: APEX,
      name: "Apex Capital",
      investorType: "VC",
      hqCountry: "GB",
      publicDescription: null,
      websiteUrl: null,
      deploymentState: "DEPLOYING",
      reasons: [
        { kind: "STAGE_IN_RANGE", detail: "Invests at Seed" },
        { kind: "SECTOR_MATCH", detail: "Publishes fintech as a focus" },
      ],
      label: "likely fit, not evidence of interest",
      gate: {
        title: "Apex intake",
        acceptingApplications: true,
        criteria: [
          { label: "Revenue", required: true, standing: "MET" },
          { label: "Team", required: true, standing: "UNKNOWN" },
        ],
      },
    },
    {
      investorOrganisationId: NORTHWIND,
      name: "Northwind Ventures",
      investorType: "VC",
      hqCountry: "KE",
      publicDescription: null,
      websiteUrl: null,
      deploymentState: null,
      reasons: [{ kind: "GEOGRAPHY_MATCH", detail: "Invests in Africa" }],
      label: "likely fit, not evidence of interest",
    },
    {
      investorOrganisationId: HALYARD,
      name: "Halyard Partners",
      investorType: "ANGEL_NETWORK",
      hqCountry: null,
      publicDescription: null,
      websiteUrl: null,
      deploymentState: null,
      reasons: [],
      label: "likely fit, not evidence of interest",
    },
  ],
  notes: [],
};

const card = (name: string, measures: { label: string }[] = []) => ({
  key: name.toLowerCase().replace(/\s+/gu, "-"),
  name,
  line: null,
  hue: 1,
  fit: null,
  reasons: ["Publishes a fit"],
  measures: measures.map((measure) => ({
    label: measure.label,
    level: "UNKNOWN" as const,
    value: null,
  })),
  view: null,
  said: null,
  sourceCount: 0,
  subject: null,
});

describe("E3: partial validation of result blocks", () => {
  it("drops only the invalid block and reports it", () => {
    const parsed = parseQResultBlocks([
      { kind: "COMPANY_REFERENCE", companyId: COMPANY },
      { kind: "COMPANY_REFERENCE", companyId: "not-a-uuid" },
      {
        kind: "UNCERTAINTY",
        statement: "No revenue evidence",
        confidence: "INSUFFICIENT_EVIDENCE",
      },
      { kind: "NOT_A_KIND" },
    ]);
    expect(parsed.blocks.map((block) => block.kind)).toEqual([
      "COMPANY_REFERENCE",
      "UNCERTAINTY",
    ]);
    expect(parsed.dropped.map((drop) => [drop.index, drop.kind])).toEqual([
      [1, "COMPANY_REFERENCE"],
      [3, null],
    ]);
    expect(parsed.dropped[0]?.issue).toContain("companyId");
  });

  it("an answer keeps its findings when one card set is invalid, and the drop is logged", () => {
    const dropped: unknown[] = [];
    const blocks = analystResultBlocks({
      result: {
        answer: "x".repeat(200),
        findings: [{ statement: "Revenue is self-reported." }],
        missingEvidence: ["Three months of bank statements"],
        // Two items with the same name are fine for v12 cards, but four
        // points over the limit make the block invalid on its own.
        comparisonCards: {
          title: null,
          items: [
            { name: "A", subtitle: null, points: ["1", "2", "3", "4", "5"] },
            { name: "B", subtitle: null, points: ["1"] },
          ],
        },
      },
      subjects: [{ kind: "COMPANY", companyId: COMPANY }],
      findingId: () => "7ab2cc02-160f-4812-a6b1-8be7e43afd3e",
      onDropped: (drops) => dropped.push(...drops),
    });
    expect(blocks?.map((block) => block.kind)).toEqual([
      "FINDING",
      "UNCERTAINTY",
      "COMPANY_REFERENCE",
    ]);
    expect(dropped).toHaveLength(1);
  });
});

describe("E4: investor card subjects, published fit basis and the map", () => {
  it("resolves investor cards from the run's reads and attaches a map from published countries", () => {
    const runs = createRunCompanies();
    runs.note("run-1", outcome(PROSPECTS));
    const block: QAnswerCardsBlock = {
      kind: "ANSWER_CARDS",
      shape: "SIDE_BY_SIDE",
      title: "The three side by side",
      cards: [
        card("Apex Capital", [{ label: "Based in" }]),
        card("Northwind Ventures", [{ label: "Based in" }]),
        card("Halyard Partners", [{ label: "Based in" }]),
      ],
      followUps: [],
    };
    const out = withCardSubjects(block, runs.take("run-1"));
    expect(out.cards.map((one) => one.subject)).toEqual([
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: APEX },
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: NORTHWIND },
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: HALYARD },
    ]);
    expect(out.cards[0]?.fitBasis).toEqual([
      "Invests at Seed",
      "Publishes fintech as a focus",
      "Their published gate: 1 met, 1 not known yet",
    ]);
    // Halyard publishes no reasons: no basis is invented for it.
    expect(out.cards[2]?.fitBasis).toBeUndefined();
    expect(out.map?.places.map((place) => place.countryCode)).toEqual([
      "GB",
      "KE",
      null,
    ]);
    expect(out.map?.basis).toContain("publishes");
    // The whole block still satisfies the public contract.
    expect(QResultBlockSchema.safeParse(out).success).toBe(true);
  });

  it("draws no map when the answer is not about where they are", () => {
    const runs = createRunCompanies();
    runs.note("run-2", outcome(PROSPECTS));
    const read = runs.take("run-2");
    const cards = withCardSubjects(
      {
        kind: "ANSWER_CARDS",
        shape: "SIDE_BY_SIDE",
        title: "Compared",
        cards: [card("Apex Capital"), card("Northwind Ventures")],
        followUps: [],
      },
      read,
    );
    expect(cards.map).toBeUndefined();
    expect(cardsMap(cards.cards, read.countries)).toBeNull();
  });

  it("a name the run never read keeps no subject (the model cannot cause a reference)", () => {
    const runs = createRunCompanies();
    runs.note("run-3", outcome(PROSPECTS));
    const out = withCardSubjects(
      {
        kind: "ANSWER_CARDS",
        shape: "SIDE_BY_SIDE",
        title: "Compared",
        cards: [card("Made Up Fund", [{ label: "Location" }])],
        followUps: [],
      },
      runs.take("run-3"),
    );
    expect(out.cards[0]?.subject).toBeNull();
    expect(out.map).toBeUndefined();
  });

  it("builds a named, linked table and a map when the model asks for them", () => {
    const runs = createRunCompanies();
    runs.note("run-4", outcome(PROSPECTS));
    const read = runs.take("run-4");
    const table = analystResultBlocks({
      result: { answer: "x".repeat(200), visual: "TABLE" },
      subjects: [],
      read,
    })?.find((block) => block.kind === "TABLE");
    expect(
      table?.kind === "TABLE" && table.columns.map((c) => c.label),
    ).toEqual(["Apex Capital", "Northwind Ventures", "Halyard Partners"]);
    expect(table?.kind === "TABLE" && table.rows[0]?.cells).toEqual([
      "GB",
      "KE",
      "",
    ]);
    const map = analystResultBlocks({
      result: { answer: "x".repeat(200), visual: "MAP" },
      subjects: [],
      read,
    })?.find((block) => block.kind === "MAP");
    expect(map?.kind).toBe("MAP");
    // No hint, nothing laid out.
    expect(
      analystResultBlocks({
        result: { answer: "x".repeat(200) },
        subjects: [],
        read,
      }),
    ).toBeUndefined();
    expect(investorsTableBlock([])).toBeNull();
  });
});

describe("E4: timeline and chart refuse what must not be drawn", () => {
  it("orders events by code and drops undated ones", () => {
    const block = timelineBlock({
      title: "Your relationship",
      events: [
        { at: "2026-10-03", label: "Meeting booked" },
        { at: "not a date", label: "Never placed" },
        { at: "2026-09-12", label: "Interest expressed" },
      ],
    });
    expect(
      block?.kind === "TIMELINE" && block.events.map((e) => e.label),
    ).toEqual(["Interest expressed", "Meeting booked"]);
    expect(QResultBlockSchema.safeParse(block).success).toBe(true);
    // The schema refuses a timeline out of order.
    expect(
      QResultBlockSchema.safeParse({
        kind: "TIMELINE",
        title: "x",
        events: [
          { at: "2026-10-03", label: "b", detail: null, subject: null },
          { at: "2026-09-12", label: "a", detail: null, subject: null },
        ],
      }).success,
    ).toBe(false);
  });

  it("charts only verified or document-backed figures", () => {
    const series = (truthClass: string, evidenceStatus: string) => ({
      label: "Revenue",
      truthClass,
      evidenceStatus,
      source: "Bank statements",
      points: [
        { label: "Jul", value: 10 },
        { label: "Aug", value: 12 },
      ],
    });
    const built = chartBlock({
      chart: "LINE",
      title: "Monthly revenue",
      unit: "a month",
      currency: "USD",
      series: [
        series("USER_CLAIM", "DOCUMENT_SUPPORTED"),
        series("Q_INFERENCE", "SELF_REPORTED"),
        series("USER_CLAIM", "SELF_REPORTED"),
        series("ESTIMATE", "DOCUMENT_SUPPORTED"),
      ] as never,
    });
    expect(built?.kind === "CHART" && built.series).toHaveLength(1);
    expect(
      chartBlock({
        chart: "BAR",
        title: "x",
        unit: "x",
        currency: null,
        series: [series("Q_INFERENCE", "DOCUMENT_SUPPORTED")] as never,
      }),
    ).toBeNull();
    // The contract refuses an inferred series even if a producer tried.
    expect(
      QResultBlockSchema.safeParse({
        kind: "CHART",
        chart: "BAR",
        title: "x",
        unit: "x",
        currency: null,
        series: [series("Q_INFERENCE", "DOCUMENT_SUPPORTED")],
      }).success,
    ).toBe(false);
  });

  it("a map place must be an ISO country code or unknown", () => {
    const place = (countryCode: string | null) => ({
      kind: "MAP",
      title: "Where",
      basis: "As published",
      places: [{ label: "A", countryCode, subject: null, note: null }],
    });
    expect(QResultBlockSchema.safeParse(place("GB")).success).toBe(true);
    expect(QResultBlockSchema.safeParse(place(null)).success).toBe(true);
    expect(QResultBlockSchema.safeParse(place("London")).success).toBe(false);
  });
});
