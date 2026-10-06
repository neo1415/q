import Link from "next/link";

import { cx } from "@capital-q/ui";
import { CircleAlert, ChevronLeft, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

/**
 * The settings sections beside Team (docs/design/2026-10-06/a/orgs.html):
 * a column on desktop; on a phone, a way back to Settings instead.
 */
const SECTIONS = [
  { id: "account", label: "Account", href: "/settings#account" },
  { id: "team", label: "Team", href: "/settings/team" },
  { id: "appearance", label: "Appearance", href: "/settings#appearance" },
  { id: "q", label: "Q", href: "/settings#q" },
  { id: "notifications", label: "Notifications", href: "/settings#notifications" },
  { id: "billing", label: "Plan and billing", href: "/settings#billing" },
  { id: "privacy", label: "Privacy", href: "/settings#privacy" },
] as const;

export function SettingsNav({ current }: { readonly current: string }) {
  return (
    <>
      <Link
        href="/settings"
        className="-mt-2 inline-flex min-h-11 items-center gap-1 self-start cq-body-sm text-(--cq-text-secondary) lg:hidden"
      >
        <ChevronLeft aria-hidden="true" size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        Settings
      </Link>
      <nav aria-label="Settings" className="hidden lg:block">
        <ul className="sticky top-6 flex flex-col gap-0.5">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={section.id === current ? "page" : undefined}
                className={cx(
                  "flex min-h-10 items-center rounded-md px-2.5 cq-body-sm transition-colors duration-(--cq-motion-fast)",
                  section.id === current
                    ? "bg-(--cq-surface-subtle) font-medium text-(--cq-text-primary)"
                    : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
                )}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Skeleton({ className }: { readonly className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("rounded-sm bg-(--cq-surface-subtle) motion-safe:animate-pulse", className)}
    />
  );
}

export function TeamSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" data-team-loading>
      <div className="flex flex-col gap-1">
        <h1 className="cq-title-lg text-(--cq-text-primary)">Team</h1>
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex flex-col">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3 py-2">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-10 w-22 rounded-[10px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamError() {
  return (
    <div className="flex flex-col gap-6" data-team-error>
      <h1 className="cq-title-lg text-(--cq-text-primary)">Team</h1>
      <div className="cq-panel flex flex-col items-start gap-3 p-5">
        <CircleAlert aria-hidden="true" size={ICON_SIZE.prominent} strokeWidth={ICON_STROKE} className="text-(--cq-text-secondary)" />
        <h2 className="cq-title-sm text-(--cq-text-primary)">Your team couldn&apos;t load</h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Nothing changed. Reload in a moment; if you&apos;re still setting up, finish with Q first.
        </p>
        <a href="/settings/team" className="inline-flex min-h-11 items-center rounded-md border border-(--cq-border) px-4 cq-body-sm font-medium text-(--cq-text-primary)">
          Try again
        </a>
      </div>
    </div>
  );
}
