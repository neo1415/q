"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cx } from "@capital-q/ui";
import { ICON_SIZE, ICON_STROKE, MoreHorizontal } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot, SheetTrigger } from "@capital-q/ui/sheet";
import type { ContextScope } from "@capital-q/ui/tokens";

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { useHomeHref } from "@/features/q/active-conversation";

import {
  isActiveRoute,
  MOBILE_CENTRE_HREF,
  MOBILE_NAVIGATION,
  moreSectionsFor,
} from "./navigation";

const TAB_CLASS =
  "relative flex h-full min-h-11 w-full flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight tracking-tight transition-colors duration-(--cq-motion-fast)";

/**
 * Canonical mobile navigation: five fixed tabs, Discover first and Q in the
 * centre (founder directive, 2026-09-27), then More, which opens every
 * other section from the same source as the desktop sidebar
 * (`moreSectionsFor`). Each tab is a 44 px+ target with a
 * visible icon and label. Labels are set a step smaller and tighter than
 * caption so "Relationships" fits a 360 px phone without truncating. The active tab is marked by aria-current, weight
 * and an indicator bar as well as colour.
 */
export function MobileNavigation({
  scope = "unset",
}: {
  readonly scope?: ContextScope | undefined;
}) {
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
                  TAB_CLASS,
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
        <li className="min-w-0">
          <MoreSheet scope={scope} pathname={pathname} />
        </li>
      </ul>
    </nav>
  );
}

/**
 * The More tab and its sheet. The tab reads as current while the page is
 * one of the sheet's sections, so the bar always shows where the person
 * is; inside, the page itself is marked with aria-current. The theme sits
 * at the foot, worded, so it is reachable without the header icon.
 */
function MoreSheet({
  scope,
  pathname,
}: {
  readonly scope: ContextScope;
  readonly pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const items = moreSectionsFor(scope);
  const inside = items.some((item) => isActiveRoute(pathname, item.href));
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <button
          type="button"
          // "true", not "page": the tab is the set holding the current page.
          aria-current={inside ? "true" : undefined}
          data-active={inside ? "" : undefined}
          data-nav-more
          className={cx(
            TAB_CLASS,
            inside
              ? "font-semibold text-(--cq-accent)"
              : "font-medium text-(--cq-text-secondary)",
          )}
        >
          {inside ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-(--cq-accent)"
            />
          ) : null}
          <MoreHorizontal
            aria-hidden="true"
            size={ICON_SIZE.prominent + 2}
            strokeWidth={inside ? 2 : ICON_STROKE}
          />
          <span className="truncate">More</span>
        </button>
      </SheetTrigger>
      <SheetContent title="More">
        <nav aria-label="More sections">
          <ul className="flex flex-col">
            {items.map((item) => {
              const active = isActiveRoute(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className={cx(
                      "flex min-h-12 items-center gap-3 rounded-md px-3 cq-body transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)",
                      active
                        ? "bg-(--cq-accent-soft) font-semibold text-(--cq-text-primary)"
                        : "text-(--cq-text-primary)",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      size={ICON_SIZE.prominent}
                      strokeWidth={active ? 2 : ICON_STROKE}
                      className={
                        active
                          ? "text-(--cq-accent)"
                          : "text-(--cq-text-secondary)"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {active ? (
                      <span className="cq-caption text-(--cq-text-secondary)">
                        Current
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-3 flex flex-col gap-2 border-t border-(--cq-border-subtle) px-3 pt-4">
          <span className="cq-label text-(--cq-text-secondary)">
            Appearance
          </span>
          <ThemeToggle />
        </div>
      </SheetContent>
    </SheetRoot>
  );
}
