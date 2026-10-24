import { describe, expect, it } from "vitest";

import { greetingNameOf } from "../src/features/welcome/welcome-screen";

describe("QA F-48: the welcome greets by first name, as Q does in setup", () => {
  it("uses the first name, or none when it is the organisation's first word", () => {
    expect(greetingNameOf("Ama Mensah", null)).toBe("Ama");
    expect(
      greetingNameOf("Audit Ridge Capital", "Audit Ridge Capital"),
    ).toBeNull();
    expect(greetingNameOf(null, "Tamarind Ledger")).toBeNull();
  });
});
