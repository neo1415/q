"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@capital-q/ui";
import { ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import { useHomeHref } from "@/features/q/active-conversation";

import {
  isActiveRoute,
  MOBILE_CENTRE_HREF,
  MOBILE_NAVIGATION,
} from "./navigation";

/**
 * Canonical mobile navigation: five fixed tabs, Discover first and Q in the
 * centre (founder directive, 2026-09-27), each a 44 px+ target with a
 * visible icon and label. Labels are set a step smaller and tighter than
 * caption so "Relationships" fits a 360 px phone without truncating. The active tab is marked by aria-current, weight
 * and an indicator bar as well as colour.
 */
export function MobileNavigation() {
  const pathname = usePathname();
  // Home is the conversation this tab was in, not a new chat each visit.
  const home = useHomeHref();

  return (
    <nav aria-label="Primary" className="cq-bottom-nav">
      <ul className="grid h-full grid-cols-5">
        {MOBILE_NAVIGATION.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href === "/home" ? home : item.href}
                aria-current={active ? "page" : undefined}
                data-active={active ? "" : undefined}
                className={cx(
                  "relative flex h-full min-h-11 flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight tracking-tight transition-colors duration-(--cq-motion-fast)",
                  active
                    ? "font-semibold text-(--cq-accent)"
                    : "font-medium text-(--cq-text-secondary)",
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-(--cq-accent)"
                  />
                ) : null}
                {item.href === MOBILE_CENTRE_HREF ? (
                  // Q is the centre of the bar: its mark on a soft accent
                  // disc, so it reads as Q without any glow in the chrome.
                  <span
                    aria-hidden="true"
                    data-nav-centre
                    className="flex size-8 items-center justify-center rounded-full bg-(--cq-accent-soft) text-(--cq-accent)"
                  >
                    <Icon
                      aria-hidden="true"
                      size={ICON_SIZE.prominent + 2}
                      strokeWidth={2}
                    />
                  </span>
                ) : (
                  <Icon
                    aria-hidden="true"
                    size={ICON_SIZE.prominent + 2}
                    strokeWidth={active ? 2 : ICON_STROKE}
                  />
                )}
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
