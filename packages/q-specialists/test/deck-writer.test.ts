import { describe, expect, it } from "vitest";

import {
  QArtifactContentSchema,
  type CorrelationId,
  type ModelGatewayResultMetadata,
  type QArtifactContent,
  type QSlideImage,
} from "@capital-q/contracts";
import {
  acceptStructuredOutput,
  ModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import { DocumentPolishResultSchema } from "@capital-q/q-core";

import {
  composePitchDeck,
  createDeckPolisher,
  inCompanyVoice,
  runDocumentPipeline,
  splitStatement,
  statFigure,
  writeDeckSlides,
  type DocumentPipelineInput,
  type StockPhotoPort,
} from "../src/index.js";
import type {
  CompanyFinding,
  CompanyIntelligenceResult,
} from "../src/company/contracts.js";

/**
 * Live 2026-10-07 (wave 5b): the first live deck (Ledgerline) shipped as
 * one-paragraph STATEMENT slides in the record's narrator voice, with no
 * photo, because one over-long bullet refused the whole polish. Fakes only:
 * no provider is reached.
 */

const COMPANY = "f0000000-0000-4000-8000-000000000002";
let seq = 0;
function finding(
  dimension: string,
  statement: string,
  truthClass = "USER_CLAIM",
): CompanyFinding {
  seq += 1;
  return {
    findingId: `b0000000-0000-4000-8000-0000000000${String(10 + (seq % 80))}`,
    type: "FACT",
    statement,
    truthClass,
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    evidenceRefs: [],
    dimension,
    derivation: "MODEL",
  } as unknown as CompanyFinding;
}

function result(findings: CompanyFinding[]): CompanyIntelligenceResult {
  return {
    companyId: COMPANY,
    specialistVersion: "company-intelligence/v1",
    asOf: "2026-10-07T00:00:00.000Z",
    blocked: null,
    findings,
    coverage: [],
    materialChanges: [],
    contradictions: [],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {} as CompanyIntelligenceResult["telemetry"],
  };
}

// One statement per dimension, as the live record held them.
const FINDINGS = [
  finding(
    "DESCRIPTION",
    "Ledgerline is described as VAT compliance software for Nigerian small businesses that files returns automatically from their sales records, founded in 2023.",
  ),
  finding(
    "MARKET",
    "The deck estimates that Nigeria has about 40 million small businesses, most of which file VAT by hand through accountants and pay late filing penalties every quarter.",
    "ESTIMATE",
  ),
  finding(
    "TRACTION",
    "Ledgerline has 1,140 paying businesses; ₦38m MRR; 96% retention after twelve months on the platform.",
  ),
  finding(
    "STRATEGY",
    "The company plans to add payroll filing in 2027, while expanding to Ghana and Kenya through accounting firm partners.",
  ),
  finding(
    "TEAM",
    "The founders previously built tax tooling at a Lagos accounting firm.",
  ),
];
const GROUNDING = FINDINGS.map((item) => item.statement);

function ledgerline(): QArtifactContent {
  const composed = composePitchDeck({
    companyName: "Ledgerline",
    result: result(FINDINGS),
  });
  if (composed === null) throw new Error("fixture deck did not compose");
  return composed.content;
}

const NARRATOR =
  /is described as|the deck estimates|according to the deck|the company states/i;

const attribution = {
  tenantId: "t1",
  userId: "u1",
  qRunId: "r1",
  correlationId: "c1" as CorrelationId,
};

function base(
  overrides: Partial<DocumentPipelineInput> = {},
): DocumentPipelineInput {
  return {
    kind: "PITCH_DECK",
    grounding: GROUNDING,
    sectorCodes: ["fintech"],
    directionChosen: false,
    brand: null,
    sensitivity: "STANDARD" as DocumentPipelineInput["sensitivity"],
    attribution,
    ...overrides,
  };
}

const FAKE_RESULT_METADATA: ModelGatewayResultMetadata = {
  providerCode: "fake",
  modelCode: "fake-model",
  taskClass: "NORMAL_DIALOGUE",
  routingPolicyCode: "fake.v1",
  usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  latencyMs: 0,
  finish: "COMPLETE",
  cost: { currency: "USD", amount: 0, basis: "UNPRICED" },
  attempts: [
    {
      attempt: 1,
      providerCode: "fake",
      modelCode: "fake-model",
      outcome: "SUCCESS",
      latencyMs: 0,
      candidateIndex: 0,
    },
  ],
  fallbackUsed: false,
  route: {
    routingPolicyCode: "fake.v1",
    routingPolicyVersion: 1,
    candidates: [],
    selectedCandidateIndex: 0,
    fallbackUsed: false,
  },
  completedAt: "2026-10-07T00:00:00.000Z",
};

/**
 * A gateway that answers with fixed provider text, accepted exactly as the
 * real one accepts it (decode, then the caller's Zod schema), and that
 * throws INVALID_MODEL_OUTPUT on a refusal the way the real one does.
 */
function fakeGateway(answers: readonly string[]) {
  const calls: { taskClass: string }[] = [];
  const gateway: ModelGateway = {
    execute: (request, options) => {
      calls.push({ taskClass: request.taskClass });
      const text =
        answers[Math.min(calls.length - 1, answers.length - 1)] ?? "";
      if (options?.schema === undefined) throw new Error("schema expected");
      const accepted = acceptStructuredOutput(text, options.schema, {
        invalidListItems: options.invalidListItems,
      });
      if (!accepted.ok) {
        return Promise.reject(
          new ModelGatewayError("refused", {
            failureClass: "INVALID_MODEL_OUTPUT",
            attempts: 1,
            candidates: [],
            routingPolicyCode: undefined,
          }),
        );
      }
      return Promise.resolve({
        ...FAKE_RESULT_METADATA,
        taskClass: request.taskClass,
        output: { kind: "STRUCTURED", value: accepted.value },
      });
    },
  };
  return { gateway, calls };
}

/** The live failure: slide 5's first bullet past 180 characters. */
function liveAnswer(deck: QArtifactContent): string {
  const slides = deck.deck?.slides ?? [];
  const at = slides.findIndex((slide) => slide.bullets.length > 0);
  const target = slides[at];
  if (target === undefined) throw new Error("no bullet slide");
  const long = `We file VAT returns for Nigerian small businesses straight from their sales records ${"so owners never chase an accountant again and never pay a late filing penalty ".repeat(3)}`;
  return JSON.stringify({
    slides: [
      {
        number: at + 1,
        title: "VAT filing on autopilot",
        subtitle: null,
        bullets: target.bullets.map((line, index) =>
          index === 0 ? long : line,
        ),
      },
    ],
  });
}

function logger() {
  const warned: { fields: Record<string, unknown>; message: string }[] = [];
  const log = {
    warn: (fields: Record<string, unknown>, message: string) => {
      warned.push({ fields, message });
    },
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => log,
  };
  return { log, warned };
}

describe("the deck writer (deterministic)", () => {
  it("puts narrator phrasing in the company's own voice, facts unchanged", () => {
    expect(
      inCompanyVoice("Ledgerline is described as VAT compliance software."),
    ).toBe("Ledgerline is VAT compliance software.");
    expect(
      inCompanyVoice("The deck estimates the market at ₦2.1bn a year."),
    ).toBe("We estimate the market at ₦2.1bn a year.");
    expect(
      inCompanyVoice("The company states that 40 firms pay monthly."),
    ).toBe("40 firms pay monthly.");
    expect(inCompanyVoice("The company plans to add payroll.")).toBe(
      "We plan to add payroll.",
    );
  });

  it("splits a long statement into two to four short bullets, keeping lists whole", () => {
    const pieces = splitStatement(FINDINGS[0]?.statement ?? "");
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces.length).toBeLessThanOrEqual(4);
    expect(pieces.every((piece) => piece.length <= 180)).toBe(true);
    expect(
      splitStatement("We serve bakeries, mills and grocers in Lagos."),
    ).toEqual(["We serve bakeries, mills and grocers in Lagos"]);
  });

  it("reads a stat as the record writes it, and never a year", () => {
    expect(statFigure("1,140 paying businesses")).toEqual({
      value: "1,140",
      label: "paying businesses",
    });
    expect(statFigure("₦38m MRR")).toEqual({ value: "₦38m", label: "MRR" });
    expect(statFigure("96% retention after twelve months")).toEqual({
      value: "96%",
      label: "retention after twelve months",
    });
    expect(statFigure("Founded in 2023")).toBeNull();
  });

  it("turns STATEMENT-only input into mixed layouts with bullets and figures", () => {
    const composed = ledgerline();
    const before = composed.deck?.slides ?? [];
    // As live: the composer's content slides are one-paragraph statements.
    expect(
      before.filter((slide) => slide.layout === "STATEMENT").length,
    ).toBeGreaterThanOrEqual(4);
    const slides = writeDeckSlides(composed).deck?.slides ?? [];
    const layouts = new Set(slides.map((slide) => slide.layout));
    expect(layouts.has("TITLE")).toBe(true);
    expect(layouts.has("BULLETS")).toBe(true);
    expect(
      slides.filter((slide) => slide.layout === "BULLETS").length,
    ).toBeGreaterThanOrEqual(2);
    const traction = slides.find((slide) => slide.figures !== undefined);
    expect(traction?.figures?.map((figure) => figure.value)).toEqual([
      "1,140",
      "₦38m",
      "96%",
    ]);
    // A numbers slide says its headline number in its title.
    expect(traction?.title).toBe("1,140 paying businesses");
    for (const slide of slides) {
      for (const line of [
        slide.title,
        slide.subtitle ?? "",
        ...slide.bullets,
      ]) {
        expect(line).not.toMatch(NARRATOR);
      }
    }
    // Still a valid deck.
    const out = writeDeckSlides(composed);
    expect(QArtifactContentSchema.parse(out)).toEqual(out);
  });
});

