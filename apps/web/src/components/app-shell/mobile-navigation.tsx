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
  PanelLeft,
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
  PROFILE_NAVIGATION,
  WORK_NAVIGATION,
  youGroupsFor,
  youSectionsFor,
  type NavigationItem,
} from "./navigation";
import { useNavGroups } from "./nav-group-state";
import { NavGroupToggle } from "./nav-group-toggle";
import { useT } from "@/features/i18n/language";

const TAB_CLASS =
  "relative flex h-full min-h-11 w-full flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight tracking-tight transition-colors duration-(--cq-motion-fast)";

/**
 * Canonical mobile navigation: five fixed tabs, Discover first and Q in the
 * centre (founder directive, 2026-09-27), CRM, then Work (owner-approved
 * option B, 2026-10-18: Work replaced More). Everything More held opens
 * from the You button in the phone's header (`YouSheet`). Each tab is a
 * 44 px+ target with a visible icon and label. Labels are set a step
 * smaller and tighter than caption so every label fits a 360 px phone
 * without truncating. The active tab is marked by aria-current, weight and
 * an indicator bar as well as colour. Work shows what waits for the
 * person, from the shell's one notice read.
 */
export function MobileNavigation() {
  const pathname = usePathname();
  // Home is the conversation this tab was in, not a new chat each visit.
  const home = useHomeHref();
  const t = useT();
  const needsYou = useNeedsYou();

  return (
    <nav aria-label={t("Primary")} className="cq-bottom-nav">
      <ul className="grid h-full grid-cols-5">
        {MOBILE_NAVIGATION.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;
          const waiting =
            item.href === WORK_NAVIGATION.href && needsYou > 0 ? needsYou : 0;
          return (
            <li key={item.href} className="min-w-0">
              <IntentLink
                href={item.href === "/home" ? home : item.href}
                aria-current={active ? "page" : undefined}
                aria-label={
                  waiting === 0
                    ? undefined
                    : `${t(item.label)}, ${t(`${String(waiting)} waiting for you`)}`
                }
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
                  <span aria-hidden="true" className="relative">
                    <Icon
                      aria-hidden="true"
                      size={ICON_SIZE.prominent + 2}
                      strokeWidth={active ? 2 : ICON_STROKE}
                    />
                    {waiting === 0 ? null : (
                      <span
                        data-nav-waiting
                        className="cq-numeric absolute -end-2.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-(--cq-accent) px-1 text-[10px] leading-4 font-semibold text-(--cq-text-inverse)"
                      >
                        {waiting}
                      </span>
                    )}
                  </span>
                )}
                <span className="truncate">{t(item.label)}</span>
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Owner 2026-10-28 (founder's direction): on a phone Capital Q opens like
 * ChatGPT. The conversation with Q owns the screen; there is no tab bar.
 * Discover, Explore, Q, CRM and Work open from this menu button at the
 * header's start, in a drawer from that edge. What You holds is unchanged.
 */
export function MobileMenu() {
  const pathname = usePathname();
  const home = useHomeHref();
  const t = useT();
  const needsYou = useNeedsYou();
  const [open, setOpen] = useState(false);
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <button
          type="button"
          aria-label={
            needsYou === 0
              ? t("Menu")
              : `${t("Menu")}, ${t(`${String(needsYou)} waiting for you`)}`
          }
          data-nav-menu
          className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          <PanelLeft
            aria-hidden="true"
            size={ICON_SIZE.prominent + 2}
            strokeWidth={ICON_STROKE}
          />
          {needsYou === 0 ? null : (
            <span
              aria-hidden="true"
              className="absolute end-2 top-2 size-2 rounded-full bg-(--cq-accent)"
            />
          )}
        </button>
      </SheetTrigger>
      <SheetContent title="Capital Q" side="start">
        <nav aria-label={t("Primary")}>
          <ul className="flex flex-col">
            {MOBILE_NAVIGATION.map((item) => {
              const active = isActiveRoute(pathname, item.href);
              const Icon = item.icon;
              const waiting =
                item.href === WORK_NAVIGATION.href ? needsYou : 0;
              return (
                <li key={item.href}>
                  <IntentLink
                    href={item.href === "/home" ? home : item.href}
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
                      {t(item.label)}
                    </span>
                    {waiting === 0 ? null : (
                      <span className="cq-numeric cq-caption rounded-full bg-(--cq-accent) px-2 font-semibold text-(--cq-text-inverse)">
                        {waiting}
                      </span>
                    )}
                  </IntentLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </SheetContent>
    </SheetRoot>
  );
}

/** Unread notices that wait on the person, from the shell's one read. */
function useNeedsYou(): number {
  const notices = useNotices();
  return (notices.items ?? []).filter(
    (item) => item.priority === "NEEDS_YOU" && !item.read,
  ).length;
}

/**
 * The phone's You button and its sheet (owner-approved option B,
 * 2026-10-18: Work replaced More in the bar, and what More held moved
 * here, to the header): who they act for, Profile first, Usage, Settings,
 * Admin for platform admins, the verify nudge, the theme, worded, and sign
 * out. The button reads as current while the page is one of the sheet's
 * sections; inside, the page itself is marked with aria-current. Shown on
 * a phone only (the header is hidden on desktop, where the sidebar's You
 * group and footer hold the same).
 */
export function YouSheet({
  scope = "unset",
  admin = false,
  qPitch = false,
  verifyNudge = null,
  organisations = [],
}: {
  readonly organisations?: readonly MyOrganisationDto[] | undefined;
  readonly scope?: ContextScope | undefined;
  /** A platform admin: the sheet adds the Admin group. */
  readonly admin?: boolean | undefined;
  readonly qPitch?: boolean | undefined;
  readonly verifyNudge?: VerifyNudge | null | undefined;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = youSectionsFor(scope, { admin, qPitch });
  const groups = youGroupsFor(scope, { admin, qPitch });
  const inside = items.some((item) => isActiveRoute(pathname, item.href));
  // The same remembered groups as the desktop sidebar, closed by default.
  const disclosure = useNavGroups(groups, pathname);
  const t = useT();
  const close = () => {
    setOpen(false);
  };
  const profileActive = isActiveRoute(pathname, PROFILE_NAVIGATION.href);
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <button
          type="button"
          aria-label={t("You")}
          // "true", not "page": the button is the set holding the page.
          aria-current={inside ? "true" : undefined}
          data-active={inside ? "" : undefined}
          data-nav-you
          className={cx(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-(--cq-motion-fast) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
            inside
              ? "bg-(--cq-accent-soft) text-(--cq-accent)"
              : "text-(--cq-text-secondary)",
          )}
        >
          <PROFILE_NAVIGATION.icon
            aria-hidden="true"
            size={ICON_SIZE.prominent + 2}
            strokeWidth={inside ? 2 : ICON_STROKE}
          />
        </button>
      </SheetTrigger>
      <SheetContent title={t("You")}>
        {/* ADR 0017 F4: Light · Device · Dark is the menu's first row on a
            phone, now that the header has no theme icon. */}
        <div className="mb-3 flex flex-col gap-2 border-b border-(--cq-border-subtle) px-3 pb-4">
          <span className="cq-label text-(--cq-text-secondary)">
            {t("Appearance")}
          </span>
          <ThemeToggle />
        </div>
        {/* G2: who they act for, first, when they have two or more. */}
        <MoreOrganisationSwitcher
          organisations={organisations}
          onPicked={close}
        />
        <nav aria-label={t("Your sections")}>
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
              {t(PROFILE_NAVIGATION.label)}
            </span>
            <ChevronRight
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
              className="text-(--cq-text-tertiary)"
            />
          </Link>
          {groups.map((group) => {
            const label = group.label;
            // The sheet is You itself, so its own group is never folded
            // (Settings stays one tap in); Admin folds as in the sidebar.
            const folded = label === "Admin";
            const listId = folded ? `cq-you-group-${label}` : undefined;
            const open = !folded || disclosure.isOpen(label);
            return (
              <div
                key={label ?? "main"}
                role="group"
                aria-label={label === null ? "Sections" : t(label)}
                className="mt-3"
              >
                {!folded || listId === undefined ? null : (
                  <NavGroupToggle
                    label={t(label)}
                    open={open}
                    controls={listId}
                    waiting={0}
                    size="large"
                    onToggle={() => {
                      disclosure.toggle(label);
                    }}
                  />
                )}
                <ul
                  id={listId}
                  hidden={!open}
                  className={cx(
                    "flex flex-col",
                    folded ? "cq-nav-group-list" : null,
                  )}
                >
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <YouLink
                        item={item}
                        active={isActiveRoute(pathname, item.href)}
                        onNavigate={close}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        {verifyNudge === null ? null : (
          <div className="mt-3 border-t border-(--cq-border-subtle) pt-3">
            <VerifyNudgeLink nudge={verifyNudge} onNavigate={close} />
          </div>
        )}
        <div className="mt-3 border-t border-(--cq-border-subtle) pt-2">
          <SignOutControl appearance="row" />
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

function YouLink({
  item,
  active,
  onNavigate,
}: {
  readonly item: NavigationItem;
  readonly active: boolean;
  readonly onNavigate: () => void;
}) {
  const Icon = item.icon;
  const t = useT();
  return (
    <IntentLink
      href={item.href}
      aria-current={active ? "page" : undefined}
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
      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      {active ? (
        <span className="cq-caption text-(--cq-text-secondary)">
          {t("Current")}
        </span>
      ) : null}
    </IntentLink>
  );
}
