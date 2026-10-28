import { describe, expect, it } from "vitest";

import {
  QDocumentToolResultSchema,
  Q_TASK_CLASSES,
  QWorkbookSchema,
  type PermittedContextPlan,
  type QArtifactContent,
  type QResultBlock,
} from "@capital-q/contracts";

import {
  buildComparisonSheet,
  buildFiguresSheet,
  buildPipelineSheet,
  buildRankedSheet,
  buildTableSheet,
  createMakeSpreadsheetTool,
  createQToolExecutor,
  createQToolRegistry,
  type ShownAnswer,
  type SpreadsheetPort,
} from "../src/index.js";
import type { QToolPorts } from "../src/ports.js";
import { actorA, actorB, contextFor, fakePorts, planFor } from "./support.js";

/**
 * XLSX-001: "an Excel of my pipeline", "put that in a spreadsheet". The
 * builders map typed records to the sheet spec by code -- unknown stays
 * blank, money keeps its currency, totals only where arithmetic -- and the
 * tool files it as the person's own SPREADSHEET with its card.
 */

const TODAY = "2026-10-28";
const REL_1 = "11111111-1111-4111-8111-111111111111";
const REL_2 = "22222222-2222-4222-8222-222222222222";
const CO_1 = "33333333-3333-4333-8333-333333333333";
const CO_2 = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";
const ARTIFACT = "66666666-6666-4666-8666-666666666666";

const relationships = [
  {
    relationshipId: REL_1,
    counterpart: {
      kind: "INVESTOR_ORGANISATION" as const,
      id: CO_1,
      name: "Zino Aviation Capital",
    },
    state: "IN_DILIGENCE",
    stateSince: "2026-10-01T09:00:00.000Z",
    nextStep: "DECIDE_NEXT_STEP",
    lastMessageRead: "OK" as const,
    lastMessage: { from: "THEM" as const, at: "2026-10-07T15:43:00.000Z" },
  },
  {
    relationshipId: REL_2,
    counterpart: {
      kind: "INVESTOR_ORGANISATION" as const,
      id: CO_2,
      name: "Halyard Ventures",
    },
    state: "INTEREST_EXPRESSED",
    stateSince: "2026-10-05T09:00:00.000Z",
    nextStep: "NONE",
    // The chat could not be read: unknown, never "no messages".
    lastMessageRead: "UNAVAILABLE" as const,
  },
];

