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

  it("is written in Arabic for a person who chose Arabic (lane ml, live 2026-10-16)", () => {
    const lines = planLeadLines(
      {
        items: [
          {
            title: "Add 3 months of revenue evidence",
            status: "to do (now)",
            facts: {
              next: "Upload bank statements or invoices for the last three months.",
            },
          },
          { title: "A step added later", status: "to do (next)", facts: {} },
        ],
      },
      "ar",
    );
    expect(lines).toBe(
      [
        "الخطوات التالية لجولة التمويل، الأهم أولاً:",
        "1. أضف إثبات إيرادات لثلاثة أشهر. ارفع كشوف حساب بنكية أو فواتير لآخر ثلاثة أشهر.",
        // A rule without an Arabic rendering stays as recorded, never lost.
        "2. A step added later.",
      ].join("\n"),
    );
    expect(lines).not.toContain("What to do next");
  });
});