describe("the words step (fake gateway)", () => {
  it("a bullet past the slide's limit no longer discards the polish: trimmed and logged", async () => {
    const deck = writeDeckSlides(ledgerline());
    const answer = liveAnswer(deck);
    // The v1 schema refused exactly this answer, live.
    const v1 = acceptStructuredOutput(answer, DocumentPolishResultSchema);
    expect(v1.ok).toBe(false);
    if (!v1.ok) expect(v1.refusals?.[0]).toMatch(/bullets\.0:too_big/);

    const { gateway, calls } = fakeGateway([answer]);
    const { log, warned } = logger();
    const polisher = createDeckPolisher({
      gateway,
      logger: log,
    });
    const polished = await polisher.polish({
      deck: deck.deck ?? {
        slides: [],
        direction: "MINIMAL_INSTITUTIONAL",
        markIsDraft: false,
      },
      sensitivity: "STANDARD" as DocumentPipelineInput["sensitivity"],
      attribution,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.taskClass).toBe("NORMAL_DIALOGUE");
    const slide = polished?.slides[0];
    expect(slide?.title).toBe("VAT filing on autopilot");
    expect(slide?.bullets?.[0]?.length).toBeLessThanOrEqual(180);
    expect(slide?.bullets?.[0]).not.toMatch(/\s$/);
    expect(
      warned.some(
        (entry) =>
          entry.message.includes("trimmed") &&
          JSON.stringify(entry.fields).includes("bullets.0"),
      ),
    ).toBe(true);
  });

  it("an unreadable answer gets one repair attempt, never more", async () => {
    const deck = writeDeckSlides(ledgerline());
    const repaired = await createDeckPolisher({
      gateway: fakeGateway(["not json", liveAnswer(deck)]).gateway,
    }).polish({
      deck: deck.deck ?? {
        slides: [],
        direction: "MINIMAL_INSTITUTIONAL",
        markIsDraft: false,
      },
      sensitivity: "STANDARD" as DocumentPipelineInput["sensitivity"],
      attribution,
    });
    expect(repaired?.slides[0]?.title).toBe("VAT filing on autopilot");

    const broken = fakeGateway(["not json"]);
    const none = await createDeckPolisher({ gateway: broken.gateway }).polish({
      deck: deck.deck ?? {
        slides: [],
        direction: "MINIMAL_INSTITUTIONAL",
        markIsDraft: false,
      },
      sensitivity: "STANDARD" as DocumentPipelineInput["sensitivity"],
      attribution,
    });
    expect(none).toBeNull();
    expect(broken.calls).toHaveLength(2);
  });

  it("the pipeline ships a polished, real deck from the live failure, with photos on 3+ slides", async () => {
    const composed = ledgerline();
    const shaped = writeDeckSlides(composed);
    const { gateway } = fakeGateway([liveAnswer(shaped)]);
    const queries: string[] = [];
    let n = 0;
    const photos: StockPhotoPort = {
      search: (query) => {
        queries.push(query);
        n += 1;
        const photo: QSlideImage = {
          url: `https://images.pexels.com/photos/${String(n)}/a.jpeg`,
          alt: "Photo",
          credit: `Photo by A${String(n)} on Pexels`,
        };
        return Promise.resolve([photo]);
      },
    };
    const out = await runDocumentPipeline(
      composed,
      base({ polisher: createDeckPolisher({ gateway }), photos }),
    );
    const slides = out.content.deck?.slides ?? [];
    expect(
      slides.some((slide) => slide.title === "VAT filing on autopilot"),
    ).toBe(true);
    const pictured = slides.filter((slide) => slide.image !== undefined);
    expect(pictured.length).toBeGreaterThanOrEqual(3);
    // Sector plus the slide's subject, never a sentence of the record.
    expect(queries.every((query) => query.startsWith("fintech "))).toBe(true);
    // The team's picture is theirs: a marked space, never stock.
    const team = slides.find((slide) => slide.placeholder?.kind === "IMAGE");
    expect(team?.image).toBeUndefined();
    // Mixed layouts, no narrator phrasing, every figure grounded.
    expect(
      new Set(slides.map((slide) => slide.layout)).size,
    ).toBeGreaterThanOrEqual(2);
    for (const slide of slides) {
      for (const line of [
        slide.title,
        slide.subtitle ?? "",
        ...slide.bullets,
      ]) {
        expect(line).not.toMatch(NARRATOR);
      }
    }
    expect(
      out.content.audit?.checks.find(
        (check) => check.code === "FIGURES_GROUNDED",
      )?.ok,
    ).toBe(true);
    expect(QArtifactContentSchema.parse(out.content)).toEqual(out.content);
  });
});

describe("inCompanyVoice: narrator qualifiers", () => {
  it("drops 'stated' and 'documented' without changing the fact", () => {
    expect(
      inCompanyVoice(
        "Our stated model is a monthly subscription per legal entity",
      ),
    ).toBe("Our model is a monthly subscription per legal entity");
    expect(inCompanyVoice("The documented strategy combines referrals")).toBe(
      "The strategy combines referrals",
    );
  });
});