describe("the builders", () => {
  it("pipeline: one row per relationship, dates typed, unknown blank, sourced as VERIFIED history", () => {
    const built = buildPipelineSheet(
      { side: "COMPANY", relationships, decisions: [], today: TODAY },
      {},
    );
    expect(built).not.toBeNull();
    const sheet = built?.workbook.sheets[0];
    expect(sheet?.name).toBe("Pipeline");
    expect(sheet?.rows[0]).toEqual([
      "Zino Aviation Capital",
      "Investor",
      "In diligence",
      "2026-10-01",
      "Decide next step",
      "Them",
      "2026-10-07",
    ]);
    // No next step, an unread chat: blanks, not "None" or "No messages".
    expect(sheet?.rows[1]?.slice(4)).toEqual([null, null, null]);
    expect(built?.workbook.sources[0]).toMatchObject({
      sheet: "Pipeline",
      truthClass: "VERIFIED",
    });
    expect(built?.workbook.sources[0]?.refs.map((ref) => ref.id)).toEqual([
      REL_1,
      REL_2,
    ]);
    expect(built?.gaps.length).toBe(1);
    expect(QWorkbookSchema.safeParse(built?.workbook).success).toBe(true);
  });

  it("pipeline: the model picks columns and a name, never values; nothing to build is null", () => {
    const built = buildPipelineSheet(
      { side: "COMPANY", relationships, decisions: [], today: TODAY },
      {
        sheetName: "My raise: Q4/2026",
        columns: ["counterparty", "stage", "made-up"],
      },
    );
    const sheet = built?.workbook.sheets[0];
    expect(sheet?.name).toBe("My raise Q4 2026");
    expect(sheet?.columns.map((c) => c.key)).toEqual(["counterparty", "stage"]);
    expect(
      buildPipelineSheet(
        { side: "NONE", relationships: [], decisions: [], today: TODAY },
        {},
      ),
    ).toBeNull();
  });

  it("figures: money keeps its own currency, percent and counts typed, unknown blank, truth class per row", () => {
    const built = buildFiguresSheet(
      {
        companyId: CO_1,
        companyName: "Ledgerfold",
        today: TODAY,
        figures: [
          {
            key: "financial.monthly_revenue",
            statement: "Monthly revenue of about USD 38,000.",
            value: { kind: "MONEY", amount: "38000", currency: "USD" },
            asOf: "2026-03-31",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
          {
            key: "financial.loan_book",
            statement: "Loan book of NGN 410,000,000.",
            value: { kind: "MONEY", amount: "410000000", currency: "NGN" },
            asOf: null,
            truthClass: "USER_CLAIM",
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
          {
            key: "financial.par30",
            statement: "PAR30 of 3.8%.",
            value: { kind: "PERCENT", value: "3.8" },
            asOf: null,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
          {
            key: "traction.active_customers",
            statement: "6,400 traders.",
            value: { kind: "COUNT", value: 6400, asOf: "2026-03-31" },
            asOf: null,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
          {
            key: "financial.gross_margin",
            statement: "Gross margin has not been disclosed.",
            value: null,
            asOf: null,
            truthClass: "UNKNOWN",
            evidenceStatus: "NO_EVIDENCE",
          },
        ],
      },
      {},
    );
    const sheet = built?.workbook.sheets[0];
    const at = (key: string) =>
      sheet?.columns.findIndex((column) => column.key === key) ?? -1;
    expect(sheet?.rows[0]?.[at("amount")]).toEqual({
      amount: "38000",
      currency: "USD",
    });
    expect(sheet?.rows[1]?.[at("amount")]).toEqual({
      amount: "410000000",
      currency: "NGN",
    });
    // Two currencies: the column names none and carries no total.
    expect(sheet?.columns[at("amount")]?.currency).toBeUndefined();
    expect(sheet?.totals).toEqual([]);
    expect(sheet?.rows[2]?.[at("percent")]).toBe("3.8");
    expect(sheet?.rows[3]?.[at("number")]).toBe("6400");
    expect(sheet?.rows[3]?.[at("asOf")]).toBe("2026-03-31");
    // Unknown is blank in every value column, never zero.
    expect(
      [at("amount"), at("number"), at("percent")].map(
        (index) => sheet?.rows[4]?.[index],
      ),
    ).toEqual([null, null, null]);
    expect(sheet?.rows[4]?.[at("truthClass")]).toBe("Unknown");
    expect(built?.workbook.sources[0]?.truthClass).toBeNull();
  });

  it("table: decimal columns become numbers, others stay text as shown, empty is unknown", () => {
    const block: Extract<QResultBlock, { kind: "TABLE" }> = {
      kind: "TABLE",
      title: "Raise by company",
      columns: [
        { label: "Raise (USD)", subject: null },
        { label: "Stage", subject: null },
      ],
      rows: [
        { label: "Ledgerfold", cells: ["2000000", "Seed"] },
        { label: "Zino", cells: ["", "Series A"] },
      ],
    };
    const built = buildTableSheet(
      block,
      { messageId: MESSAGE, today: TODAY },
      {},
    );
    const sheet = built.workbook.sheets[0];
    expect(sheet?.columns.map((c) => c.type)).toEqual([
      "text",
      "number",
      "text",
    ]);
    expect(sheet?.rows).toEqual([
      ["Ledgerfold", "2000000", "Seed"],
      ["Zino", null, "Series A"],
    ]);
    expect(built.workbook.sources[0]?.refs[0]).toEqual({
      kind: "Q_ANSWER",
      id: MESSAGE,
    });
  });

  it("comparison: subjects become columns under the names the reader may see", () => {
    const block: Extract<QResultBlock, { kind: "COMPARISON" }> = {
      kind: "COMPARISON",
      subjects: [
        { kind: "COMPANY", companyId: CO_1 },
        { kind: "COMPANY", companyId: CO_2 },
      ],
      rows: [{ label: "Stage", values: ["Seed", ""] }],
    };
    const built = buildComparisonSheet(
      block,
      {
        names: new Map([[CO_1, "Ledgerfold"]]),
        messageId: MESSAGE,
        today: TODAY,
      },
      {},
    );
    const sheet = built.workbook.sheets[0];
    expect(sheet?.columns.map((c) => c.label)).toEqual([
      "Measure",
      "Ledgerfold",
      "Subject 2",
    ]);
    expect(sheet?.rows[0]).toEqual(["Stage", "Seed", null]);
  });

  it("ranked list: rank and fit typed, fit sourced as Q's inference, raise copied as words", () => {
    const built = buildRankedSheet(
      {
        kind: "ANSWER_CARDS",
        shape: "RANKED",
        title: "Top two for your mandate",
        followUps: [],
        cards: [
          {
            key: "a",
            name: "Ledgerfold",
            line: "Working capital for traders",
            raise: "$2 million",
            hue: 1,
            fit: { score: 7.5, measured: 4, of: 6 },
            reasons: ["Fintech in Nigeria"],
            measures: [],
            view: null,
            said: null,
            sourceCount: 2,
            subject: { kind: "COMPANY", companyId: CO_1 },
          },
          {
            key: "b",
            name: "Zino",
            line: null,
            hue: 2,
            fit: null,
            reasons: ["Aviation"],
            measures: [],
            view: null,
            said: null,
            sourceCount: 1,
            subject: null,
          },
        ],
      },
      { messageId: MESSAGE, today: TODAY },
      {},
    );
    const sheet = built.workbook.sheets[0];
    expect(sheet?.rows[0]?.slice(0, 6)).toEqual([
      "1",
      "Ledgerfold",
      "Working capital for traders",
      "$2 million",
      "7.5",
      "4",
    ]);
    expect(sheet?.rows[1]?.slice(3, 6)).toEqual([null, null, null]);
    expect(
      built.workbook.sources.find(
        (source) => source.truthClass === "Q_INFERENCE",
      )?.columns,
    ).toEqual(["Fit (out of 10)", "Measures known"]);
  });
});

// --- the tool -------------------------------------------------------------

function ownPlan(actor = actorA, userId = actor.userId): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId } }
        : scope,
    ),
  };
}

