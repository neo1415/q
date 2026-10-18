"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/** The person asked their browser to spend less data: no extra prefetch. */
function saveData(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return connection?.saveData === true;
}

/**
 * A navigation link that prefetches by intent (P9).
 *
 * In view it prefetches what Next prefetches by default for a dynamic
 * page: the shell down to its loading state, so a tap shows that state at
 * once even on a slow line. When the person shows intent -- a pointer
 * over it, keyboard focus, or a finger touching down -- it switches to a
 * full prefetch, so the click usually lands on the rendered page. A
 * full prefetch is reused only briefly (`staleTimes.static` in
 * next.config.ts), so a hover long before the click never shows old data.
 */
export function IntentLink({
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [intent, setIntent] = useState(false);
  const show = () => {
    if (!intent && !saveData()) setIntent(true);
  };
  return (
    <Link
      {...props}
      prefetch={intent ? true : null}
      onPointerEnter={(event) => {
        show();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        show();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        show();
        onTouchStart?.(event);
      }}
    />
  );
}
