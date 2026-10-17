import { describe, expect, it } from "vitest";

import { applicationAsks } from "../src/features/gateq/page/application-asks";

describe("applicationAsks (executive review 2026-10-17)", () => {
  it("asks about this exact application and keeps claims, evidence and fit apart", () => {
    const asks = applicationAsks("FDN Advisory");
    expect(asks).toHaveLength(3);
    for (const [, ask] of asks) {
      expect(ask).toContain("FDN Advisory's submitted GateQ application");
    }
    expect(asks.map(([, ask]) => ask).join(" ")).toMatch(
      /claimed apart from what is evidenced/,
    );
    expect(asks[2]?.[1]).toMatch(/Don't merge the two/);
  });
});
