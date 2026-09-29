"use client";

import Link from "next/link";

import { IconButton } from "@capital-q/ui/button";
import {
  ChevronRight,
  CircleUser,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@capital-q/ui/popover";

import {
  FOUNDER_MEDIA_NAVIGATION,
  FIND_NAVIGATION,
  FOUNDER_REQUESTS_NAVIGATION,
  INVESTORS_NAVIGATION,
  PROFILE_NAVIGATION,
  SETTINGS_NAVIGATION,
} from "./navigation";

/**
 * The mobile header's account menu: the founder's pitch, Profile (also the
 * bottom tab) and Settings (R28), where theme, Q motion and Q's voice
 * live. The theme itself is one icon beside it in the header (R24).
 */
export function AccountMenu({
  founder = false,
  investor = false,
}: {
  /** A founder's context: their pitch is one tap away too (VID). */
  readonly founder?: boolean | undefined;
  /** An investor's context: founders' requests (ADR 0023). */
  readonly investor?: boolean | undefined;
}) {
  const sideLinks = [
    ...(founder ? [INVESTORS_NAVIGATION, FOUNDER_MEDIA_NAVIGATION] : []),
    ...(investor ? [FOUNDER_REQUESTS_NAVIGATION] : []),
    FIND_NAVIGATION,
  ];
  return (
    <PopoverRoot>
      <PopoverTrigger>
        <IconButton
          aria-label="Account"
          variant="quiet"
          className="text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          data-account-menu
        >
          <CircleUser
            aria-hidden="true"
            size={ICON_SIZE.prominent}
            strokeWidth={ICON_STROKE}
          />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent title="Account">
        <div className="flex flex-col gap-3 pt-2">
          {sideLinks.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="-mx-2 flex min-h-11 items-center justify-between rounded-md border-t border-(--cq-border-subtle) px-2 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
            >
              {item.label}
              <ChevronRight
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </Link>
          ))}
          <Link
            href={PROFILE_NAVIGATION.href}
            className="-mx-2 flex min-h-11 items-center justify-between rounded-md border-t border-(--cq-border-subtle) px-2 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
          >
            {PROFILE_NAVIGATION.label}
            <ChevronRight
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </Link>
          <Link
            href={SETTINGS_NAVIGATION.href}
            className="-mx-2 flex min-h-11 items-center justify-between rounded-md border-t border-(--cq-border-subtle) px-2 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
          >
            {SETTINGS_NAVIGATION.label}
            <ChevronRight
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
          </Link>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
