import { describe, expect, it } from "vitest";

import {
  companiesNamedIn,
  coreOf,
  knownCompaniesOf,
} from "../src/q/named-companies.js";

const KNOWN = [
  { companyId: "a", name: "Yamfield Agro (fictional)" },
  { companyId: "b", name: "Tallyloom (fictional)" },
  { companyId: "c", name: "Kazikit Technologies Ltd (fictional)" },
  { companyId: "d", name: "Kora" },
  { companyId: "e", name: "Clinicrest" },
];

describe("their own companies a turn names (founder live 2026-10-01)", () => {
  it("finds names as typed and as speech misheard them", () => {
    expect(
      companiesNamedIn(
        "compare Yamfield Agro, Tallyloom and Kazikit against my mandate",
        KNOWN,
      ).map((c) => c.companyId),
    ).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(
      companiesNamedIn(
        "the three companies, like, Yamb Fielder grew, Tallyloom, and I think Kazakhit",
        KNOWN,
      )
        .map((c) => c.companyId)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("does not stretch short names or unrelated words into a match", () => {
    expect(companiesNamedIn("what's the core issue here?", KNOWN)).toEqual([]);
    expect(
      companiesNamedIn("tell me about Kora", KNOWN).map((c) => c.companyId),
    ).toEqual(["d"]);
    expect(
      companiesNamedIn("Summarize the Q Daily for me today", KNOWN),
    ).toEqual([]);
  });

  it("reads their companies from their own relationships, saves and passes, once each", () => {
    expect(
      knownCompaniesOf({
        relationships: [
          { counterpart: { kind: "COMPANY", id: "a", name: "Yamfield Agro" } },
          {
            counterpart: {
              kind: "INVESTOR_ORGANISATION",
              id: "x",
              name: "Fund",
            },
          },
        ],
        saved: [
          { companyId: "a", name: "Yamfield Agro" },
          { companyId: "b", name: "Tallyloom" },
        ],
        passed: [{ companyId: "c", name: "Kazikit" }],
      }).map((c) => c.companyId),
    ).toEqual(["a", "b", "c"]);
    expect(coreOf("Kazikit Technologies Ltd (fictional)")).toBe("kazikit");
  });
});

describe("a single word heard as a name (live 2026-10-02)", () => {
  it("reads TALUM as Tallyloom, and never 'them' or 'tell me'", () => {
    expect(
      companiesNamedIn(
        "Accept TALUM and send them a message. You can book a meeting with them too.",
        KNOWN,
      ).map((c) => c.companyId),
    ).toEqual(["b"]);
    expect(companiesNamedIn("tell me about them", KNOWN)).toEqual([]);
  });
});
