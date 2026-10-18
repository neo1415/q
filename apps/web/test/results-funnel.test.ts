import { describe, expect, it } from "vitest";

import { funnelSteps } from "@/features/results/results-dashboard";

/** Live check 2026-10-16: "Seen 0" sat beside "Interest 10". */
describe("the investor's funnel", () => {
  const f = {
    seen: 0,
    saved: 3,
    interest: 10,
    connected: 9,
    met: 0,
    committed: 1,
  };

  it("says views were not recorded when fewer were seen than acted on, never 0", () => {
    expect(funnelSteps(f)[0]).toEqual({ label: "Seen", value: null });
    expect(
      funnelSteps(f)
        .slice(1)
        .map((step) => step.value),
    ).toEqual([3, 10, 9, 0, 1]);
  });

  it("keeps a recorded count, zero included, when it is consistent", () => {
    expect(funnelSteps({ ...f, seen: 40 })[0]?.value).toBe(40);
    expect(
      funnelSteps({
        seen: 0,
        saved: 0,
        interest: 0,
        connected: 0,
        met: 0,
        committed: 0,
      })[0]?.value,
    ).toBe(0);
  });
});
