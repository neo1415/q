import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BriefingHarness } from "./briefing-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arrival briefing harness",
  robots: { index: false },
};

/**
 * The arrival briefing (2026-10-08) over fictional data: the greeting by a
 * fixed clock and zone, the lowdown, and the decision cards, with every
 * decision recorded on the page instead of sent. Spoken replies are fed
 * through the same path the voice line uses. Nothing here reaches Q, the
 * database or a provider.
 *
 * `?state=quiet` is a day with nothing; `?variant=dock` is the compact
 * version another page shows beside the dock; `?at=<ISO>&tz=<zone>` sets the
 * clock; `?fail=changed` makes approvals come back as changed.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function BriefingHarnessPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return (
    <BriefingHarness
      state={one("state") === "quiet" ? "quiet" : "cards"}
      at={one("at") ?? "2026-10-08T13:30:00.000Z"}
      timeZone={one("tz") ?? "Africa/Lagos"}
      fail={one("fail") === "changed"}
      dock={one("variant") === "dock"}
    />
  );
}
