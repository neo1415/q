"use client";

import { useEffect, useState } from "react";

/**
 * The stage presence grows with the screen: 160 on a phone, 224 from the
 * desktop breakpoint. Read after mount so the server and the first client
 * render agree; the canvas re-initialises once when the size settles.
 */
export function useStagePresenceSize(): 160 | 224 {
  const [size, setSize] = useState<160 | 224>(160);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setSize(query.matches ? 224 : 160);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return size;
}
