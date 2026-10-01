"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cx } from "@capital-q/ui";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { ICON_SIZE, ICON_STROKE, PanelLeft } from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

import { ThemeMenu } from "@/features/appearance/theme-menu";
import { NotificationCenter } from "@/features/work/notification-center";
import { useHomeHref } from "@/features/q/active-conversation";

import type { ShellContext } from "./app-shell";
import {
  DOCUMENTS_NAVIGATION,
  FOUNDER_MEDIA_NAVIGATION,
  DAILY_NAVIGATION,
  FIND_NAVIGATION,
  REHEARSALS_NAVIGATION,
  RESULTS_NAVIGATION,
  FOUNDER_REQUESTS_NAVIGATION,
  INVESTORS_NAVIGATION,
  isActiveRoute,
  PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
  SETTINGS_NAVIGATION,
} from "./navigation";
import { sidebarCollapsed, type SidebarOverride } from "./sidebar-state";

/**
 * Desktop progressive enhancement of the same information architecture.
 * Hidden below the desktop breakpoint, where the bottom navigation is
 * canonical.
 *
 * Collapsible (R24). On the Q page it starts as a narrow rail of icons, so
 * Q has the width; elsewhere it starts open. A choice made on one kind of
 * page holds until the person moves to the other kind. Past chats live
 * on the Q page's Conversations sheet, not here (founder direction
 * 2026-09-29): the sidebar is navigation only.
 */
export function DesktopSidebar({
  context,
}: {
  readonly context: ShellContext;
}) {
  const pathname = usePathname();
  // Home is the conversation this tab was in, not a new chat each visit.
  const home = useHomeHref();
  const [override, setOverride] = useState<SidebarOverride | null>(null);
  const collapsed = sidebarCollapsed(pathname, override);
  const onQ = isActiveRoute(pathname, "/home");
  const setCollapsed = (next: boolean) => {
    setOverride({ onQ, collapsed: next });
  };

  const items = [
    ...PRIMARY_NAVIGATION,
    ...(context.scope === "founder_private"
      ? [INVESTORS_NAVIGATION, FOUNDER_MEDIA_NAVIGATION]
      : context.scope === "investor_private"
        ? [FOUNDER_REQUESTS_NAVIGATION]
        : []),
    ...(context.scope === "founder_private" ||
    context.scope === "investor_private"
      ? [REHEARSALS_NAVIGATION, RESULTS_NAVIGATION]
      : []),
    DOCUMENTS_NAVIGATION,
    // DAILY block
    DAILY_NAVIGATION,
    FIND_NAVIGATION,
  ];

  return (
    <aside
      className="cq-shell-sidebar"
      data-collapsed={collapsed ? "" : undefined}
      data-sidebar
    >
      <div
        className={cx(
          "flex items-center gap-2 pt-4 pb-3",
          collapsed ? "flex-col px-2" : "justify-between pr-2 pl-5",
        )}
      >
        {collapsed ? null : (
          <Link
            href={home}
            className="cq-title-md inline-block rounded-xs text-(--cq-text-primary)"
          >
            Capital Q
          </Link>
        )}
        <Tooltip
          content={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          side="right"
        >
          <button
            type="button"
            className="cq-sidebar-icon"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => {
              setCollapsed(!collapsed);
            }}
            data-sidebar-toggle
          >
            <PanelLeft
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
          </button>
        </Tooltip>
      </div>

      <nav aria-label="Primary" className={collapsed ? "px-2" : "px-3"}>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.href}>
              <SidebarLink
                href={item.href === "/home" ? home : item.href}
                label={item.label}
                Icon={item.icon}
                active={isActiveRoute(pathname, item.href)}
                compact={collapsed}
              />
            </li>
          ))}
        </ul>
      </nav>

      {collapsed ? null : (
        <div className="mt-6 flex flex-col gap-2 border-t border-(--cq-border-subtle) px-5 pt-5">
          {/* Where this person is acting: the scope, out of the input. */}
          <ContextIndicator scope={context.scope} detail={context.label} />
        </div>
      )}

      <div
        className={cx(
          "mt-auto flex gap-1 border-t border-(--cq-border-subtle) py-3",
          collapsed ? "flex-col items-center px-2" : "items-center px-3",
        )}
      >
        <div className={collapsed ? "" : "min-w-0 flex-1"}>
          <SidebarLink
            href={PROFILE_NAVIGATION.href}
            label={PROFILE_NAVIGATION.label}
            Icon={PROFILE_NAVIGATION.icon}
            active={isActiveRoute(pathname, PROFILE_NAVIGATION.href)}
            compact={collapsed}
          />
        </div>
        {/* AUTO: notices from Q and the push switch, one bell. */}
        <NotificationCenter />
        {/* The appearance choice, one icon (R24; ADR 0017 F4). */}
        <ThemeMenu align={collapsed ? "start" : "end"} />
        <Tooltip content={SETTINGS_NAVIGATION.label} side="right">
          <Link
            href={SETTINGS_NAVIGATION.href}
            aria-label={SETTINGS_NAVIGATION.label}
            aria-current={
              isActiveRoute(pathname, SETTINGS_NAVIGATION.href)
                ? "page"
                : undefined
            }
            className="cq-sidebar-icon"
            data-settings-link
          >
            <SETTINGS_NAVIGATION.icon
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
          </Link>
        </Tooltip>
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  label,
  Icon,
  active,
  compact,
}: {
  readonly href: string;
  readonly label: string;
  readonly Icon: (typeof PRIMARY_NAVIGATION)[number]["icon"];
  readonly active: boolean;
  readonly compact: boolean;
}) {
  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? label : undefined}
      className={cx(
        "relative flex min-h-11 items-center rounded-md cq-body-sm transition-colors duration-(--cq-motion-fast)",
        compact ? "w-11 justify-center" : "gap-3 px-3",
        active
          ? "bg-(--cq-accent-soft) font-medium text-(--cq-text-primary)"
          : "text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-(--cq-accent)"
        />
      ) : null}
      <Icon
        aria-hidden="true"
        size={ICON_SIZE.regular}
        strokeWidth={ICON_STROKE}
      />
      {compact ? null : <span>{label}</span>}
    </Link>
  );
  return compact ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
