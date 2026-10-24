import { describe, expect, it, vi } from "vitest";

import type { CompanyQualificationProjectionPort } from "@capital-q/gateq";
import type { PublicIdentityService } from "@capital-q/public-identity";
import type { ActorContext } from "@capital-q/security";
import { REFERENCE_TAXONOMY } from "@capital-q/taxonomy";

import {
  createInvestorSectorFocusPort,
  resolveSectors,
} from "../src/composition/investor-sector-focus.js";

/**
 * Owner 2026-10-23: an investor's sectors are read only from their Q Card
 * as a participant sees it, and only beside the founder's own company.
 */

const COMPANY = "0a000000-0000-4000-8000-000000000001";
const OTHER = "0b000000-0000-4000-8000-000000000002";
const INVESTOR = "1a000000-0000-4000-8000-000000000001";
const actor = { tenantId: "t", userId: "u" } as unknown as ActorContext;

const nodeId = (code: string) => {
  const node = REFERENCE_TAXONOMY.nodes.find(
    (one) => one.vocabularyCode === "industry" && one.canonicalCode === code,
  );
  if (node === undefined) throw new Error(code);
  return node.id;
};

function portWith(own: string | null) {
  const projectionFor = vi.fn(() =>
    Promise.resolve({
      classifications: [
        { vocabularyCode: "industry", nodeId: nodeId("clean_energy") },
        { vocabularyCode: "industry", nodeId: nodeId("energy_access") },
        { vocabularyCode: "geography", nodeId: "not-an-industry" },
      ],
    }),
  );
  const cardForSubject = vi.fn(() =>
    Promise.resolve({
      fields: [{ key: "mandateSectors", value: "Fintech; Renewables; Water" }],
    }),
  );
  const port = createInvestorSectorFocusPort({
    ownCompany: () => Promise.resolve(own),
    projection: {
      projectionFor,
    } as unknown as CompanyQualificationProjectionPort,
    cards: { cardForSubject } as unknown as Pick<
      PublicIdentityService,
      "cardForSubject"
    >,
  });
  return { port, projectionFor, cardForSubject };
}

describe("investor sector focus", () => {
  it("resolves names and aliases onto the taxonomy, and keeps an unknown name unknown", () => {
    expect(resolveSectors(["Renewables", " fintech ", "Water", ""])).toEqual([
      { code: "clean_energy", name: "Clean Energy", parent: "energy" },
      {
        code: "fintech",
        name: "Fintech",
        parent: "financial_services",
      },
      { code: null, name: "Water", parent: null },
    ]);
  });

  it("reads the company's own industries and the card as a participant sees it", async () => {
    const { port, cardForSubject } = portWith(COMPANY);
    const found = await port.forOwnCompany(actor, COMPANY, [INVESTOR]);
    expect(found.company.map((one) => one.code)).toEqual([
      "clean_energy",
      "energy_access",
    ]);
    expect(found.investors).toEqual([
      {
        investorOrganisationId: INVESTOR,
        sectors: resolveSectors(["Fintech", "Renewables", "Water"]),
        // QA F-77: how well, by what the card publishes (QO-42's rule);
        // this card publishes no stage or geography, and none of its
        // sectors is the company's: unknown stays unknown, never a no.
        publishedFit: expect.objectContaining({
          stage: "UNKNOWN",
          geography: "UNKNOWN",
        }) as unknown,
      },
    ]);
    expect(cardForSubject).toHaveBeenCalledWith({
      subject: { subjectType: "INVESTOR_ORGANISATION", subjectId: INVESTOR },
      audience: "PARTICIPANT",
    });
  });

  it("reads nothing for a company that is not the actor's own", async () => {
    const { port, projectionFor, cardForSubject } = portWith(COMPANY);
    expect(await port.forOwnCompany(actor, OTHER, [INVESTOR])).toEqual({
      company: [],
      investors: [],
    });
    expect(projectionFor).not.toHaveBeenCalled();
    expect(cardForSubject).not.toHaveBeenCalled();
  });
});
