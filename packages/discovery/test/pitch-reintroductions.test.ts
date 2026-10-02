import { describe, expect, it } from "vitest";

import { createPitchReintroductions } from "../src/rerank/pitch-reintroductions.js";

/**
 * A passed company is offered again only on evidence of something new: a
 * pitch that became playable AFTER the pass (doc 19 §67; §12 forbids a row
 * timestamp). Founder report 2026-10-02: Ledgerfold and Ajopot were passed;
 * a new pitch from either should bring it back, labelled.
 */
const A = "44444444-0000-4000-8000-0000000000a1";
const B = "44444444-0000-4000-8000-0000000000b1";
const C = "44444444-0000-4000-8000-0000000000c1";

const state = (passed: boolean, passedAt: string | null) =>
  ({ passed, passedAt }) as never;

function world(states: Record<string, unknown>, ready: Record<string, string>) {
  return createPitchReintroductions({
    repository: {
      stateForCompanies: () =>
        Promise.resolve(new Map(Object.entries(states)) as never),
    },
    pitches: {
      latestReadyAt: () => Promise.resolve(new Map(Object.entries(ready))),
    },
  });
}

const query = (companyIds: string[]) => ({
  tenantId: "t",
  investorOrganisationId: "o",
  mandateId: "m",
  mandateVersion: 1,
  companyIds,
});

describe("createPitchReintroductions", () => {
  it("a pitch ready after the pass reintroduces it as a material update, NEW_PITCH", async () => {
    const port = world(
      { [A]: state(true, "2026-10-01T12:33:30.000Z") },
      { [A]: "2026-10-02T08:04:06.000Z" },
    );
    expect(await port.reasonsFor(query([A]))).toEqual(
      new Map([
        [A, { reason: "MATERIAL_COMPANY_UPDATE", change: "NEW_PITCH" }],
      ]),
    );
  });

  it("a pitch that was already there, no pitch, or no pass: nothing", async () => {
    const port = world(
      {
        [A]: state(true, "2026-10-02T09:00:00.000Z"),
        [B]: state(true, "2026-10-01T09:00:00.000Z"),
        [C]: state(false, null),
      },
      { [A]: "2026-10-02T08:04:06.000Z", [C]: "2026-10-02T08:04:06.000Z" },
    );
    expect((await port.reasonsFor(query([A, B, C]))).size).toBe(0);
  });
});
