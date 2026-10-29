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
  SPREADSHEET_NOTHING_LINE,
  spreadsheetReceipt,
  type PipelineFit,
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
    // Every counterparty is an investor: no column of one repeated word.
    expect(sheet?.columns.map((c) => c.key)).not.toContain("kind");
    expect(sheet?.rows[0]).toEqual([
      "Zino Aviation Capital",
      "In diligence",
      "2026-10-01",
      "Decide next step",
      "Them",
      "2026-10-07",
    ]);
    // No next step, an unread chat: blanks, not "None" or "No messages".
    expect(sheet?.rows[1]?.slice(3)).toEqual([null, null, null]);
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

  it("side by side: the receipt names each blank cell by its measure and company (live 2026-10-29)", () => {
    const built = buildTableSheet(
      {
        kind: "TABLE",
        title: "Side by side",
        columns: [
          { label: "MedTrail", subject: null },
          { label: "Mizan", subject: null },
        ],
        rows: [
          { label: "Stage", cells: ["Seed", "Seed"] },
          { label: "Traction", cells: ["", ""] },
          { label: "Team", cells: ["Vikram (founder)", ""] },
        ],
      },
      { messageId: MESSAGE, today: TODAY },
      {},
    );
    expect(built.workbook.sheets[0]?.rows[1]).toEqual(["Traction", null, null]);
    const said = spreadsheetReceipt(built);
    expect(said).toContain(
      "Not filled: Traction: not known for MedTrail and Mizan, left blank; Team: not known for Mizan, left blank.",
    );
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
      says: SPREADSHEET_NOTHING_LINE,
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

// --- XLSX-002: live test of 2026-10-28 ------------------------------------

/**
 * "My partner wants to go through where we are with every company in our
 * pipeline — stage, cheque fit, last contact and what's next": the sheet
 * left cheque fit out though Q read fit in the same run, and the reply was
 * only an offer. Fit is now joined on the company id, typed (money with
 * its currency, the score a number), and the tool says what it made.
 */
const INV_REL_1 = "77777777-7777-4777-8777-777777777777";
const INV_REL_2 = "88888888-8888-4888-8888-888888888888";
const INV_REL_3 = "99999999-9999-4999-8999-999999999999";
const CO_3 = "aaaaaaaa-0000-4000-8000-000000000003";

const pipeline = [
  {
    relationshipId: INV_REL_1,
    counterpart: { kind: "COMPANY" as const, id: CO_1, name: "MedTrail" },
    state: "CONNECTED",
    stateSince: "2026-10-03T09:00:00.000Z",
    nextStep: "SCHEDULE_MEETING",
    lastMessageRead: "OK" as const,
    lastMessage: { from: "YOU" as const, at: "2026-10-04T10:00:00.000Z" },
  },
  {
    relationshipId: INV_REL_2,
    counterpart: { kind: "COMPANY" as const, id: CO_2, name: "Mizan" },
    state: "INTEREST_EXPRESSED",
    stateSince: "2026-10-28T09:00:00.000Z",
    nextStep: "AWAIT_ANSWER",
    lastMessageRead: "OK" as const,
    lastMessage: null,
  },
];

const fitOf = (over: Partial<PipelineFit> = {}): PipelineFit => ({
  score: "9",
  band: "Good fit",
  cheque: { outcome: "Strong match", reason: "Your cheque fits the round." },
  stage: { outcome: "Strong match", reason: "Seed is in your range." },
  reasons: ["Stage", "Sector"],
  round: { amount: "1500000", currency: "USD" },
  ...over,
});

describe("XLSX-002 · the pipeline joins fit when it is asked for", () => {
  it("joins fit on the company id: score a number, round and cheque as money with currency, unknown blank", () => {
    const built = buildPipelineSheet(
      {
        side: "INVESTOR",
        relationships: pipeline,
        decisions: [],
        today: TODAY,
        fit: {
          kind: "JOINED",
          byCompany: new Map([
            [CO_1, fitOf()],
            // Mizan's round is not shared: cheque fit UNKNOWN, blank.
            [
              CO_2,
              fitOf({
                cheque: { outcome: null, reason: "Round not shared." },
                round: null,
              }),
            ],
          ]),
          cheque: {
            from: { amount: "250000", currency: "USD" },
            to: { amount: "1000000", currency: "USD" },
          },
        },
      },
      // The model kept four columns; the fit asked for stays.
      { columns: ["counterparty", "stage", "lastMessageOn", "nextStep"] },
    );
    const sheet = built?.workbook.sheets[0];
    const keys = sheet?.columns.map((c) => c.key) ?? [];
    expect(keys).toEqual([
      "counterparty",
      "stage",
      "nextStep",
      "lastMessageOn",
      "fitScore",
      "fitBand",
      "chequeFit",
      "chequeFitWhy",
      "stageFit",
      "round",
      "chequeFrom",
      "chequeTo",
      "fitReasons",
    ]);
    const at = (key: string) => keys.indexOf(key);
    expect(sheet?.columns[at("fitScore")]?.type).toBe("number");
    expect(sheet?.rows[0]?.[at("fitScore")]).toBe("9");
    expect(sheet?.rows[0]?.[at("chequeFit")]).toBe("Strong match");
    expect(sheet?.rows[0]?.[at("round")]).toEqual({
      amount: "1500000",
      currency: "USD",
    });
    expect(sheet?.columns[at("chequeFrom")]).toMatchObject({
      type: "money",
      currency: "USD",
    });
    expect(sheet?.rows[1]?.[at("chequeFit")]).toBeNull();
    expect(sheet?.rows[1]?.[at("round")]).toBeNull();
    expect(QWorkbookSchema.safeParse(built?.workbook).success).toBe(true);
    // Fit is sourced as Q's inference, never as verified history.
    expect(
      built?.workbook.sources.find((s) => s.truthClass === "Q_INFERENCE")
        ?.columns,
    ).toContain("Cheque fit");
    expect(
      built?.workbook.sources.find((s) => s.truthClass === "VERIFIED")?.columns,
    ).not.toContain("Cheque fit");
    // The receipt names the blanks it left.
    expect(built).not.toBeNull();
    if (built === null) return;
    const said = spreadsheetReceipt(built);
    expect(said).toMatch(/Pipeline \(2 rows; columns Counterparty, Stage/);
    expect(said).toMatch(/Cheque fit: not known for 1 of 2 rows/);
  });

  it("says why a company in the pipeline has no fit, never leaving blank cells to read as a verdict (LedgerBridge)", () => {
    const built = buildPipelineSheet(
      {
        side: "INVESTOR",
        relationships: pipeline,
        decisions: [],
        today: TODAY,
        fit: {
          kind: "JOINED",
          byCompany: new Map([[CO_1, fitOf()]]),
          cheque: null,
        },
      },
      {},
    );
    expect(built?.gaps.join(" ")).toContain(
      "Mizan has no fit score yet: Capital Q scores fit for companies eligible for Discover",
    );
  });

  it("says fit is not available, and why, when it cannot be joined; never a column of zeros", () => {
    const built = buildPipelineSheet(
      {
        side: "INVESTOR",
        relationships: pipeline,
        decisions: [],
        today: TODAY,
        fit: {
          kind: "NOT_AVAILABLE",
          detail: "there is no active mandate to measure fit against yet",
        },
      },
      {},
    );
    expect(built).not.toBeNull();
    if (built === null) return;
    expect(built.workbook.sheets[0]?.columns.map((c) => c.key)).not.toContain(
      "chequeFit",
    );
    expect(built.unfilled).toContainEqual({
      column: "Cheque fit",
      why: "NOT_AVAILABLE",
      detail: "there is no active mandate to measure fit against yet",
    });
    expect(spreadsheetReceipt(built)).toMatch(
      /Cheque fit: not available \(there is no active mandate/,
    );
  });

  it("keeps 'Company or investor' only when the pipeline holds both", () => {
    const built = buildPipelineSheet(
      {
        side: "INVESTOR",
        relationships: [
          ...pipeline,
          {
            relationshipId: INV_REL_3,
            counterpart: {
              kind: "INVESTOR_ORGANISATION" as const,
              id: CO_3,
              name: "Halyard Ventures",
            },
            state: "CONNECTED",
            stateSince: "2026-10-03T09:00:00.000Z",
            nextStep: "NONE",
            lastMessageRead: "OK" as const,
            lastMessage: null,
          },
        ],
        decisions: [],
        today: TODAY,
      },
      {},
    );
    const sheet = built?.workbook.sheets[0];
    expect(sheet?.columns[1]?.label).toBe("Company or investor");
    expect(sheet?.rows.map((row) => row[1])).toEqual([
      "Company",
      "Company",
      "Investor",
    ]);
  });
});

function investorSetUp(
  options: { readonly fitKind?: "OK" | "NO_MANDATE" } = {},
) {
  const filed: { title: string; content: QArtifactContent }[] = [];
  const asked: string[][] = [];
  const port: SpreadsheetPort = {
    shownAnswers: () => Promise.resolve([]),
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
  const parameter = (
    name: string,
    outcome: "STRONG" | "UNKNOWN",
    reason: string,
  ) => ({
    parameter: name,
    outcome,
    reason,
    evidenceStatus: null,
    stale: false,
    applicable: true,
  });
  const profile = (companyId: string) => ({
    companyId,
    configVersion: "ranking-config.v4",
    configLabel: "4",
    band: "GOOD_FIT",
    confidence: "MEDIUM",
    parameters: [
      parameter("STAGE", "STRONG", "Seed is in your range."),
      parameter("SECTOR", "STRONG", "Health is in your sectors."),
      parameter("GEOGRAPHY", "STRONG", "Nigeria is in your geographies."),
      parameter(
        "CHEQUE_SIZE",
        companyId === CO_1 ? "STRONG" : "UNKNOWN",
        companyId === CO_1
          ? "Your cheque fits the round."
          : "Round not shared.",
      ),
      parameter("BUSINESS_MODEL", "UNKNOWN", "Not stated."),
      parameter("TRACTION", "UNKNOWN", "Not stated."),
      parameter("TEAM", "UNKNOWN", "Not stated."),
      parameter("THESIS", "UNKNOWN", "Not stated."),
      parameter("ROUND_TERMS", "UNKNOWN", "Not stated."),
    ],
    topReasons: [parameter("STAGE", "STRONG", "Seed is in your range.")],
    mainMismatch: null,
    hardRule: null,
    computedAt: "2026-10-28T09:00:00.000Z",
  });
  const fit = {
    profiles: (_actor: unknown, ids: readonly string[]) => {
      asked.push([...ids]);
      return Promise.resolve(
        options.fitKind === "NO_MANDATE"
          ? { kind: "NO_MANDATE" }
          : {
              kind: "OK",
              items: ids.map((id) => ({
                assessment: { profile: profile(id) },
                name: id === CO_1 ? "MedTrail" : "Mizan",
                line: null,
                raise:
                  id === CO_1 ? { amount: "1500000", currency: "USD" } : null,
              })),
            },
      );
    },
    top: () => Promise.reject(new Error("not used")),
    compare: () => Promise.reject(new Error("not used")),
  } as unknown as QToolPorts["fit"];
  const ports: QToolPorts = fakePorts({
    fit,
    relationships: {
      ...fakePorts().relationships,
      ownRelationships: () =>
        Promise.resolve({
          side: "INVESTOR",
          items: pipeline.map((item) => ({
            ...item,
            counterpart: { ...item.counterpart },
            milestones: [],
            nextStep: item.nextStep as "NONE",
            state: item.state as "CONNECTED",
          })),
        }),
    } as QToolPorts["relationships"],
  });
  const executor = createQToolExecutor({
    registry: createQToolRegistry([createMakeSpreadsheetTool(ports, port)]),
  });
  const base = planFor(actorA, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);
  const plan: PermittedContextPlan = {
    ...base,
    scopes: base.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actorA.userId } }
        : scope,
    ),
  };
  const run = (
    args: Record<string, unknown>,
    focus?: { areas: string[]; tools: string[] },
  ) =>
    executor.execute(
      { callId: "c-1", name: "make_spreadsheet", arguments: args },
      {
        ...contextFor(actorA, plan),
        ...(focus === undefined ? {} : { focus }),
      },
    );
  return { run, filed, asked };
}

describe("XLSX-002 · make_spreadsheet with fit, and its receipt", () => {
  it("joins cheque fit when the reader asks for fit, and says what it made", async () => {
    const { run, filed, asked } = investorSetUp();
    const outcome = await run({ source: "PIPELINE", withFit: true });
    expect(outcome.result.ok).toBe(true);
    expect(asked).toEqual([[CO_1, CO_2]]);
    const sheet = filed[0]?.content.workbook?.sheets[0];
    const at = sheet?.columns.findIndex((c) => c.key === "chequeFit") ?? -1;
    expect(at).toBeGreaterThan(0);
    expect(sheet?.rows.map((row) => row[at])).toEqual(["Strong match", null]);
    const round = sheet?.columns.findIndex((c) => c.key === "round") ?? -1;
    expect(sheet?.rows[0]?.[round]).toEqual({
      amount: "1500000",
      currency: "USD",
    });
    // The card still rides on the answer, with code's own line.
    const card = QDocumentToolResultSchema.parse(
      (outcome.result as { data: unknown }).data,
    );
    expect(card.says).toMatch(/I've made “Pipeline” as an Excel spreadsheet/);
    expect(card.says).toMatch(/Cheque fit/);
  });

  it("joins fit when this turn already read fit, without being told", async () => {
    const { run, filed } = investorSetUp();
    await run({ source: "PIPELINE" }, { areas: [], tools: ["fit_profile"] });
    expect(
      filed[0]?.content.workbook?.sheets[0]?.columns.map((c) => c.key),
    ).toContain("chequeFit");
  });

  it("leaves fit out when nobody asked, and says it when it cannot be read", async () => {
    const plain = investorSetUp();
    await plain.run({ source: "PIPELINE" });
    expect(plain.asked).toEqual([]);
    expect(
      plain.filed[0]?.content.workbook?.sheets[0]?.columns.map((c) => c.key),
    ).not.toContain("chequeFit");

    const none = investorSetUp({ fitKind: "NO_MANDATE" });
    const outcome = await none.run({ source: "PIPELINE", withFit: true });
    const card = QDocumentToolResultSchema.parse(
      (outcome.result as { data: unknown }).data,
    );
    expect(card.says).toMatch(
      /Cheque fit: not available \(there is no active mandate/,
    );
    expect(none.filed[0]?.content.gaps.join(" ")).toMatch(/not in this sheet/);
  });
});
