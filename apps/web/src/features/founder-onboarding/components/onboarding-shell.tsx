import Link from "next/link";
import type { ReactNode } from "react";

import { Button, IconButton } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import type { SaveStatus } from "../controller/use-founder-onboarding";
import { SaveStatusIndicator } from "./save-status";

/**
 * Focused onboarding frame. Mobile: compact top bar (Back · wordmark ·
 * Save & leave), progress, the step, and a bottom action area that reserves
 * its own space and respects the safe area and the on-screen keyboard.
 * Desktop centres the same column at reading width. The bottom navigation is
 * deliberately absent; "Save & leave" is the exit, always visible.
 */
export type OnboardingShellProps = {
  readonly progress: ReactNode;
  readonly children: ReactNode;
  readonly onBack: (() => void) | undefined;
  readonly busy: boolean;
  readonly saveStatus: SaveStatus;
  readonly primaryAction: {
    readonly label: string;
    readonly formId?: string | undefined;
    readonly href?: string | undefined;
    readonly onClick?: (() => void) | undefined;
  };
  readonly secondaryAction?:
    { readonly label: string; readonly onClick: () => void } | undefined;
  readonly notice?: ReactNode | undefined;
};

export function OnboardingShell({
  progress,
  children,
  onBack,
  busy,
  saveStatus,
  primaryAction,
  secondaryAction,
  notice,
}: OnboardingShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-(--cq-z-sticky) border-b border-(--cq-border-subtle) bg-(--cq-canvas) pt-(--cq-safe-top)">
        <div className="mx-auto flex h-(--cq-header-height) w-full max-w-(--cq-layout-reading) items-center justify-between gap-2 px-2 sm:px-4">
          <IconButton
            aria-label="Back"
            variant="quiet"
            onClick={onBack}
            disabled={onBack === undefined || busy}
          >
            <ArrowLeft
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </IconButton>
          <span className="cq-label text-(--cq-text-primary)">Capital Q</span>
          <Link
            href="/home"
            className="flex min-h-11 items-center rounded-md px-3 cq-label text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
          >
            Save &amp; leave
          </Link>
        </div>
        <div className="mx-auto w-full max-w-(--cq-layout-reading) px-4 pb-3">
          {progress}
        </div>
      </header>

      <main
        id="main"
        className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-1 flex-col gap-6 px-4 pt-6 pb-[calc(96px+var(--cq-safe-bottom))] sm:px-6"
      >
        {notice}
        {children}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-(--cq-z-navigation) border-t border-(--cq-border-subtle) bg-(--cq-surface) pb-(--cq-safe-bottom)">
        <div className="mx-auto flex w-full max-w-(--cq-layout-reading) items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-col">
            <SaveStatusIndicator status={saveStatus} />
            {secondaryAction !== undefined ? (
              <Button
                variant="quiet"
                size="compact"
                onClick={secondaryAction.onClick}
                disabled={busy}
                className="self-start px-0"
              >
                {secondaryAction.label}
              </Button>
            ) : null}
          </div>
          {primaryAction.href !== undefined ? (
            <Link
              href={primaryAction.href}
              className="inline-flex h-12 shrink-0 items-center justify-center rounded-md bg-(--cq-accent) px-5 cq-body font-medium text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)"
            >
              {primaryAction.label}
            </Link>
          ) : (
            <Button
              type={primaryAction.formId !== undefined ? "submit" : "button"}
              form={primaryAction.formId}
              variant="primary"
              size="large"
              onClick={primaryAction.onClick}
              disabled={busy}
              className="shrink-0"
            >
              {primaryAction.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
