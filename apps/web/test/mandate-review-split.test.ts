import { describe, expect, it } from "vitest";

import { splitReview } from "@/features/investor-onboarding/investor-onboarding-screen";

type Groups = Parameters<typeof splitReview>[0];

const words =
  "A USD 40m seed fund leading rounds for African fintech and B2B software.";

describe("the mandate review, readable on a phone", () => {
  it("keeps stated answers in their groups and lists every unstated one once, at the end", () => {
    const review: Groups = [
      {
        label: "Cheque",
        items: [
          { stepKey: "currency", title: "Currency", value: "US dollar" },
          { stepKey: "lead", title: "Lead or follow", value: null },
        ],
      },
      {
        label: "Preferences",
        items: [
          { stepKey: "models", title: "Business models", value: null },
          { stepKey: "own", title: "Your own criteria", value: words },
        ],
      },
      {
        label: "Unknowns",
        items: [{ stepKey: "words", title: "In your own words", value: words }],
      },
    ] as Groups;
    const { stated, unstated } = splitReview(review);
    expect(stated.map((group) => group.label)).toEqual([
      "Cheque",
      "Preferences",
    ]);
    expect(stated[1]?.items.map((item) => item.title)).toEqual([
      "Your own criteria",
    ]);
    expect(unstated.map((item) => item.title)).toEqual([
      "Lead or follow",
      "Business models",
    ]);
  });
});
