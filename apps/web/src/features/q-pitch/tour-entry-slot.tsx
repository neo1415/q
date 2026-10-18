import "server-only";

import { resolveTourSubject } from "./subject";
import { QPitchEntry } from "./tour-entry";

/**
 * The Q Pitch host with its subject company, streamed after the page
 * (perf lane 2026-10-16). The subject is read with the viewer's full
 * company-profile read, the heaviest read the API has (p50 ~500 ms hosted,
 * spikes to 10 s); awaited in the app layout it held every hard load's
 * first byte. Rendered inside a Suspense boundary, the shell and page paint
 * first and the host arrives when the read does. Nothing here decides who
 * may see the subject: that stays the API's profile rule.
 */
export async function QPitchEntrySlot({
  account,
  role,
}: {
  readonly account: string;
  readonly role: "INVESTOR" | "FOUNDER";
}) {
  const subject = await resolveTourSubject().catch(() => null);
  return <QPitchEntry account={account} role={role} subject={subject} />;
}
