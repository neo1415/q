import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { QArtifactContent } from "@capital-q/contracts";
import type {
  AnalysisCritiqueResult,
  AnalysisDocumentResult,
} from "@capital-q/q-core";
import {
  boundPlan,
  registeredExecutors,
  runJob,
  type JobRecorder,
} from "@capital-q/q-orchestrator";
import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
} from "@capital-q/q-research";
import type { MaterialDocument } from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import { CLAIMS_HEADING } from "../src/composition/workforce/claims.js";
import { workforceDeepResearch } from "../src/composition/workforce/deep-research.js";
import {
  BUDGET_LIMITED_GAP,
  DILIGENCE_SECTIONS,
} from "../src/composition/workforce/diligence-memo.js";
import { createWorkforceDocuments } from "../src/composition/workforce/documents.js";
import {
  createWorkforceExecutors,
  type WorkforcePorts,
} from "../src/composition/workforce/jobs.js";
import type { WorkforceModels } from "../src/composition/workforce/models.js";

/**
 * Diligence audit 2026-10-28, end to end with fake models and a fake web:
 * "Do due diligence on Ledgerfold, give me a memo". The planner slips into
 * the old shape (a NAMED_COMPANY memo, no research); code adds the
 * research, the research is about Ledgerfold and stays inside the job's
 * search budget, the memo has the fixed diligence sections, the company's
 * claimed revenue is CONTRADICTED by a public figure with both sources,
 * the data-room document the investor may open is used and the
 * founder-private one is not.
 */

const REQUEST = "Do due diligence on Ledgerfold, give me a memo";
const PRIVATE_MARKER = "CQ_FOUNDER_PRIVATE_CAP_TABLE_7731";
const companyId = randomUUID();
const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const owner = { tenantId: actor.tenantId, userId: actor.userId };

const PAGES = [
  {
    url: "https://techpress.example/ledgerfold-revenue",
    title: "Ledgerfold's 2025 numbers",
    text: "Ledgerfold reported revenue of $0.8 million in 2025, according to its filings with the registrar.",
  },
  {
    url: "https://people.example/ledgerfold-founders",
    title: "Who founded Ledgerfold",
    text: "Ledgerfold was founded in 2021 by Ada Mensah and Kofi Asante, both formerly at a Nairobi bank.",
  },
];

function web(searched: string[]): PublicWebResearchProvider {
  return {
    code: "brave",
    search: (request) => {
      searched.push(request.query);
      const hits = request.query.toLowerCase().includes("ledgerfold")
        ? PAGES.map((page) => ({
            url: page.url,
            title: page.title,
            snippet: page.text.slice(0, 80),
            publishedAt: "2026-02-01",
            relevance: 0.9,
          }))
        : [];
      return Promise.resolve({ hits, latencyMs: 1 });
    },
    extract: (request) =>
      Promise.resolve({
        pages: request.urls.flatMap((url) => {
          const page = PAGES.find((one) => one.url === url);
          return page === undefined
            ? []
            : [{ url, title: page.title, text: page.text }];
        }),
        failedUrls: [],
        latencyMs: 1,
      }),
  };
}

/** Words the first round's pages carry, so a follow-up may name them. */
const FOLLOW_UP_TERMS = [
  "Ada Mensah",
  "Kofi Asante",
  "Nairobi bank",
  "registrar filings",
  "founded 2021",
  "formerly",
];

const LANES = [
  "FOUNDERS_TEAM",
  "CUSTOMERS",
  "LITIGATION_REGULATORY",
  "FUNDING",
  "TRACTION",
  "NEWS",
  "COMPETITORS",
  "MARKET_SIZE",
  "PARTNERS",
  "PRICING",
];

