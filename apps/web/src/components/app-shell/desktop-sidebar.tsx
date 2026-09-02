"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { QMark } from "@capital-q/ui/q-mark";

import {
  isActiveRoute,
  PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
} from "./navigation";

/**
 * Desktop progressive enhancement of the same information architecture: a
 * compact light sidebar with the three primary areas, an honest organisation
 * context area, a Q shortcut and Profile kept secondary at the bottom.
 * Hidden below the desktop breakpoint, where the bottom navigation is
 * canonical.
 */
export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="cq-shell-sidebar">
      <div className="px-5 pt-6 pb-4">
        <Link
          href="/home"
          className="cq-title-md inline-block rounded-xs text-(--cq-text-primary)"
        >
          Capital Q
        </Link>
      </div>

      <nav aria-label="Primary" className="px-3">
        <ul className="flex flex-col gap-0.5">
          {PRIMARY_NAVIGATION.map((item) => (
            <li key={item.href}>
              <SidebarLink
                href={item.href}
                label={item.label}
                Icon={item.icon}
                active={isActiveRoute(pathname, item.href)}
              />
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex flex-col gap-3 border-t border-(--cq-border-subtle) px-5 pt-5">
        <p className="cq-label text-(--cq-text-secondary)">Organisation</p>
        <ContextIndicator scope="unset" />
        <p className="cq-caption text-(--cq-text-tertiary)">
          Your organisation appears here once you belong to one.
        </p>
      </div>

      <div className="px-3 pt-6">
        <Link
          href="/home#q"
          className={buttonClassName(
            "secondary",
            "regular",
            "w-full justify-start",
          )}
        >
          <QMark size="sm" />
          Ask Q
        </Link>
      </div>

      <div className="mt-auto border-t border-(--cq-border-subtle) px-3 py-3">
        <SidebarLink
          href={PROFILE_NAVIGATION.href}
          label={PROFILE_NAVIGATION.label}
          Icon={PROFILE_NAVIGATION.icon}
          active={isActiveRoute(pathname, PROFILE_NAVIGATION.href)}
        />
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  label,
  Icon,
  active,
}: {
  readonly href: string;
  readonly label: string;
  readonly Icon: (typeof PRIMARY_NAVIGATION)[number]["icon"];
  readonly active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex min-h-10 items-center gap-3 rounded-md px-3 cq-body-sm transition-colors duration-(--cq-motion-fast)",
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
      <span>{label}</span>
    </Link>
  );
}
