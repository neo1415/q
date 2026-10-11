"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * P4: the edition the welcome's stories open is fetched while Q greets, so
 * "open it" lands at once by client navigation (the voice line stays up).
 * Renders nothing.
 */
export function DailyPrefetch({
  paths,
}: {
  readonly paths: readonly string[];
}) {
  const router = useRouter();
  const key = paths.join("|");
  useEffect(() => {
    for (const path of key.split("|")) {
      if (!path.startsWith("/daily/")) continue;
      try {
        router.prefetch(path);
      } catch {
        // Only a head start; navigation works without it.
      }
    }
  }, [key, router]);
  return null;
}
