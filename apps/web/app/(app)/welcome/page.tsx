import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loadWebServerConfig } from "@capital-q/config/web";

import { resolveOwnContext } from "@/features/q/context";
import { WelcomeScreen } from "@/features/welcome/welcome-screen";
import { fetchMe } from "@capital-q/api-client";
import { getSessionAccessToken } from "@/auth/session";

export const metadata: Metadata = {
  title: "Welcome",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Arrival (CQ-Q-VOICE-001 rework). A person Capital Q already knows goes
 * straight to Home; a new person meets Q first. `?again=1` lets anyone
 * come back to it.
 */
export default async function WelcomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = loadWebServerConfig();
  const params = await searchParams;
  if (config.qApiBaseUrl === undefined) {
    redirect("/home");
  }
  const context = await resolveOwnContext();
  if (context.kind !== "NONE" && params["again"] !== "1") {
    redirect("/home");
  }
  let knownName: string | null = null;
  const accessToken = await getSessionAccessToken();
  if (accessToken !== null && config.apiBaseUrl !== undefined) {
    try {
      const me = await fetchMe({ baseUrl: config.apiBaseUrl, accessToken });
      knownName = me.user.displayName;
    } catch {
      knownName = null;
    }
  }
  return <WelcomeScreen knownName={knownName} />;
}
