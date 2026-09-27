"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";

import { cx } from "@capital-q/ui";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import {
  History,
  ICON_SIZE,
  ICON_STROKE,
  PanelLeft,
  Plus,
} from "@capital-q/ui/icons";
import { Tooltip } from "@capital-q/ui/tooltip";

import { ThemeMenu } from "@/features/appearance/theme-menu";
import { useHomeHref } from "@/features/q/active-conversation";
import { ChatsListForRoute } from "@/features/q/chats-list";

import type { ShellContext } from "./app-shell";
import {
  FOUNDER_MEDIA_NAVIGATION,
  isActiveRoute,
  PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
} from "./navigation";
import { sidebarCollapsed, type SidebarOverride } from "./sidebar-state";

/**
 * Desktop progressive enhancement of the same information architecture.
 * Hidden below the desktop breakpoint, where the bottom navigation is
 * canonical.
 *
 * Collapsible (R24). On the Q page it starts as a narrow rail of icons, so
 * Q has the width; elsewhere it starts open. A choice made on one kind of
 * page holds until the person moves to the other kind. The conversations
 * list is the one way into past chats (no separate "Ask Q" entry: the Q
 * page is Q, and the dock is Q everywhere else).
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
    ...(context.scope === "founder_private" ? [FOUNDER_MEDIA_NAVIGATION] : []),
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

      {collapsed ? (
        /* The conversations control, folded to its two actions. */
        <div className="flex flex-col items-center gap-0.5 px-2 pt-6">
          <Tooltip content="New chat" side="right">
            <Link
              href="/home"
              className="cq-sidebar-icon"
              aria-label="New chat"
            >
              <Plus
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            </Link>
          </Tooltip>
          <Tooltip content="Chats" side="right">
            <button
              type="button"
              className="cq-sidebar-icon"
              aria-label="Show chats"
              onClick={() => {
                setCollapsed(false);
              }}
              data-sidebar-chats
            >
              <History
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            </button>
          </Tooltip>
        </div>
      ) : (
        <>
          {/* The person's conversations with Q, collapsible (ADR 0012). */}
          <Suspense fallback={null}>
            <ChatsListForRoute variant="sidebar" />
          </Suspense>

          <div className="mt-6 flex flex-col gap-2 border-t border-(--cq-border-subtle) px-5 pt-5">
            {/* Where this person is acting: the scope, out of the input. */}
            <ContextIndicator scope={context.scope} detail={context.label} />
          </div>
        </>
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
        {/* The appearance choice, one icon (R24; ADR 0017 F4). */}
        <ThemeMenu align={collapsed ? "start" : "end"} />
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
