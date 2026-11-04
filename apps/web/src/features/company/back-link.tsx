"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { cx } from "@capital-q/ui";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";
import { useT } from "@/features/i18n/language";

import { canGoBack, markInAppNavigation, markLanding } from "./back-history";

/**
 * "Back" on an interior page (founder 2026-10-08; client feedback UX-04,
 * 2026-11-04; "the back icon in all pages", 2026-11-04). Goes back to where
 * the person came from when that was inside Capital Q, and to the fallback
 * (the page's parent) otherwise: a deep link, a new tab or an outside
 * referrer never leaves Capital Q or loops. A real link, so it works
 * without script. Never on a root page (see test/back-everywhere.test.ts).
 *
 * One look everywhere: top-left of the page head, a 44 px target at every
 * width, the arrow mirrored in right-to-left languages, and an accessible
 * name that says where it goes ("Back to CRM").
 */
export function BackLink({
  fallbackHref,
  label,
  className,
}: {
  readonly fallbackHref: string;
  /**
   * The parent's name, already translated ("CRM", "Rehearsals"). Shown
   * beside the arrow; read out as "Back to …". Without it the link reads
   * "Back".
   */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      data-back-link
      aria-label={backLinkName(t, label)}
      className={cx(
        "cq-body-sm -ms-1 inline-flex min-h-11 min-w-11 items-center gap-1.5 self-start rounded-(--cq-radius-md) px-1 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
        className,
      )}
      onClick={(event) => {
        // A modified click opens a new tab: the link's own href is right.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        if (!canGoBack(browserHistory())) return;
        event.preventDefault();
        router.back();
      }}
    >
      <ArrowLeft
        size={ICON_SIZE.compact}
        aria-hidden="true"
        className="shrink-0 rtl:rotate-180"
      />
      {label ?? t("Back")}
    </Link>
  );
}

/** "Back", or "Back to {name}" (a catalogue pattern, so it translates). */
export function backLinkName(
  t: (english: string) => string,
  label: string | undefined,
): string {
  return label === undefined ? t("Back") : t(`Back to ${label}`);
}

/**
 * Mounted once in the signed-in layout: notes that a client-side move has
 * happened, which `document.referrer` never reflects (it keeps the page
 * the tab was first loaded from), so Back can use the real history.
 */
export function InAppNavigationMark() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    markLanding(first.current);
    if (pathname !== first.current) markInAppNavigation();
  }, [pathname]);
  return null;
}

function browserHistory() {
  return {
    length: window.history.length,
    referrer: document.referrer,
    origin: window.location.origin,
    pathname: window.location.pathname,
  };
}
