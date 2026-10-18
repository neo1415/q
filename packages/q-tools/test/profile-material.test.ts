import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  type CompanyDeckView,
  type DataRoomView,
} from "@capital-q/contracts";

import {
  createCoachMyDeckTool,
  createReadCompanyDataRoomTool,
  createReadCompanyDeckTool,
  type ProfileMaterialPort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  planFor,
} from "./support.js";

/**
 * Overnight A8: Q reads a company's deck and data room exactly as the
 * person's tabs show them, only for a company the plan admits, and the
 * coaching only for their own deck. The services decide what each reader
 * receives; these tools never widen it.
 */

const sections = DECK_SECTIONS.map((section) => ({
  section,
  status: "NOT_IN_DECK" as const,
  summary: null,
  pages: [],
  facts: [],
  confidence: "LOW" as const,
}));
const deckView = (viewer: "INVESTOR" | "OWNER"): CompanyDeckView => ({
  viewer,
  companyId: COMPANY_B_NETWORK,
  deck: {
    documentId: "00000000-0000-4000-8000-00000000d001",
    title: "Kora deck",
    versionNumber: 3,
    pageCount: 14,
    uploadedAt: "2026-09-28T10:00:00.000Z",
    downloadable: false,
    scanned: true,
  },
  extraction: {
    extractionId: "00000000-0000-4000-8000-00000000e001",
    readAt: "2026-09-28T11:00:00.000Z",
    versionNumber: 3,
    confirmed: true,
    sections,
  },
  coaching:
    viewer === "OWNER"
      ? {
          rubricVersion: 1,
          sections: [],
          checks: [],
          sectionsAtStandard: 0,
          atMinimumStandard: false,
        }
      : null,
});
const roomView: DataRoomView = {
  viewer: "INVESTOR",
  companyId: COMPANY_B_NETWORK,
  folders: [{ code: "cap_table", label: "Cap table and equity" }],
  documents: [
    {
      documentId: "00000000-0000-4000-8000-00000000d002",
      title: "Cap table summary",
      folderCode: "cap_table",
      shownAs: "ON_REQUEST",
      access: "REQUESTED",
      kind: "PDF",
      pageCount: 1,
      updatedAt: "2026-09-01T00:00:00.000Z",
      validUntil: null,
      openedAt: null,
      accessEndsAt: null,
    },
  ],
};

function port(): ProfileMaterialPort {
  return {
    deck: (actor, companyId) =>
      Promise.resolve(
        companyId === COMPANY_B_NETWORK
          ? deckView(actor.userId === actorB.userId ? "OWNER" : "INVESTOR")
          : null,
      ),
    dataRoom: (_actor, companyId) =>
      Promise.resolve(companyId === COMPANY_B_NETWORK ? roomView : null),
    ownCompanyId: (actor) =>
      Promise.resolve(
        actor.userId === actorB.userId ? COMPANY_B_NETWORK : null,
      ),
  };
}

describe("profile material tools", () => {
  it("reads a deck's sections for a company the plan admits, as the service returned them", async () => {
    const tool = createReadCompanyDeckTool(port());
    const plan = planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        companyId: COMPANY_B_NETWORK,
        sensitivity: "CONFIDENTIAL",
      },
    ]);
    const context = contextFor(actorA, plan);
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK },
      context,
    );
    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome !== "ALLOW") return;
    const out = (await tool.execute(
      { companyId: COMPANY_B_NETWORK },
      context,
      decision.grant,
    )) as {
      sections: unknown[];
      truthClass: string;
    };
    expect(out.sections).toHaveLength(12);
    expect(out.truthClass).toBe("USER_CLAIM");
    expect(JSON.stringify(out)).not.toContain("coaching");
  });

  it("denies a company the plan does not admit, before asking the service", async () => {
    let asked = false;
    const tool = createReadCompanyDeckTool({
      ...port(),
      deck: () => {
        asked = true;
        return Promise.resolve(deckView("INVESTOR"));
      },
    });
    const plan = planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        companyId: COMPANY_A,
        sensitivity: "CONFIDENTIAL",
      },
    ]);
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK },
      contextFor(actorA, plan),
    );
    expect(decision.outcome).toBe("DENY");
    expect(asked).toBe(false);
  });

  it("lists the data room in words, titles only, as the investor's tab does", async () => {
    const tool = createReadCompanyDataRoomTool(port());
    const plan = planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        companyId: COMPANY_B_NETWORK,
        sensitivity: "CONFIDENTIAL",
      },
    ]);
    const context = contextFor(actorA, plan);
    const decision = await tool.authorize(
      { companyId: COMPANY_B_NETWORK },
      context,
    );
    if (decision.outcome !== "ALLOW") throw new Error("allowed");
    expect(
      await tool.execute(
        { companyId: COMPANY_B_NETWORK },
        context,
        decision.grant,
      ),
    ).toEqual({
      viewer: "INVESTOR",
      documents: [
        {
          title: "Cap table summary",
          folder: "Cap table and equity",
          status: "you asked; waiting",
        },
      ],
      openRequests: 1,
    });
  });

  it("coaches only the person's own deck", async () => {
    const tool = createCoachMyDeckTool(port());
    const own = planFor(actorB, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        companyId: COMPANY_B_NETWORK,
        sensitivity: "CONFIDENTIAL",
      },
    ]);
    expect((await tool.authorize({}, contextFor(actorB, own))).outcome).toBe(
      "ALLOW",
    );
    const other = planFor(actorA, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        companyId: COMPANY_A,
        sensitivity: "CONFIDENTIAL",
      },
    ]);
    expect((await tool.authorize({}, contextFor(actorA, other))).outcome).toBe(
      "DENY",
    );
  });
});
