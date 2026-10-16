import { describe, expect, it } from "vitest";

import {
  arabicInvestorDiscoveryText,
  investorDiscoveryText,
} from "../src/q/investor-discovery-answer.js";

describe("investor discovery wording (live 2026-10-10)", () => {
  for (const [said, shown] of [
    ["middle east", "Middle East"],
    ["arab", "Arab"],
    ["gcc", "GCC"],
    ["gulf", "Gulf"],
  ] as const) {
    it(`"${said}" reads "${shown}"`, () => {
      const text = investorDiscoveryText([], {
        regionWords: [said],
        asked: 3,
        outcome: "NONE",
        aboutMyCompany: true,
      });
      expect(text).toContain(`from the ${shown} region`);
    });
  }
});

describe("investor discovery in Arabic (live 2026-10-16)", () => {
  const card = (name: string) => ({
    card: { subject: { displayName: name }, actions: [] },
    role: "INVESTOR" as const,
    fit: [],
    source: "KNOWN_ENTITY" as const,
  });

  it("names the investors as recorded, with Arabic agreement and region", () => {
    const one = arabicInvestorDiscoveryText(
      [card("AlRayan Investment LLC")] as never,
      {
        regionWords: ["Gulf"],
        asked: 3,
        outcome: "FOUND",
        aboutMyCompany: true,
      },
    );
    expect(one).toMatch(
      /^لم أجد إلا مستثمراً واحداً من الخليج قد يناسب شركتك: AlRayan Investment LLC\./u,
    );
    expect(one).toContain("ولم يُبدِ أيٌّ منهم اهتماماً");
    expect(one).not.toMatch(/\b(?:investor|interested|rehearsal)\b/iu);
    const three = arabicInvestorDiscoveryText(
      [card("A Capital"), card("B Ventures"), card("C Partners")] as never,
      {
        regionWords: ["gcc"],
        asked: 3,
        outcome: "FOUND",
        aboutMyCompany: false,
      },
    );
    expect(three).toMatch(
      /^3 مستثمرين من دول مجلس التعاون الخليجي قد يناسبون: A Capital، B Ventures وC Partners\./u,
    );
  });

  it("says none and unavailable plainly, a region it cannot name left out", () => {
    expect(
      arabicInvestorDiscoveryText([], {
        regionWords: ["levantine"],
        asked: 3,
        outcome: "NONE",
        aboutMyCompany: true,
      }),
    ).toBe(
      "بحثت في المستثمرين الذين أعرفهم وفي بحث عام ولم أجد بعد مستثمرين أستطيع تسميتهم. سيساعدني ذكر قطاع أو دولة على التضييق.",
    );
    expect(
      arabicInvestorDiscoveryText([], {
        regionWords: [],
        asked: 3,
        outcome: "UNAVAILABLE",
        aboutMyCompany: true,
      }),
    ).toMatch(/^البحث العام لا يستجيب الآن/u);
  });
});
