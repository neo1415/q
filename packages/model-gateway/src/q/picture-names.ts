// Moved unchanged from result-blocks.ts (W4-G, shrink-only rule).
/** Every name a run read, for a picture search to withhold (L-13). */
export function namesReadByRun(read: {
  readonly companyNames: ReadonlyMap<string, string>;
  readonly profiles: ReadonlyMap<string, string>;
  readonly investors: ReadonlyMap<string, { readonly name: string }>;
  readonly externals: ReadonlyMap<string, { readonly name: string }>;
  readonly relationships: ReadonlyMap<
    string,
    { readonly counterpart: { readonly name: string | null } }
  >;
}): readonly string[] {
  const names = new Set<string>([
    ...read.companyNames.values(),
    ...read.profiles.values(),
    ...[...read.investors.values()].map((one) => one.name),
    ...[...read.externals.values()].map((one) => one.name),
    ...[...read.relationships.values()].map(
      (one) => one.counterpart.name ?? "",
    ),
  ]);
  return [...names].filter((name) => name.trim().length > 0).slice(0, 100);
}
