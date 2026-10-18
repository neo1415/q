/**
 * A founder's Capital page, in tabs (founder 2026-10-08: "there are so many
 * different things there; can we break them up into different tabs?";
 * design: docs/design/2026-10-08/capital-tabs). One URL per tab
 * (`/capital?tab=…`), so a link, Q and the back button all land on the
 * same tab. Overview is the default and stays short.
 */

export const CAPITAL_TABS = [
  // "Summary": the CRM's own first tab is Overview, so Capital's first
  // sub-tab may not repeat the word (its id stays `overview` for Q).
  { key: "overview", label: "Summary" },
  { key: "raise", label: "Raise & rounds" },
  { key: "readiness", label: "Readiness" },
  { key: "action-plan", label: "Action plan" },
  { key: "plan", label: "12-month plan" },
  { key: "investors", label: "Investors" },
] as const;

export type CapitalTab = (typeof CAPITAL_TABS)[number]["key"];

const KEYS: ReadonlySet<string> = new Set(CAPITAL_TABS.map((tab) => tab.key));

export function isCapitalTab(value: unknown): value is CapitalTab {
  return typeof value === "string" && KEYS.has(value);
}

/**
 * The tab a request opens. An unknown or missing tab is Overview, except
 * where an older link already says what it wants: `?round=` (Q's round
 * card) is Raise & rounds, `?horizon=` (the Blueprint switcher) is the plan.
 */
export function capitalTabFrom(params: {
  readonly tab?: string | undefined;
  readonly round?: string | undefined;
  readonly horizon?: string | undefined;
}): CapitalTab {
  if (isCapitalTab(params.tab)) return params.tab;
  if (params.round !== undefined && params.round !== "") return "raise";
  if (params.horizon !== undefined && params.horizon !== "") return "plan";
  return "overview";
}

/**
 * The address of one tab, inside the CRM's Capital tab (owner 2026-10-16);
 * the summary is the tab itself. `/capital?tab=` still forwards here.
 */
export function capitalTabHref(
  tab: CapitalTab,
  extra: Readonly<Record<string, string>> = {},
): string {
  const query = new URLSearchParams(
    tab === "overview"
      ? { view: "capital", ...extra }
      : { view: "capital", tab, ...extra },
  ).toString();
  return `/relationships?${query}`;
}

/**
 * Anchors the page had before it had tabs (Q room cards, Home, saved
 * links): each still opens its tab.
 */
export const LEGACY_HASH_TABS: Readonly<Record<string, CapitalTab>> = {
  rounds: "raise",
  commitments: "raise",
  "rounds-timeline": "raise",
  readiness: "readiness",
  "action-plan": "action-plan",
  "readiness-blueprint": "plan",
  relationships: "investors",
};

/** The tab an old `/capital#anchor` link meant, or null. */
export function tabForHash(hash: string): CapitalTab | null {
  const anchor = hash.replace(/^#/u, "");
  if (anchor.startsWith("round-")) return "raise";
  return LEGACY_HASH_TABS[anchor] ?? null;
}
