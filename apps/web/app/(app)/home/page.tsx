import type { Metadata } from "next";

import { redirect } from "next/navigation";

import { HomeScreen } from "@/features/home/home-screen";
import { onboardingPath, resolveOnboardingState } from "@/features/q/context";

export const metadata: Metadata = { title: "Home" };

/**
 * Home is one person's Q, never a cached page.
 *
 * Without this it is statically rendered, and a client component reading
 * the URL suspends during a static render and falls back to null. The
 * effect was precise and baffling: `/home` worked, `/home?c=<id>` showed
 * the page furniture and no Q at all.
 */
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /**
   * Which conversation is open, read on the server (QX-003A).
   *
   * It used to be read in the browser with `useSearchParams`, and that
   * was the whole of the history bug. The hook hydrated correctly — the
   * action returned the turns, the merge worked, the projection produced
   * them — and then the panel remounted as the parameter resolved, so
   * the instance holding the restored conversation was thrown away and
   * the one on screen had never fetched anything. Two instances, and the
   * wrong one won.
   *
   * The page already renders per request and already has the parameter.
   * Passing it down means the panel is mounted once, with the answer.
   */
  // Founder direction 2026-09-30: Q's page is the interview until the
  // person has been onboarded; general Q knows nothing to work from yet.
  const unfinished = onboardingPath(await resolveOnboardingState());
  if (unfinished !== null) redirect(unfinished);
  const params = await searchParams;
  const raw = params["c"];
  const conversationId = typeof raw === "string" && raw.length > 0 ? raw : null;
  return <HomeScreen conversationId={conversationId} />;
}