function setUp(shown: readonly ShownAnswer[] = []) {
  const filed: { title: string; content: QArtifactContent }[] = [];
  const port: SpreadsheetPort = {
    shownAnswers: () => Promise.resolve(shown),
    file: (input) => {
      filed.push({ title: input.title, content: input.content });
      return Promise.resolve({
        artifactId: ARTIFACT,
        type: "SPREADSHEET",
        status: "READY",
        title: input.title,
        currentVersion: 1,
      });
    },
    today: () => TODAY,
  };
  const ports: QToolPorts = fakePorts({
    relationships: {
      ...fakePorts().relationships,
      ownRelationships: () =>
        Promise.resolve({
          side: "COMPANY",
          items: relationships.map((item) => ({
            ...item,
            counterpart: { ...item.counterpart },
            milestones: [],
            nextStep: item.nextStep as "NONE",
            state: item.state as "IN_DILIGENCE",
          })),
        }),
    } as QToolPorts["relationships"],
  });
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createMakeSpreadsheetTool(ports, port)]),
  });
  const run = (
    args: Record<string, unknown>,
    actor = actorA,
    plan = ownPlan(),
  ) =>
    executor.execute(
      { callId: "c-1", name: "make_spreadsheet", arguments: args },
      contextFor(actor, plan),
    );
  return { run, filed };
}

