"use client";

import type { ReactNode } from "react";

import { DialogContent, DialogRoot, DialogTrigger } from "@capital-q/ui/dialog";
import { ICON_SIZE, Info } from "@capital-q/ui/icons";

/**
 * The relationship's details behind one icon in the chat header, as a
 * chat app keeps a contact's info one tap away rather than beside the
 * thread (founder direction 2026-09-29).
 */
export function InfoDialog({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <DialogRoot>
      <DialogTrigger>
        <button
          type="button"
          aria-label={title}
          className="flex size-11 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle)"
        >
          <Info size={ICON_SIZE.regular} aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent
        title={title}
        className="max-h-[85vh] max-w-md overflow-y-auto"
      >
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
