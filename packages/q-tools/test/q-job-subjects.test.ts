import { describe, expect, it } from "vitest";

import { goalSubjects, nameSpans, type QJobNamePorts } from "../src/index.js";
import { actorA } from "./support.js";

/**
 * W4b: the "already waiting" check matches records. A goal's names are
 * resolved by the person's own reach (their relationships, their feed),
 * exactly as open_page resolves a spoken name.
 */

const KESTREL = "d0000000-0000-4000-8000-0000000000aa";
const KESTREL_REL = "71000000-0000-4000-8000-0000000000aa";
const LEDGERLINE = "c0000000-0000-4000-8000-0000000000bb";

const ports = {
  relationships: {
    ownRelationships: () =>
      Promise.resolve({
        side: "COMPANY",
        items: [
          {
            relationshipId: KESTREL_REL,
            counterpart: {
              kind: "INVESTOR_ORGANISATION",
              id: KESTREL,
              name: "Kestrel Heat Capital",
            },
          },
        ],
      }),
  },
  investorFeed: {
    page: () =>
      Promise.resolve({
        items: [{ companyId: LEDGERLINE, name: "Ledgerline" }],
        notes: [],
      }),
    decisions: () => Promise.resolve([]),
  },
} as unknown as QJobNamePorts;

describe("what a job's goal names, as records (W4b)", () => {
  it("finds the name-like spans, without the request's own words", () => {
    expect(
      nameSpans("Introduce me to Kestrel Heat and book a call with Ledgerline"),
    ).toEqual(["Kestrel Heat", "Ledgerline"]);
    expect(nameSpans("follow up with everyone who wrote")).toEqual([]);
  });

  it("resolves names to the companies, investors and relationships the person can reach", async () => {
    const subjects = await goalSubjects(
      ports,
      actorA,
      "Introduce me to Kestrel Heat and send Ledgerline's deck",
    );
    expect(subjects).toEqual(
      expect.arrayContaining([
        { kind: "INVESTOR_ORGANISATION", investorOrganisationId: KESTREL },
        { kind: "RELATIONSHIP", relationshipId: KESTREL_REL },
        { kind: "COMPANY", companyId: LEDGERLINE },
      ]),
    );
  });

  it("resolves a name nobody they can see carries to nothing", async () => {
    expect(
      await goalSubjects(ports, actorA, "Book a call with Northwind Partners"),
    ).toEqual([]);
  });
});
