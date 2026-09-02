"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactElement, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Centred modal dialog on Base UI, for decisions that need the user's full
 * attention (an approval, a confirmation). Focus is trapped and returned by
 * the primitive; Escape closes. On phones it fills the width comfortably
 * rather than shrinking to a desktop modal.
 */

export function DialogRoot({
  children,
  open,
  onOpenChange,
}: {
  readonly children: ReactNode;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

export function DialogTrigger({
  children,
}: {
  readonly children: ReactElement;
}) {
  return <BaseDialog.Trigger render={children} />;
}

export function DialogContent({
  title,
  description,
  children,
  actions,
  className,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-(--cq-z-modal) bg-(--cq-overlay) transition-opacity duration-(--cq-motion-base) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <BaseDialog.Popup
        className={cx(
          "fixed top-1/2 left-1/2 z-(--cq-z-modal) flex w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 shadow-(--cq-shadow-overlay) outline-none transition-[opacity,transform] duration-(--cq-motion-base) data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
          className,
        )}
      >
        <div className="flex flex-col gap-1">
          <BaseDialog.Title className="cq-title-md text-(--cq-text-primary)">
            {title}
          </BaseDialog.Title>
          {description !== undefined ? (
            <BaseDialog.Description className="cq-body-sm text-(--cq-text-secondary)">
              {description}
            </BaseDialog.Description>
          ) : null}
        </div>
        {children !== undefined ? (
          <div className="cq-body-sm text-(--cq-text-primary)">{children}</div>
        ) : null}
        {actions !== undefined ? (
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            {actions}
          </div>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogClose({ children }: { readonly children: ReactElement }) {
  return <BaseDialog.Close render={children} />;
}
