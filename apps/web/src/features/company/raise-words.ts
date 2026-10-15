import type { CompanyRaiseView } from "@capital-q/contracts";

import { compactMoneyText, moneyText } from "./money-text";

/**
 * The words for a company's raise, from the server's one raise read
 * (`raiseFor`, R2). The Discover card and the profile both say exactly
 * these, so one reader never sees "not shared" in one place and an amount
 * in the other. The label names where the figure came from: a pitch claim
 * is the company's own words in a video, never presented as the disclosed
 * raise, and neither is ever called verified.
 */
export type RaiseWords = {
  readonly source: CompanyRaiseView["source"];
  /** "$4M"; null when nothing is shared with this reader. */
  readonly amount: string | null;
  /** "USD 4,000,000", for the accessible name and the tooltip. */
  readonly exact: string | null;
  readonly label: string;
};

export function raiseWords(view: CompanyRaiseView, own: boolean): RaiseWords {
  if (view.money === null || view.source === "NONE") {
    return {
      source: "NONE",
      amount: null,
      exact: null,
      label: own ? "Not added yet" : "Not shared with you",
    };
  }
  return {
    source: view.source,
    amount: compactMoneyText(view.money),
    exact: moneyText(view.money),
    label:
      // Plain words an investor reads at a glance: where the figure came
      // from, never "verified". A pitch figure is what they said on video;
      // a declared one is what the company entered on Capital Q.
      view.source === "PITCH_CLAIM"
        ? own
          ? "Said in your pitch"
          : "Said in their pitch"
        : own
          ? "Your raise"
          : "Declared by the company",
  };
}
