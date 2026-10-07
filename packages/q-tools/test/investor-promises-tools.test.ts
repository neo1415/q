import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  type CompanyDeckView,
  type DeckSection,
} from "@capital-q/contracts";
import type { FitService } from "@capital-q/discovery";
import type { ActorContext } from "@capital-q/security";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type ProfileMaterialPort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  INVESTOR_B,
  MANDATE_B,
  planFor,
} from "./support.js";

/**
 * Investor promises (Q.07, Q.10, Q.02): each tool reads only what the
 * person's own screen would, and the Context Firewall decides first.
 */

const call = (name: string, args: Record<string, unknown>) => ({
  callId: "c1",
  name,
  arguments: args,
});

const PRIVATE_FIGURE = "₦999m founder-private burn";

const sections = (confirmedFigure: string): DeckSection[] =>
  DECK_SECTIONS.map((code) => ({
    section: code,
    status: code === "TRACTION" ? "PRESENT" : "NOT_IN_DECK",
    summary: null,
    pages: [],
    facts:
      code === "TRACTION"
        ? [
            {
              label: "Annual recurring revenue",
              value: confirmedFigure,
              unknownReason: null,
              kind: "FIGURE",
              asOf: null,
              pages: [9],
              truthClass: "USER_CLAIM",
              evidenceStatus: "DOCUMENT_SUPPORTED",
              confidence: "HIGH",
            },
          ]
        : [],
    confidence: "MEDIUM",
  }));

function deckView(
  viewer: CompanyDeckView["viewer"],
  confirmed: boolean,
  figure = "₦38m",
): CompanyDeckView {
  return {
    viewer,
    companyId: COMPANY_A,
    deck: {
      documentId: "a0000000-0000-4000-8000-000000000009",
      title: "Deck",
      versionNumber: 1,
      pageCount: 12,
      uploadedAt: "2026-10-01T10:00:00.000Z",
      downloadable: false,
      scanned: true,
    },
    extraction: {
      extractionId: "a0000000-0000-4000-8000-00000000000a",
      readAt: "2026-10-02T10:00:00.000Z",
      versionNumber: 1,
      confirmed,
      sections: sections(figure),
    },
    coaching: null,
  };
}

function material(view: CompanyDeckView | null) {
  const asked: ActorContext[] = [];
  const port: ProfileMaterialPort = {
    dataRoom: () => Promise.resolve(null),
    deck: (actor) => {
      asked.push(actor);
      return Promise.resolve(view);
    },
    ownCompanyId: () => Promise.resolve(null),
  };
  return { port, asked };
}

const executor = (ports: ReturnType<typeof fakePorts>) =>
  createQToolExecutor({ registry: createQToolRegistry(createDefaultQTools(ports)) });

const investorPlan = planFor(actorB, "COUNTERPARTY_COMPANY_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  { kind: "COMPANY_PROFILE", sensitivity: "CONFIDENTIAL", companyId: COMPANY_A },
]);

