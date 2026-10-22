import { describe, expect, it } from "vitest";

import { buildVCard } from "../src/features/q-card/vcard";

describe("a Q Card's contact file", () => {
  it("files an organisation under ORG with an empty structured name", () => {
    const body = buildVCard({
      name: "Kivu Freight",
      cardUrl: "https://capitalq.app/@kivu",
      websiteUrl: null,
      note: null,
    });
    expect(body).toContain("N:;;;;\r\n");
    expect(body).toContain("ORG:Kivu Freight\r\n");
  });

  it("files a person by name, with their organisation and title only when public", () => {
    const body = buildVCard({
      name: "Wanjiku Kamau",
      cardUrl: "https://capitalq.app/@wanjiku",
      websiteUrl: null,
      note: null,
      person: { organisation: "Savanna Ventures", title: "Managing Partner" },
    });
    expect(body).toContain("FN:Wanjiku Kamau\r\n");
    expect(body).toContain("ORG:Savanna Ventures\r\n");
    expect(body).toContain("TITLE:Managing Partner\r\n");
    const bare = buildVCard({
      name: "Wanjiku Kamau",
      cardUrl: "https://capitalq.app/@wanjiku",
      websiteUrl: null,
      note: null,
      person: { organisation: null, title: null },
    });
    expect(bare).not.toContain("ORG:");
    expect(bare).not.toContain("TITLE:");
  });
});
