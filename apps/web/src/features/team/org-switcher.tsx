"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { MyOrganisationDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  Check,
  ChevronsUpDown,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@capital-q/ui/popover";

import { switchOrganisationAction } from "./team-actions";
import { teamWords } from "./team-words";

/**
 * Who they act for (G2), for a person in two or more companies or firms:
 * the top of the sidebar on desktop, the top of More on a phone. Hidden
 * for one: one person alone is simply their own company or firm.
 *
 * Switching asks the server to make another of their OWN memberships the
 * active one (the existing activate route); it is a request, never trust.
 * Every page then reloads under that context, and Q's memory and drafts
 * stay with each one.
 */

const ROLE = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" } as const;

function Monogram({
  name,
  size = 34,
}: {
  readonly name: string;
  readonly size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[9px] border border-(--cq-border-subtle) bg-(--cq-surface-subtle) cq-label font-semibold text-(--cq-text-primary)"
      style={{ width: size, height: size }}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function useSwitch() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const switchTo = (organisationId: string, after?: () => void) => {
    start(async () => {
      const out = await switchOrganisationAction(organisationId);
      if (!out.ok) {
        setError(out.message);
        return;
      }
      setError(null);
      after?.();
      router.refresh();
    });
  };
  return { pending, error, switchTo };
}

function OrganisationList({
  organisations,
  onPicked,
}: {
  readonly organisations: readonly MyOrganisationDto[];
  readonly onPicked?: (() => void) | undefined;
}) {
  const { pending, error, switchTo } = useSwitch();
  return (
    <div role="menu" aria-label="Switch company or firm" data-org-switcher-list>
      <p className="px-2.5 pt-2 pb-1 cq-caption text-(--cq-text-tertiary)">
        Acting for
      </p>
      {organisations.map((organisation) => (
        <button
          key={organisation.organisationId}
          type="button"
          role="menuitemradio"
          aria-checked={organisation.active}
          disabled={pending}
          onClick={() => {
            if (!organisation.active)
              switchTo(organisation.organisationId, onPicked);
          }}
          className={cx(
            "flex min-h-13 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)",
            organisation.active ? "bg-(--cq-surface-subtle)" : null,
          )}
        >
          <Monogram name={organisation.name} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate cq-body-sm font-medium text-(--cq-text-primary)">
              {organisation.name}
            </span>
            <span className="cq-caption text-(--cq-text-secondary)">
              {teamWords(organisation.kind).label} · {ROLE[organisation.role]}
            </span>
          </span>
          {organisation.active ? (
            <Check
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              className="text-(--cq-text-primary)"
            />
          ) : null}
        </button>
      ))}
      <p className="border-t border-(--cq-border-subtle) px-2.5 pt-2 pb-2 mt-1.5 cq-caption text-(--cq-text-tertiary)">
        Q keeps each one&apos;s work and memory separate.
      </p>
      {error === null ? null : (
        <p
          role="alert"
          className="px-2.5 pb-2 cq-caption text-(--cq-text-primary)"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Desktop: the sidebar's header button and its menu. */
export function SidebarOrganisationSwitcher({
  organisations,
  compact,
}: {
  readonly organisations: readonly MyOrganisationDto[];
  readonly compact: boolean;
}) {
  if (organisations.length < 2) return null;
  const active = organisations.find((o) => o.active) ?? organisations[0];
  if (active === undefined) return null;
  const sub = `${teamWords(active.kind).label} · ${active.memberCount === 1 ? "Just you" : `${String(active.memberCount)} people`}`;
  return (
    <PopoverRoot>
      <PopoverTrigger>
        <button
          type="button"
          aria-label={`Acting for ${active.name}. Switch`}
          className={cx(
            "flex min-h-12 items-center gap-2.5 rounded-[10px] text-left transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)",
            compact ? "w-11 justify-center" : "w-full px-2.5 py-1.5",
          )}
          data-org-switcher
        >
          <Monogram name={active.name} size={compact ? 32 : 34} />
          {compact ? null : (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate cq-body-sm font-medium text-(--cq-text-primary)">
                  {active.name}
                </span>
                <span className="truncate cq-caption text-(--cq-text-secondary)">
                  {sub}
                </span>
              </span>
              <ChevronsUpDown
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
                className="text-(--cq-text-tertiary)"
              />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-1.5">
        <OrganisationList organisations={organisations} />
      </PopoverContent>
    </PopoverRoot>
  );
}

/** Phone: the top of the More sheet. */
export function MoreOrganisationSwitcher({
  organisations,
  onPicked,
}: {
  readonly organisations: readonly MyOrganisationDto[];
  readonly onPicked: () => void;
}) {
  if (organisations.length < 2) return null;
  return (
    <div className="mb-3 rounded-[14px] border border-(--cq-border-subtle) p-1.5">
      <OrganisationList organisations={organisations} onPicked={onPicked} />
    </div>
  );
}