describe("company_assumptions (Q.07)", () => {
  it("an investor gets the board from the confirmed reading, read as them", async () => {
    const { port, asked } = material(deckView("INVESTOR", true));
    const out = await executor(fakePorts({ profileMaterial: port })).execute(
      call("company_assumptions", { companyId: COMPANY_A }),
      contextFor(actorB, investorPlan),
    );
    if (!out.result.ok) throw new Error("expected a result");
    const data = out.result.data as {
      board: { counts: { evidenced: number } };
      text: string;
    };
    expect(data.board.counts.evidenced).toBe(1);
    expect(data.text).toContain("₦38m");
    expect(asked).toEqual([actorB]);
  });

  it("founder-private: an unconfirmed reading never reaches an investor, even if one arrived", async () => {
    const { port } = material(deckView("INVESTOR", false, PRIVATE_FIGURE));
    const out = await executor(fakePorts({ profileMaterial: port })).execute(
      call("company_assumptions", { companyId: COMPANY_A }),
      contextFor(actorB, investorPlan),
    );
    if (!out.result.ok) throw new Error("expected a result");
    expect(JSON.stringify(out.result.data)).not.toContain(PRIVATE_FIGURE);
  });

  it("the company's own team (owner view, with coaching) is not given an investor board", async () => {
    const { port } = material(deckView("OWNER", false, PRIVATE_FIGURE));
    const out = await executor(fakePorts({ profileMaterial: port })).execute(
      call("company_assumptions", { companyId: COMPANY_A }),
      contextFor(actorA, planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
        { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
      ])),
    );
    expect(out.result.ok).toBe(false);
    expect(JSON.stringify(out)).not.toContain(PRIVATE_FIGURE);
  });

  it("a company the plan does not admit is refused before the deck is read", async () => {
    const { port, asked } = material(deckView("INVESTOR", true));
    const plan = planFor(actorB, "INVESTOR_QUESTION", [
      {
        kind: "INVESTOR_MANDATE",
        sensitivity: "CONFIDENTIAL",
        investorOrganisationId: INVESTOR_B,
      },
    ]);
    const out = await executor(fakePorts({ profileMaterial: port })).execute(
      call("company_assumptions", { companyId: COMPANY_A }),
      contextFor(actorB, plan),
    );
    expect(out.result.ok).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe("fit_compare (Q.10)", () => {
  const compared: string[][] = [];
  const fit = {
    profiles: () => Promise.resolve({ kind: "NOT_INVESTOR" }),
    top: () => Promise.resolve({ kind: "NOT_INVESTOR" }),
    compare: (actor: ActorContext, ids: readonly string[]) => {
      compared.push([...ids]);
      return Promise.resolve(
        actor.userId === actorB.userId
          ? {
              kind: "OK",
              comparison: {
                configVersion: "ranking-config.v4",
                configLabel: "v4",
                parameters: [
                  "STAGE",
                  "SECTOR",
                  "GEOGRAPHY",
                  "CHEQUE_SIZE",
                  "BUSINESS_MODEL",
                  "TRACTION",
                  "TEAM",
                  "THESIS",
                  "ROUND_TERMS",
                ],
                entries: [],
                considered: 0,
                leftOut: { outsideMandate: 0, notEnoughInformation: 0 },
                computedAt: "2026-10-07T12:00:00.000Z",
              },
            }
          : { kind: "NOT_INVESTOR" },
      );
    },
  } as unknown as FitService;
  const plan = (actor: ActorContext) =>
    planFor(actor, "COMPARISON", [
      { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
    ]);

  it("a founder (no investor side) gets nothing to compare", async () => {
    const out = await executor(fakePorts({ fit })).execute(
      call("fit_compare", { companyIds: [COMPANY_A, COMPANY_B_NETWORK] }),
      contextFor(actorA, plan(actorA)),
    );
    if (!out.result.ok) throw new Error("expected a result");
    expect((out.result.data as { status: string }).status).toBe("NOT_INVESTOR");
  });

  it("with fewer than two saved companies, says so and compares nothing", async () => {
    compared.length = 0;
    const out = await executor(
      fakePorts({
        fit,
        investorFeed: {
          page: () => Promise.resolve(null),
          decisions: () =>
            Promise.resolve([
              {
                companyId: COMPANY_A,
                name: "Sunline",
                stageCode: "seed",
                headquartersCountry: "NG",
                decision: "SAVED" as const,
              },
            ]),
        },
      }),
    ).execute(call("fit_compare", {}), contextFor(actorB, plan(actorB)));
    if (!out.result.ok) throw new Error("expected a result");
    expect((out.result.data as { status: string }).status).toBe("TOO_FEW");
    expect(compared).toEqual([]);
  });
});

describe("thesis_reading (Q.02)", () => {
  const investors = {
    listInvestorMandates: () =>
      Promise.resolve({
        items: [{ id: MANDATE_B, status: "ACTIVE", version: 2 }],
        nextCursor: null,
      }),
    getInvestorMandate: () => Promise.reject(new Error("not read in this test")),
  };
  const appActions = {
    ownInvestorOrganisationId: (actor: ActorContext) =>
      Promise.resolve(actor.userId === actorB.userId ? INVESTOR_B : null),
    investors,
  };
  const mandatePlan = (actor: ActorContext, organisation: string) =>
    planFor(actor, "INVESTOR_QUESTION", [
      {
        kind: "INVESTOR_MANDATE",
        sensitivity: "CONFIDENTIAL",
        investorOrganisationId: organisation,
      },
    ]);

  it("the investor's own reading, declared and observed kept apart", async () => {
    const out = await executor(
      fakePorts({ appActions: appActions as never }),
    ).execute(
      call("thesis_reading", {}),
      contextFor(actorB, mandatePlan(actorB, INVESTOR_B)),
    );
    if (!out.result.ok) throw new Error("expected a result");
    const data = out.result.data as {
      reading: { observed: { saved: number }; suggestions: unknown[] } | null;
    };
    expect(data.reading?.observed.saved).toBe(0);
    expect(data.reading?.suggestions).toEqual([]);
  });

  it("someone without an investor organisation (a founder) is refused", async () => {
    const out = await executor(
      fakePorts({ appActions: appActions as never }),
    ).execute(
      call("thesis_reading", {}),
      contextFor(actorA, mandatePlan(actorA, INVESTOR_B)),
    );
    expect(out.result.ok).toBe(false);
  });

  it("a plan bound to another organisation's mandate is refused (cross-tenant)", async () => {
    const out = await executor(
      fakePorts({ appActions: appActions as never }),
    ).execute(
      call("thesis_reading", {}),
      contextFor(
        actorB,
        mandatePlan(actorB, "d0000000-0000-4000-8000-0000000000ff"),
      ),
    );
    expect(out.result.ok).toBe(false);
  });
});
