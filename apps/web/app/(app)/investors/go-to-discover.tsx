"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A founder's investor list is Discover's Investors tab. A server
 * `redirect()` here runs after the shell has started streaming, so Next
 * falls back to a `<meta http-equiv="refresh">`, which axe reports as a
 * critical violation (2026-10-08). The client router replaces the
 * address instead (no history entry), and the page beside it says where
 * the list is, with a link, for anyone without script.
 */
export function GoToDiscover() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/discover");
  }, [router]);
  return null;
}
