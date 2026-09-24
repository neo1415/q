import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import { Button, buttonClassName, IconButton } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";

import type { SaveStatus } from "../controller";
import { SaveStatusIndicator } from "./save-status";

/**
 * Focused onboarding frame. Mobile: compact top bar (Back · wordmark ·
 * Save & leave), progress, the step, and a bottom action area that reserves
 * its own space and respects the safe area and the on-screen keyboard.
 * Desktop centres the same column at reading width. The bottom navigation is
 * deliberately absent; "Save & leave" is the exit, always visible.
 *
 * The action bar is part of the reading column, not a full-bleed strip: it
 * sits directly under the step and only sticks to the bottom of the viewport
 * while the step is longer than the screen (design/visual-debt.md, form
 * shell). Continue is the one primary action on the screen.
 */
export type OnboardingShellProps = {
  /** Changes when the step changes, so the new step animates in. */
  readonly stepKey?: string | undefined;
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
  stepKey,
  children,
  onBack,
  busy,
  saveStatus,
  primaryAction,
  secondaryAction,
  notice,
}: OnboardingShellProps) {
  // While a save is in flight the primary keeps its colour and stays in the
  // tab order; a second press is simply not taken. It is announced as
  // unavailable rather than dimmed into a pale block, and the status line
  // beside it says why. Any other busy state (going back, opening a step)
  // disables it as before.
  const saving = busy && saveStatus === "saving";
  const guard = (event: MouseEvent<HTMLButtonElement>) => {
    if (saving) {
      event.preventDefault();
      return;
    }
    primaryAction.onClick?.();
  };

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
            className={buttonClassName("quiet", "regular", "px-3")}
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
        className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 pt-6 pb-6 sm:px-6"
      >
        {notice}
        <div key={stepKey ?? "step"} className="cq-step-enter">
          {children}
        </div>
      </main>

      <div className="sticky bottom-0 z-(--cq-z-sticky) mx-auto mt-auto w-full max-w-(--cq-layout-reading) bg-(--cq-canvas) px-4 pb-[calc(12px+var(--cq-safe-bottom))] sm:px-6 lg:mt-0">
        <div className="flex items-center gap-3 border-t border-(--cq-border-subtle) pt-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
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
              className={buttonClassName("primary", "large", "shrink-0")}
            >
              {primaryAction.label}
            </Link>
          ) : (
            <Button
              type={primaryAction.formId !== undefined ? "submit" : "button"}
              form={primaryAction.formId}
              variant="primary"
              size="large"
              onClick={guard}
              disabled={busy && !saving}
              aria-disabled={saving ? true : undefined}
              data-saving={saving ? "" : undefined}
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
