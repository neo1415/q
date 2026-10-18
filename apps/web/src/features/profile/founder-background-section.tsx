import {
  getMyCompanyMembership,
  getMyFounderProfile,
} from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import { FounderBackground } from "./founder-background";

/** F4: reads the founder's own background; nothing shows when unreadable. */
export async function FounderBackgroundSection({
  companyId,
}: {
  readonly companyId: string;
}) {
  const session = await apiSession();
  if (session === null) return null;
  const [profile, membership] = await Promise.all([
    // A founder with no profile yet starts empty (404 is a normal state).
    getMyFounderProfile(session, companyId).catch(() => null),
    getMyCompanyMembership(session, companyId).catch(() => null),
  ]);
  return (
    <FounderBackground
      initial={{
        businessTitle: membership?.businessTitle ?? "",
        previousRoles: profile?.professionalSummary ?? "",
        education: profile?.backgroundSummary ?? "",
        version: profile?.version ?? null,
      }}
    />
  );
}
