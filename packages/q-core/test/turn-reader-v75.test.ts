import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V74,
  TURN_READER_V75,
  TurnReaderV75ResultSchema,
  V62_DEEP_WORK,
  V75_INVESTMENT_MEMO,
} from "../src/index.js";

/**
 * Owner decision 2026-10-31: "Write me an IC memo on Portside" came back
 * as a quick profile-only report. v75 reads an investment memo on a
 * company as its own field, so code starts the researched memo job.
 */
describe("TURN_READER v75", () => {
  it("is the active reader: v74 with one INVESTMENT MEMO rule after DEEP WORK, nothing else", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(75);
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV75ResultSchema,
    );
    expect(
      TURN_READER_V75.template.replace(
        `${V62_DEEP_WORK}${V75_INVESTMENT_MEMO}`,
        V62_DEEP_WORK,
      ),
    ).toBe(TURN_READER_V74.template);
    // The founder's own memo and a short summary stay off it (v62's intent).
    expect(V75_INVESTMENT_MEMO).toMatch(
      /false for their own company's deck, one-pager or memo/u,
    );
    expect(V75_INVESTMENT_MEMO).toMatch(/quick summary of Portside/u);
    expect(V75_INVESTMENT_MEMO).toMatch(/teamJob is true with it/u);
  });

  it("reads investmentMemo leniently: absent or malformed is false, never a lost reading", () => {
    const base = {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
    };
    expect(TurnReaderV75ResultSchema.parse(base).investmentMemo).toBe(false);
    expect(
      TurnReaderV75ResultSchema.parse({ ...base, investmentMemo: "IC" })
        .investmentMemo,
    ).toBe(false);
    expect(
      TurnReaderV75ResultSchema.parse({ ...base, investmentMemo: true })
        .investmentMemo,
    ).toBe(true);
  });
});
