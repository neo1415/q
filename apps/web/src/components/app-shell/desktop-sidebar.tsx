"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { IntentLink } from "./intent-link";

import { cx } from "@capital-q/ui";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { ICON_SIZE, ICON_STROKE, PanelLeft } from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

import { ThemeMenu } from "@/features/appearance/theme-menu";
import { SidebarOrganisationSwitcher } from "@/features/team/org-switcher";
import { SignOutControl } from "@/features/auth";
import { NotificationCenter } from "@/features/work/notification-center";
import { useHomeHref } from "@/features/q/active-conversation";

import type { ShellContext } from "./app-shell";
import { useNotices } from "@/features/work/notice-store";

import {
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

      {/* G2: who they act for, when they have two or more. */}
      {(context.organisations?.length ?? 0) < 2 ? null : (
        <div
          className={collapsed ? "flex justify-center px-2 pb-2" : "px-3 pb-2"}
        >
          <SidebarOrganisationSwitcher
            organisations={context.organisations ?? []}
            compact={collapsed}
          />
        </div>
      )}

      {/* Scrolls up and down only. Folded, the rail has no side padding
          and centres its 44 px icons, so a classic scrollbar (Windows,
          Linux) still leaves them room instead of forcing a sideways bar. */}
      <nav
        aria-label="Primary"
        className={cx(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pb-3",
          collapsed ? "items-center px-0" : "px-3",
        )}
        data-sidebar-nav
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
            <ul
              className={cx(
                "flex flex-col gap-0.5",
                collapsed ? "items-center" : null,
              )}
            >
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

      {/* The footer never widens the rail: folded, its icons stack in one
          column; open, where they act sits on its own line above them,
          rather than squeezed beside three icons. */}
      <div
        className="flex flex-col gap-1 overflow-x-hidden border-t border-(--cq-border-subtle) px-2 py-3"
        data-sidebar-footer
      >
        {collapsed ? null : (
          <div className="min-w-0 px-3 pb-1">
            {/* Where this person is acting: the scope, out of the input. */}
            <ContextIndicator scope={context.scope} detail={context.label} />
          </div>
        )}
        <div
          className={cx(
            "flex gap-1",
            collapsed ? "flex-col items-center" : "items-center px-1",
          )}
        >
          {/* The appearance choice, one icon (R24; ADR 0017 F4). */}
          <ThemeMenu align={collapsed ? "start" : "end"} />
          {/* AUTO: notices from Q and the push switch, one bell. */}
          <NotificationCenter />
          <SignOutControl appearance="icon" />
        </div>
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
    <IntentLink
      href={href}
      // P9: loading shell in view, the whole page on intent.
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
    </IntentLink>
  );
  return compact ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
