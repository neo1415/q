import type { Metadata } from "next";

import { HomeScreen } from "@/features/home/home-screen";

export const metadata: Metadata = { title: "Home" };

/**
 * Home is one person's Q, never a cached page.
 *
 * Without this it is statically rendered, and the conversation panel
 * reads the open conversation from the URL with `useSearchParams` — which
 * suspends during a static render and fell back to `null`. The effect was
 * precise and baffling: `/home` worked, `/home?c=<id>` showed the page
 * furniture and no Q at all, so reopening a conversation from Chats lost
 * the entire thread rather than just its cards. It resolves per request
 * because everything on it already does.
 */
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <HomeScreen />;
}
