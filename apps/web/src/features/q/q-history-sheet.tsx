"use client";

import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { ChatsList } from "./chats-list";
import { useT } from "@/features/i18n/language";

/**
 * The person's previous conversations, one control away from the Q
 * surface. The same server-read list as the sidebar and Home's inline
 * chats; opening one is a navigation to Home in that conversation, so
 * nothing about the thread is kept here.
 */
export function QHistorySheet({
  open,
  onOpenChange,
  active,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly active: string | null;
}) {
  const t = useT();
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      {open ? (
        <SheetContent
          side="side"
          title={t("Previous conversations")}
          description={t("Everything you and Q have said, by conversation.")}
        >
          <ChatsList variant="inline" active={active} />
        </SheetContent>
      ) : null}
    </SheetRoot>
  );
}