/** The writer: sections out of order, one extra, Competition missing. */
const DRAFT: AnalysisDocumentResult = {
  title: "Ledgerfold: diligence memo",
  summary:
    "Proceed with conditions: the team is credible but the revenue Ledgerfold states is not what public filings show (company record, self-reported; [S1]).",
  sections: [
    {
      heading: "Team",
      body: "Founded by Ada Mensah and Kofi Asante [S2].",
    },
    {
      heading: "Summary & recommendation",
      body: "Proceed with conditions until revenue is reconciled.",
    },
    {
      heading: "Traction & unit economics (stated vs evidenced)",
      body: "Ledgerfold states $1.2 million ARR (company record, self-reported); filings show $0.8 million [S1].",
    },
    { heading: "Market", body: "Not known from the evidence." },
    {
      heading: "Product & business model",
      body: "Bookkeeping software for small merchants (company record).",
    },
    {
      heading: "Growth plan",
      body: "An extra section the fixed shape does not have.",
    },
    {
      heading: "Risks & red flags",
      body: "Stated and filed revenue disagree; both are shown.",
    },
    {
      heading: "Open questions",
      body: "Which revenue figure is right, and over what period?",
    },
  ],
  topRecommendations: [
    "Reconcile the revenue figures before a term sheet.",
    "Ask for the FY25 accounts.",
    "Reference-call two customers.",
  ],
  gaps: ["Customer concentration is not known."],
};

const PASSING: AnalysisCritiqueResult = {
  passes: true,
  score: 84,
  issues: [],
  strengths: [],
};

function world() {
  const searched: string[] = [];
  const planInputs: { subject: string; request: string }[] = [];
  const writes: { company: string; purpose: string; research: string }[] = [];
  const read: string[] = [];
  const filed: { title: string; content: QArtifactContent }[] = [];

  const models: Pick<
    WorkforceModels,
    "planResearch" | "researchFacts" | "writeAnalysis" | "critiqueAnalysis"
  > = {
    planResearch: (_who, _trace, input) => {
      planInputs.push({ subject: input.subject, request: input.request });
      return Promise.resolve({
        costUsd: 0.01,
        output: {
          questions: LANES.map((lane) => ({
            lane,
            query: `Ledgerfold ${lane.toLowerCase().replace(/_/gu, " ")}`,
            alsoQuery: `Ledgerfold ${lane.toLowerCase()} 2025`,
            recent: false,
          })),
        },
      });
    },
    researchFacts: (_who, _trace, input) => {
      const index = (url: string) =>
        Number(
          new RegExp(
            `S(\\d+) \\| ${PAGES.find((page) => page.url === url)?.title ?? ""}`,
            "u",
          ).exec(input.pages)?.[1] ?? 0,
        );
      const revenue = index(PAGES[0]?.url ?? "");
      const founders = index(PAGES[1]?.url ?? "");
      return Promise.resolve({
        costUsd: 0.01,
        output: {
          facts: [
            ...(revenue > 0
              ? [
                  {
                    statement:
                      "Ledgerfold reported revenue of $0.8 million in 2025.",
                    figure: "$0.8 million",
                    asOf: "2025",
                    source: revenue,
                    kind: "FIGURE" as const,
                  },
                ]
              : []),
            ...(founders > 0
              ? [
                  {
                    statement:
                      "Ledgerfold was founded in 2021 by Ada Mensah and Kofi Asante.",
                    figure: null,
                    asOf: "2021",
                    source: founders,
                    kind: "FACT" as const,
                  },
                ]
              : []),
          ],
          followUps: [
            {
              lane: `MORE_${input.lane}`,
              // Names only public pages named: distinct, so each is a new search.
              query: `Ledgerfold ${FOLLOW_UP_TERMS[LANES.indexOf(input.lane)] ?? "registrar"}`,
            },
          ],
        },
      });
    },
    writeAnalysis: (_who, _trace, input) => {
      writes.push({
        company: input.company,
        purpose: input.purpose,
        research: input.research,
      });
      return Promise.resolve({ costUsd: 0.2, output: DRAFT });
    },
    critiqueAnalysis: () => Promise.resolve({ costUsd: 0.03, output: PASSING }),
  };

  const research = workforceDeepResearch({
    service: createPublicWebResearchService({ provider: web(searched) }),
    models,
    namedSubject: (_who, id) =>
      Promise.resolve(
        id === companyId
          ? {
              name: "Ledgerfold",
              country: "KE",
              sectors: [],
              description: null,
            }
          : null,
      ),
    jobSearchBudget: 8,
  });
  if (research === undefined) throw new Error("research not composed");

  const DOCUMENTS: readonly MaterialDocument[] = [
    {
      documentId: "doc-open",
      title: "Q3 2025 investor update",
      folder: "Financials",
      documentType: "INVESTOR_UPDATE",
      access: "OPEN",
      pageCount: 2,
      updatedAt: "2026-09-30T00:00:00.000Z",
      opening: null,
    },
    {
      documentId: "doc-private",
      title: "Founder-only cap table",
      folder: "Legal",
      documentType: "CAP_TABLE",
      access: "REQUESTABLE",
      pageCount: 1,
      updatedAt: "2026-09-30T00:00:00.000Z",
      opening: null,
    },
  ];
  const TEXTS: Readonly<Record<string, string>> = {
    "doc-open":
      "Ledgerfold served 140 paying customers at the end of Q3 2025. Monthly churn stayed under 2%.",
    // A port that wrongly handed this back must still not reach the memo.
    "doc-private": `${PRIVATE_MARKER}: the founders hold 80% after the seed round.`,
  };

  const documents = createWorkforceDocuments({
    freshActor: (who) => Promise.resolve(who),
    ownCompany: () => Promise.resolve(null),
    firewall: {
      plan: () =>
        Promise.resolve({
          outcome: "AUTHORISED",
          plan: { maxSensitivity: "CONFIDENTIAL" },
        } as never),
    },
    investigate: () =>
      Promise.resolve({
        companyId,
        companyName: "Ledgerfold",
        canonicalDescription: "Bookkeeping software for small merchants.",
        blocked: null,
        findings: [
          {
            statement:
              "Ledgerfold's annual recurring revenue was $1.2 million in 2025.",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
          },
        ],
        contradictions: [],
      } as never),
    artifacts: {
      findWorkforceDocument: () => Promise.resolve(null),
      requestDocument: vi.fn(),
    },
    preparation: {
      port: {
        prepare: (input: {
          content: { title: string; content: QArtifactContent };
        }) => {
          filed.push({
            title: input.content.title,
            content: input.content.content,
          });
          return Promise.resolve({ artifactId: randomUUID() });
        },
      },
    } as never,
    analyst: models,
    dataRoom: {
      documents: () => Promise.resolve(DOCUMENTS),
      documentText: (_who, _company, documentId) => {
        read.push(documentId);
        const text = TEXTS[documentId];
        return Promise.resolve(
          text === undefined ? null : { text, truncated: false },
        );
      },
    },
    now: () => Date.parse("2026-10-28T09:00:00.000Z"),
  });

  const unused = vi.fn(() =>
    Promise.reject(new Error("No outward action allowed")),
  );
  const ports: WorkforcePorts = {
    principalName: () => Promise.resolve("Zino"),
    mandateMatches: unused,
    expressInterest: unused,
    openConversations: unused,
    writeReply: unused,
    send: unused,
    freeSlots: unused,
    book: unused,
    notify: unused,
    research: (_owner, input) => research({ ...input, actor }),
    documents: (_owner, input) => documents({ ...input, actor }),
  };
  return { ports, searched, planInputs, writes, read, filed };
}

