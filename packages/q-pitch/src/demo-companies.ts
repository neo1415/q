/**
 * Named fictional demo companies the tour may open directly (owner decision
 * 15 Oct): presented as "a company with a pitch", never as a mandate rank,
 * so the ranking is never rigged. Each is fictional (founders flagged
 * fictional_demo), marketplace-ready and has a READY pitch (read-only check,
 * production, 15 Oct). The investor's access to each data room is set up by
 * the product's own flows (scripts/handoff/live/q-pitch-demo-access.mjs).
 *
 * The page still decides what the viewer may see: opening a key is an
 * ordinary navigation, re-checked by the server for the signed-in actor.
 */
export type DemoCompany = {
  readonly companyId: string;
  readonly name: string;
};

export const DEMO_COMPANIES: Readonly<Record<string, DemoCompany>> = {
  "harbourline-cargo": {
    companyId: "ceb6ec2d-4a4a-41a2-9b71-377d72c26407",
    name: "Harbourline Cargo",
  },
  clinicrest: {
    companyId: "6b2f9851-d7e3-4197-9fd1-beffbdc153fe",
    name: "Clinicrest",
  },
};

/** The named demo company for a fixture key, or null. */
export function demoCompany(key: string): DemoCompany | null {
  return Object.hasOwn(DEMO_COMPANIES, key)
    ? (DEMO_COMPANIES[key] ?? null)
    : null;
}
