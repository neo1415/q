import { describe, expect, it } from "vitest";

import { planLeadLines } from "../src/readiness-lead.js";

describe("what should I do next: the plan's open steps (Q.04)", () => {
  it("lists the first three steps still to do, in the plan's order", () => {
    const lines = planLeadLines({
      kind: "plan",
      available: true,
      items: [
        {
          title: "Upload your pitch deck",
          status: "to do (now)",
          facts: { next: "Upload the deck." },
        },
        {
          title: "Confirm founders",
          status: "done: Q sees the evidence",
          facts: {},
        },
        { title: "Name your use of funds", status: "to do (now)", facts: {} },
        { title: "Share burn and runway", status: "to do (next)", facts: {} },
        { title: "Choose your sector", status: "to do (later)", facts: {} },
      ],
    });
    expect(lines).toBe(
      [
        "What to do next for your raise, most important first:",
        "1. Upload your pitch deck. Upload the deck.",
        "2. Name your use of funds.",
        "3. Share burn and runway.",
      ].join("\n"),
    );
  });

  it("is null when nothing is left or the read is not a plan", () => {
    expect(planLeadLines({ items: [] })).toBeNull();
    expect(planLeadLines(null)).toBeNull();
  });
});
