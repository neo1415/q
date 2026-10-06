"use client";

import Link from "next/link";
import { SignOutControl } from "@/features/auth";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { IntentLink } from "./intent-link";

import { cx } from "@capital-q/ui";
import {
  ChevronRight,
  ICON_SIZE,
  ICON_STROKE,
  MoreHorizontal,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot, SheetTrigger } from "@capital-q/ui/sheet";
import type { MyOrganisationDto } from "@capital-q/contracts";
import type { ContextScope } from "@capital-q/ui/tokens";

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { MoreOrganisationSwitcher } from "@/features/team/org-switcher";
import { useHomeHref } from "@/features/q/active-conversation";
import { useNotices } from "@/features/work/notice-store";
import { VerifyNudgeLink } from "@/features/verification/verify-nudge";
import type { VerifyNudge } from "@/features/verification/verify-state";

import {
  isActiveRoute,
  MOBILE_CENTRE_HREF,
  MOBILE_NAVIGATION,
  moreGroupsFor,
  moreSectionsFor,
  PROFILE_NAVIGATION,
  WORK_NAVIGATION,
  type NavigationItem,
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
  admin = false,
  verifyNudge = null,
  organisations = [],
}: {
  readonly organisations?: readonly MyOrganisationDto[] | undefined;
  readonly scope?: ContextScope | undefined;
  /** A platform admin: the More sheet adds the Admin group. */
  readonly admin?: boolean | undefined;
  readonly verifyNudge?: VerifyNudge | null | undefined;
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
              <IntentLink
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
              </IntentLink>
            </li>
          );
        })}
        <li className="min-w-0">
          <MoreSheet
            organisations={organisations}
            scope={scope}
            admin={admin}
            pathname={pathname}
            verifyNudge={verifyNudge}
          />
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
  organisations,
  scope,
  admin,
  pathname,
  verifyNudge,
}: {
  readonly organisations: readonly MyOrganisationDto[];
  readonly scope: ContextScope;
  readonly admin: boolean;
  readonly pathname: string;
  readonly verifyNudge: VerifyNudge | null;
}) {
  const [open, setOpen] = useState(false);
  const items = moreSectionsFor(scope, { admin });
  const groups = moreGroupsFor(scope, { admin });
  const inside = items.some((item) => isActiveRoute(pathname, item.href));
  const notices = useNotices();
  const needsYou = (notices.items ?? []).filter(
    (item) => item.priority === "NEEDS_YOU" && !item.read,
  ).length;
  const close = () => {
    setOpen(false);
  };
  const profileActive = isActiveRoute(pathname, PROFILE_NAVIGATION.href);
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
        {/* G2: who they act for, first, when they have two or more. */}
        <MoreOrganisationSwitcher
          organisations={organisations}
          onPicked={close}
        />
        <nav aria-label="More sections">
          {/* Profile heads the sheet (WORK-58); search lives in Explore. */}
          <Link
            href={PROFILE_NAVIGATION.href}
            aria-current={profileActive ? "page" : undefined}
            onClick={close}
            className="flex min-h-14 items-center gap-3 rounded-md px-3 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)"
          >
            <PROFILE_NAVIGATION.icon
              aria-hidden="true"
              size={ICON_SIZE.prominent + 4}
              strokeWidth={ICON_STROKE}
              className="text-(--cq-text-secondary)"
            />
            <span className="min-w-0 flex-1 truncate cq-body font-medium text-(--cq-text-primary)">
              {PROFILE_NAVIGATION.label}
            </span>
            <ChevronRight
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
              className="text-(--cq-text-tertiary)"
            />
          </Link>
          {groups.map((group) => (
            <div
              key={group.label ?? "main"}
              role="group"
              aria-label={group.label ?? "Sections"}
              className="mt-3"
            >
              {group.label === null ? null : (
                <p
                  aria-hidden="true"
                  className="px-3 pb-1 cq-caption font-medium text-(--cq-text-tertiary)"
                >
                  {group.label}
                </p>
              )}
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <MoreLink
                      item={item}
                      active={isActiveRoute(pathname, item.href)}
                      count={
                        item.href === WORK_NAVIGATION.href
                          ? needsYou
                          : undefined
                      }
                      onNavigate={close}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {verifyNudge === null ? null : (
          <div className="mt-3 border-t border-(--cq-border-subtle) pt-3">
            <VerifyNudgeLink nudge={verifyNudge} onNavigate={close} />
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2 border-t border-(--cq-border-subtle) px-3 pt-4">
          <span className="cq-label text-(--cq-text-secondary)">
            Appearance
          </span>
          <ThemeToggle />
        </div>
        <div className="mt-3 border-t border-(--cq-border-subtle) pt-2">
          <SignOutControl appearance="row" />
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

function MoreLink({
  item,
  active,
  count,
  onNavigate,
}: {
  readonly item: NavigationItem;
  readonly active: boolean;
  readonly count?: number | undefined;
  readonly onNavigate: () => void;
}) {
  const Icon = item.icon;
  const waiting = count !== undefined && count > 0 ? count : null;
  return (
    <IntentLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={
        waiting === null
          ? undefined
          : `${item.label}, ${String(waiting)} waiting for you`
      }
      onClick={onNavigate}
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
        className={active ? "text-(--cq-accent)" : "text-(--cq-text-secondary)"}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {waiting === null ? null : (
        <span
          aria-hidden="true"
          className="cq-label cq-numeric font-semibold text-(--cq-accent)"
        >
          {waiting}
        </span>
      )}
      {active ? (
        <span className="cq-caption text-(--cq-text-secondary)">Current</span>
      ) : null}
    </IntentLink>
  );
}
