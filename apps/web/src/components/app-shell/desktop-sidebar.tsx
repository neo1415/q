"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cx } from "@capital-q/ui";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { ICON_SIZE, ICON_STROKE, PanelLeft, Search } from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

import { ThemeMenu } from "@/features/appearance/theme-menu";
import { NotificationCenter } from "@/features/work/notification-center";
import { useHomeHref } from "@/features/q/active-conversation";

import type { ShellContext } from "./app-shell";
import { useNotices } from "@/features/work/notice-store";

import {
  FIND_NAVIGATION,
  isActiveRoute,
  navigationGroupsFor,
  PRIMARY_NAVIGATION,
  WORK_NAVIGATION,
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

  const groups = navigationGroupsFor(context.scope, { admin: context.admin });
  // What waits on them, from the shell's one notice read (no extra call).
  const needsYou = useNeedsYouCount();

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

      {/* Search is a field, not a section (WORK-58). */}
      <div className={collapsed ? "px-2 pb-2" : "px-3 pb-2"}>
        {collapsed ? (
          <SidebarLink
            href={FIND_NAVIGATION.href}
            label={FIND_NAVIGATION.label}
            Icon={FIND_NAVIGATION.icon}
            active={isActiveRoute(pathname, FIND_NAVIGATION.href)}
            compact
          />
        ) : (
          <Link
            href={FIND_NAVIGATION.href}
            aria-current={
              isActiveRoute(pathname, FIND_NAVIGATION.href) ? "page" : undefined
            }
            className="flex min-h-10 items-center gap-3 rounded-md bg-(--cq-surface-subtle) px-3 cq-body-sm text-(--cq-text-tertiary) transition-colors duration-(--cq-motion-fast) hover:text-(--cq-text-secondary)"
            data-sidebar-search
          >
            <Search
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
            <span>Search</span>
          </Link>
        )}
      </div>

      <nav
        aria-label="Primary"
        className={cx(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {groups.map((group) => (
          <div
            key={group.label ?? "main"}
            role={group.label === null ? undefined : "group"}
            aria-label={group.label ?? undefined}
          >
            {group.label === null || collapsed ? null : (
              <p
                aria-hidden="true"
                className="px-3 pb-1 cq-caption font-medium text-(--cq-text-tertiary)"
              >
                {group.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <SidebarLink
                    href={item.href === "/home" ? home : item.href}
                    label={item.label}
                    Icon={item.icon}
                    active={isActiveRoute(pathname, item.href)}
                    compact={collapsed}
                    count={
                      item.href === WORK_NAVIGATION.href ? needsYou : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div
        className={cx(
          "flex gap-1 border-t border-(--cq-border-subtle) py-3",
          collapsed ? "flex-col items-center px-2" : "items-center px-3",
        )}
      >
        {collapsed ? null : (
          <div className="min-w-0 flex-1 px-2">
            {/* Where this person is acting: the scope, out of the input. */}
            <ContextIndicator scope={context.scope} detail={context.label} />
          </div>
        )}
        {/* The appearance choice, one icon (R24; ADR 0017 F4). */}
        <ThemeMenu align={collapsed ? "start" : "end"} />
        {/* AUTO: notices from Q and the push switch, one bell. */}
        <NotificationCenter />
      </div>
    </aside>
  );
}

/** Unread notices that wait on the person, for the Work entry's count. */
function useNeedsYouCount(): number {
  const notices = useNotices();
  return (notices.items ?? []).filter(
    (item) => item.priority === "NEEDS_YOU" && !item.read,
  ).length;
}

function SidebarLink({
  href,
  label,
  Icon,
  active,
  compact,
  count,
}: {
  readonly href: string;
  readonly label: string;
  readonly Icon: (typeof PRIMARY_NAVIGATION)[number]["icon"];
  readonly active: boolean;
  readonly compact: boolean;
  /** What waits on them there; shown as a number, said in the name. */
  readonly count?: number | undefined;
}) {
  const waiting = count !== undefined && count > 0 ? count : null;
  const name =
    waiting === null ? label : `${label}, ${String(waiting)} waiting for you`;
  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={compact || waiting !== null ? name : undefined}
      className={cx(
        "relative flex min-h-11 items-center rounded-md cq-body-sm pointer-fine:min-h-9 transition-colors duration-(--cq-motion-fast)",
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
      {compact ? null : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {compact || waiting === null ? null : (
        <span
          aria-hidden="true"
          className="cq-caption cq-numeric font-semibold text-(--cq-accent)"
        >
          {waiting}
        </span>
      )}
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