describe("make_spreadsheet", () => {
  it("files their pipeline as a SPREADSHEET and returns its card", async () => {
    const { run, filed } = setUp();
    const outcome = await run({ source: "PIPELINE" });
    expect(outcome.result.ok).toBe(true);
    const card = QDocumentToolResultSchema.parse(
      (outcome.result as { data: unknown }).data,
    );
    expect(card.document).toMatchObject({
      artifactId: ARTIFACT,
      type: "SPREADSHEET",
      status: "READY",
    });
    expect(filed).toHaveLength(1);
    expect(filed[0]?.content.workbook?.sheets[0]?.rows).toHaveLength(2);
    expect(filed[0]?.content.sections[0]?.heading).toBe(
      "What is in this spreadsheet",
    );
  });

  it("puts the newest table Q showed in a sheet ('put that in Excel')", async () => {
    const table: QResultBlock = {
      kind: "TABLE",
      title: "Newest",
      columns: [{ label: "Raise", subject: null }],
      rows: [{ label: "Ledgerfold", cells: ["2000000"] }],
    };
    const older: QResultBlock = { ...table, title: "Older" };
    const { run, filed } = setUp([
      { messageId: MESSAGE, blocks: [{ kind: "TEXT", text: "Here." }, table] },
      { messageId: ARTIFACT, blocks: [older] },
    ]);
    const outcome = await run({ source: "SHOWN_TABLE" });
    expect(outcome.result.ok).toBe(true);
    expect(filed[0]?.title).toBe("Newest");
  });

  it("says there is nothing to put in it rather than inventing rows", async () => {
    const { run, filed } = setUp([]);
    const outcome = await run({ source: "SHOWN_COMPARISON" });
    expect((outcome.result as { data: unknown }).data).toEqual({
      status: "NOTHING_TO_PUT_IN_IT",
    });
    expect(filed).toHaveLength(0);
  });

  it("refuses outside the person's own conversation", async () => {
    const { run, filed } = setUp();
    const outcome = await run(
      { source: "PIPELINE" },
      actorB,
      ownPlan(actorA, actorA.userId),
    );
    expect(outcome.result.ok).toBe(false);
    expect(filed).toHaveLength(0);
  });

  it("refuses a companyId without COMPANY_FIGURES", async () => {
    const { run } = setUp();
    const outcome = await run({ source: "PIPELINE", companyId: CO_1 });
    expect(outcome.result.ok).toBe(false);
  });
});

describe("make_spreadsheet's place in the offer", () => {
  const port: SpreadsheetPort = {
    shownAnswers: () => Promise.resolve([]),
    file: () => Promise.reject(new Error("not used")),
  };
  const sheet = createMakeSpreadsheetTool(fakePorts(), port);
  // A purpose's own tool that serves more purposes than the spreadsheet.
  const own: typeof sheet = {
    ...sheet,
    id: "documents.own.other",
    providerName: "other_own_tool",
    offerLast: false,
    supportedPurposes: [...Q_TASK_CLASSES],
  };
  const registry = createQToolRegistry([sheet, own]);
  const names = (focus?: { areas: string[]; tools: string[] }) =>
    registry
      .ranked({ ...contextFor(actorA, ownPlan()), focus })
      .map((record) => record.definition.providerName);

  it("comes after the purpose's own tools when the turn names nothing", () => {
    expect(names()).toEqual(["other_own_tool", "make_spreadsheet"]);
  });

  it("leads when the turn names it or is about documents", () => {
    expect(names({ areas: [], tools: ["make_spreadsheet"] })[0]).toBe(
      "make_spreadsheet",
    );
    expect(names({ areas: ["Documents"], tools: [] })[0]).toBe(
      "make_spreadsheet",
    );
  });
});
