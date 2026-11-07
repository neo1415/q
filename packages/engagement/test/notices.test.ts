import { describe, expect, it } from "vitest";

import { noticeSaves } from "../src/index.js";

const actor = { userId: "b0000000-0000-4000-8000-000000000001" };
const event = {
  investorOrganisationId: "c0000000-0000-4000-8000-000000000001",
  companyId: "f0000000-0000-4000-8000-000000000001",
};

describe("save notices on Discover decisions (A6)", () => {
  it("only a newly recorded save tells the founders", async () => {
    const told: unknown[] = [];
    const notices = {
      companySaved: (input: unknown) => {
        told.push(input);
        return Promise.resolve(1);
      },
    };
    const outcomes = {
      SAVE: { kind: "RECORDED", deduplicated: false, event },
      PASS: { kind: "RECORDED", deduplicated: false, event },
    } as const;
    const decide = noticeSaves(
      (type: "SAVE" | "PASS") => Promise.resolve(outcomes[type]),
      notices,
    );
    await decide("SAVE", { actor });
    await decide("PASS", { actor });
    expect(told).toEqual([{ saverUserId: actor.userId, ...event }]);

    const repeat = noticeSaves(
      () => Promise.resolve({ kind: "RECORDED", deduplicated: true, event }),
      notices,
    );
    await repeat("SAVE", { actor });
    const refused = noticeSaves(
      () => Promise.resolve({ kind: "REFUSED" }),
      notices,
    );
    await refused("SAVE", { actor });
    expect(told).toHaveLength(1);
  });

  it("a failed notice never fails the save", async () => {
    const decide = noticeSaves(
      () => Promise.resolve({ kind: "RECORDED", deduplicated: false, event }),
      { companySaved: () => Promise.reject(new Error("down")) },
    );
    await expect(decide("SAVE", { actor })).resolves.toMatchObject({
      kind: "RECORDED",
    });
  });
});
