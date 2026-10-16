/**
 * Fictional investor organisations the founder track opens by key (never
 * an id in a script). Owned by the founder-track lane (qpf), which adds
 * the rest; every entry is a fictional demo investor.
 */
export const DEMO_INVESTORS = {
  "savanna-seed-partners": {
    investorOrganisationId: "1c4b9266-350c-409d-9582-04a0f771b8a8",
    name: "Savanna Seed Partners",
  },
} as const satisfies Readonly<
  Record<
    string,
    { readonly investorOrganisationId: string; readonly name: string }
  >
>;

export type DemoInvestorKey = keyof typeof DEMO_INVESTORS;

export function demoInvestor(
  key: string,
): { readonly investorOrganisationId: string; readonly name: string } | null {
  return Object.hasOwn(DEMO_INVESTORS, key)
    ? DEMO_INVESTORS[key as DemoInvestorKey]
    : null;
}
