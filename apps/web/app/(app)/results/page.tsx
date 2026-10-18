import { redirect } from "next/navigation";

/**
 * Results became the CRM's Reports tab, and Reports is now part of the
 * Overview (owner feedback 2026-10-15: they were the same page). Every
 * older link keeps working: its period (range, or from/to) and its stage
 * travel with it. The report downloads stay at /results/report.
 */
export default async function ResultsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
} = {}) {
  const params = (await searchParams) ?? {};
  const kept = new URLSearchParams({ view: "overview" });
  for (const key of ["range", "stage", "from", "to"]) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 40)
      kept.set(key, value);
  }
  redirect(`/relationships?${kept.toString()}`);
}
