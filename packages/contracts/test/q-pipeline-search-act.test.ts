import { describe, expect, it } from "vitest";
import { QUiActIntentSchema } from "../src/q/ui-act.js";
const action = {
  kind: "UI_ACT",
  actId: "uia_pipeline01",
  act: "FILTER",
  target: "filter.pipeline-search",
};
describe("bounded pipeline search screen values", () => {
  it.each(["Maji Loop", "Lagos — utilities", "", "x".repeat(120)])(
    "accepts literal search text through the scoped filter: %s",
    (value) => {
      expect(QUiActIntentSchema.safeParse({ ...action, value }).success).toBe(
        true,
      );
    },
  );
  it.each(["x".repeat(121), "Maji\nLoop", "Maji\u0000Loop"])(
    "rejects oversized or control-character search: %s",
    (value) => {
      expect(QUiActIntentSchema.safeParse({ ...action, value }).success).toBe(
        false,
      );
    },
  );
  it.each([
    "filter.pipeline-sort",
    "filter.pipeline-state",
    "input.document-search",
  ])("keeps arbitrary text out of other controls: %s", (target) => {
    expect(
      QUiActIntentSchema.safeParse({ ...action, target, value: "Maji Loop" })
        .success,
    ).toBe(false);
    expect(
      QUiActIntentSchema.safeParse({ ...action, target, value: "" }).success,
    ).toBe(false);
  });
  it("retains existing code, boolean and null values", () => {
    for (const value of ["CONNECTED", true, null])
      expect(
        QUiActIntentSchema.safeParse({
          ...action,
          target: "filter.pipeline-state",
          value,
        }).success,
      ).toBe(true);
  });
});