function recorder(): JobRecorder {
  return {
    startRun: () => Promise.resolve(randomUUID()),
    endRun: () => Promise.resolve(),
    handoff: () => Promise.resolve(),
  };
}

describe('"do due diligence on Ledgerfold, give me a memo", end to end', () => {
  it("researches first, within budget, and files a diligence memo that sets claims against evidence", async () => {
    const w = world();
    // The planner's old slip: a named-company memo with no research.
    const bound = boundPlan(
      [
        {
          key: "memo",
          role: "DOCUMENTS",
          agentName: null,
          goal: "Investment memo on Ledgerfold",
          tools: ["documents.own.prepare"],
          dependsOn: [],
          document: {
            operation: "PREPARE",
            kind: "MEMO",
            scope: "NAMED_COMPANY",
          },
        },
      ],
      {
        permitted: new Set(["public_web.search", "documents.own.prepare"]),
        budgetUsd: 2.4,
        executors: registeredExecutors({ research: true, documents: true }),
        namedCompanyId: companyId,
      },
    );
    expect(bound.refused).toEqual([]);
    // RESEARCH before the document, which waits on it.
    expect(bound.steps.map((step) => step.executor)).toEqual([
      "RESEARCH",
      "DOCUMENTS",
    ]);
    const [researchStep, memoStep] = bound.steps;
    expect(memoStep?.dependsOn).toEqual([researchStep?.key]);
    expect(memoStep?.document).toMatchObject({
      kind: "ANALYSIS",
      scope: "NAMED_COMPANY",
      companyId,
      profile: "DILIGENCE",
    });

    const executors = createWorkforceExecutors({
      owner,
      ports: w.ports,
      models: { readReply: vi.fn() },
      review: {
        prepare: vi.fn(),
        review: vi.fn(),
        abandon: vi.fn(),
        settle: vi.fn(),
      },
      scheduling: false,
      goal: REQUEST,
      steps: bound.steps,
      documentContext: {
        qRunId: randomUUID(),
        organisationId: actor.organisationId ?? "",
        canContinue: () => Promise.resolve(true),
      },
    });
    const run = await runJob({
      jobId: randomUUID(),
      goal: REQUEST,
      steps: bound.steps,
      executors,
      recorder: recorder(),
    });
    expect(run.steps.map((step) => step.status)).toEqual(["DONE", "DONE"]);

    // The research was about Ledgerfold, as a diligence subject.
    expect(w.planInputs[0]?.subject).toMatch(/^DUE DILIGENCE ON Ledgerfold/u);
    // The job's search budget held: never more than 8 searches, follow-ups
    // included, though the plan asked for 10 questions with two phrasings
    // each and every page suggested a follow-up.
    expect(w.searched.length).toBeGreaterThan(0);
    expect(w.searched.length).toBe(8);

    // The writer was told the fixed sections, and given the data room
    // passage the investor may open -- never the founder-private one.
    const write = w.writes[0];
    expect(write?.purpose).toMatch(/^DUE DILIGENCE on Ledgerfold/u);
    expect(write?.company).toContain("140 paying customers");
    expect(write?.company).toContain("(USER_CLAIM, DOCUMENT_SUPPORTED)");
    expect(write?.company).not.toContain(PRIVATE_MARKER);
    expect(w.read).toEqual(["doc-open"]);

    // The filed memo: the fixed sections, in order.
    const memo = w.filed[0];
    if (memo === undefined) throw new Error("nothing filed");
    expect(JSON.stringify(memo)).not.toContain(PRIVATE_MARKER);
    expect(memo.content.sections.map((section) => section.heading)).toEqual([
      ...DILIGENCE_SECTIONS,
    ]);
    const section = (heading: string) =>
      memo.content.sections.find((one) => one.heading === heading);
    expect(section("Competition")?.body).toMatch(/^Not known/u);
    expect(JSON.stringify(memo)).not.toContain("An extra section");

    // Claims vs evidence: the claimed revenue CONTRADICTED by the public
    // figure, both sides with their sources; the data-room figure
    // UNVERIFIED (nothing public to compare), never a mark against it.
    const claims = section(CLAIMS_HEADING);
    expect(claims?.body).toMatch(
      /CONTRADICTED \| Stated: Ledgerfold's annual recurring revenue was \$1\.2 million in 2025\. \(its record, USER_CLAIM\) \| Evidence: Ledgerfold reported revenue of \$0\.8 million in 2025\. \(techpress\.example \[S\d+\]\)/u,
    );
    expect(claims?.body).toMatch(
      /UNVERIFIED \| Stated: Ledgerfold served 140 paying customers at the end of Q3 2025\. \(data room: Q3 2025 investor update, USER_CLAIM\)/u,
    );
    const contradicted = claims?.findings.find((finding) =>
      finding.statement.startsWith("CONTRADICTED"),
    );
    expect(contradicted).toMatchObject({
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CONTRADICTORY",
      confidence: "CONFLICTING_EVIDENCE",
    });
    // The cited public source is listed in Sources.
    expect(section("Sources")?.body).toContain(
      "https://techpress.example/ledgerfold-revenue",
    );
    // What the budget left out is said, in the gaps and in Not known.
    expect(memo.content.gaps).toContain(BUDGET_LIMITED_GAP);
    expect(section("Not known")?.body).toContain(BUDGET_LIMITED_GAP);
    expect(section("Not known")?.body).toMatch(
      /1 data-room document is listed but not open to you/u,
    );
  });
});
