import { describe, expect, it } from "vitest";

import { handleFrom } from "../src/index.js";

/** QA F-34: a handle offered from their organisation's own name. */
describe("a Q Card handle from a name", () => {
  it("takes the card page's own shape, without bracketed notes", () => {
    expect(handleFrom("Maji Loop")).toBe("maji-loop");
    expect(handleFrom("Savanna Seed Partners (fictional)")).toBe(
      "savanna-seed-partners",
    );
    expect(handleFrom("Café Ndoto & Co.")).toBe("cafe-ndoto-co");
    expect(handleFrom("A")).toBeNull();
    expect(handleFrom("صفحة")).toBeNull();
    expect(
      (handleFrom("An Extremely Long Company Name That Keeps Going") ?? "")
        .length,
    ).toBeLessThanOrEqual(30);
  });
});
