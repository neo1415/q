// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { QUsageDto } from "@capital-q/contracts";

import { UsageView } from "../src/features/billing/usage-view";

afterEach(cleanup);

const usage: QUsageDto = {
  month: "2026-10",
  totalUsd: "0.810000",
  calls: 1389,
  unpricedCalls: 2,
  failedCalls: 385,
  byTask: [
    { purpose: "CONVERSATION", usd: "0.390000", calls: 40 },
    { purpose: "REHEARSAL", usd: "0.080000", calls: 9 },
    { purpose: "OTHER", usd: "0", calls: 3 },
  ],
  instructions: [],
  plan: null,
};

describe("Settings → Usage (design-48)", () => {
  it("leads with the month's figure and its currency", () => {
    render(<UsageView usage={usage} />);
    expect(screen.getByText("$0.81")).toBeTruthy();
    expect(screen.getByText("USD")).toBeTruthy();
    expect(screen.getByText("Conversations with Q")).toBeTruthy();
  });

  it("never shows call counts or failed calls to the person", () => {
    render(<UsageView usage={usage} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/failed|model call|1389|385/u);
    // A purpose with nothing spent is not a row.
    expect(screen.queryByText("Other")).toBeNull();
  });

  it("says nothing was used when nothing was", () => {
    render(<UsageView usage={{ ...usage, totalUsd: "0", byTask: [] }} />);
    expect(screen.getByText("$0.00")).toBeTruthy();
    expect(screen.getByText("Nothing used yet this month.")).toBeTruthy();
  });
});
