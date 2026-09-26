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

import { ThemeToggle } from "@/features/appearance/theme-toggle";
import { QMotionToggle } from "@/features/q-aperture";

import { FOUNDER_MEDIA_NAVIGATION, PROFILE_NAVIGATION } from "./navigation";

/**
 * The mobile header's account menu. Its first row is the theme, so the
 * appearance choice is one tap away on a phone rather than two screens
 * deep in Profile (ADR 0017 F4); Profile itself stays the bottom tab and
 * is linked here as well.
 */
export function AccountMenu({
  founder = false,
}: {
  /** A founder's context: their pitch is one tap away too (VID). */
  readonly founder?: boolean | undefined;
}) {
  return (
    <PopoverRoot>
      <PopoverTrigger>
        <IconButton
          aria-label="Account and appearance"
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
          <div className="flex items-center justify-between gap-3">
            <span className="cq-label text-(--cq-text-primary)">Theme</span>
            <ThemeToggle display="icons" size="touch" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="cq-label text-(--cq-text-primary)">Q motion</span>
            <QMotionToggle size="touch" />
          </div>
          {founder ? (
            <Link
              href={FOUNDER_MEDIA_NAVIGATION.href}
              className="-mx-2 flex min-h-11 items-center justify-between rounded-md border-t border-(--cq-border-subtle) px-2 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
            >
              {FOUNDER_MEDIA_NAVIGATION.label}
              <ChevronRight
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </Link>
          ) : null}
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
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
